import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DemandeStatus,
  DocumentKind,
  NotificationChannel,
  PaiementStatus,
  Role,
} from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ScopePolicyService } from '../../common/guards/scope-policy.service';
import { AuthUser } from '../../common/types/auth-user.type';
import { SystemParamsService } from '../../common/utils/system-params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DemandeStateMachineService } from '../demandes/demande-state-machine.service';
import { DocumentsService } from '../documents/documents.service';
import { StorageService } from '../documents/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeclarePaiementDto, RejectPaiementDto } from './dto/paiement.dto';

@Injectable()
export class PaiementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopePolicy: ScopePolicyService,
    private readonly stateMachine: DemandeStateMachineService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly systemParams: SystemParamsService,
  ) {}

  async listForDemande(user: AuthUser, demandeId: string) {
    const demande = await this.prisma.demandeCertification.findUnique({
      where: { id: demandeId },
      include: {
        ouvrage: true,
        paiements: {
          orderBy: { createdAt: 'desc' },
          include: { recu: true },
        },
      },
    });
    if (!demande) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Demande not found',
      });
    }

    this.scopePolicy.assertCanAccessOuvrage(user, {
      communeId: demande.ouvrage.communeId,
      ownerId: demande.ouvrage.ownerId,
      builderOrgId: demande.ouvrage.builderOrgId,
    });

    const netDue = Math.max(
      0,
      (demande.tarifAmount ?? 0) - demande.subventionAmount,
    );
    return {
      demandeId: demande.id,
      tarifAmount: demande.tarifAmount ?? 0,
      subventionAmount: demande.subventionAmount,
      netDue,
      amountPaid: demande.amountPaid,
      balanceDue: Math.max(0, netDue - demande.amountPaid),
      paiements: demande.paiements,
    };
  }

  async declare(
    user: AuthUser,
    demandeId: string,
    dto: DeclarePaiementDto,
    idempotencyKey?: string,
    ip?: string | null,
  ) {
    if (idempotencyKey) {
      const existingByKey = await this.prisma.paiement.findUnique({
        where: { idempotencyKey },
      });
      if (existingByKey) {
        return existingByKey;
      }
    }

    const demande = await this.prisma.demandeCertification.findUnique({
      where: { id: demandeId },
      include: { ouvrage: true },
    });
    if (!demande) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Demande not found',
      });
    }

    this.scopePolicy.assertCanAccessOuvrage(user, {
      communeId: demande.ouvrage.communeId,
      ownerId: demande.ouvrage.ownerId,
      builderOrgId: demande.ouvrage.builderOrgId,
    });

    const dupRef = await this.prisma.paiement.findUnique({
      where: {
        canal_reference: {
          canal: dto.canal,
          reference: dto.reference.trim(),
        },
      },
    });
    if (dupRef) {
      throw new ConflictException({
        code: 'PAYMENT_DUPLICATE',
        message: 'Payment reference already recorded for this channel',
      });
    }

    const netDue = Math.max(
      0,
      (demande.tarifAmount ?? 0) - demande.subventionAmount,
    );
    const remaining = Math.max(0, netDue - demande.amountPaid);
    if (dto.amount > remaining) {
      throw new ConflictException({
        code: 'PAYMENT_EXCEEDS_BALANCE',
        message: 'Declared payment exceeds remaining balance due',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.paiement.create({
        data: {
          demandeId: demande.id,
          amount: dto.amount,
          canal: dto.canal,
          reference: dto.reference.trim(),
          status: PaiementStatus.DECLARE,
          idempotencyKey: idempotencyKey ?? null,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'PAIEMENT_DECLARED',
        entityType: 'Paiement',
        entityId: created.id,
        after: {
          demandeId: demande.id,
          amount: created.amount,
          canal: created.canal,
        },
        ip,
      });

      return created;
    });
  }

  async confirm(user: AuthUser, paiementId: string, ip?: string | null) {
    const allowedConfirmRoles = await this.systemParams.getJson<Role[]>(
      'paymentConfirmRoles',
      [Role.ADMIN],
    );
    if (!allowedConfirmRoles.includes(user.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Role not configured to confirm payments',
      });
    }

    const paiement = await this.prisma.paiement.findUnique({
      where: { id: paiementId },
      include: {
        demande: {
          include: {
            ouvrage: { include: { owner: true, dossier: true } },
          },
        },
      },
    });
    if (!paiement) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Paiement not found',
      });
    }
    if (paiement.status !== PaiementStatus.DECLARE) {
      throw new ConflictException({
        code: 'PAYMENT_NOT_DECLARE',
        message: 'Only DECLARE payments can be confirmed',
      });
    }

    const minPaidPercent = await this.systemParams.getNumber(
      'minPaidPercentBeforeSampling',
      100,
    );

    return this.prisma.$transaction(async (tx) => {
      const confirmed = await tx.paiement.update({
        where: { id: paiement.id },
        data: {
          status: PaiementStatus.CONFIRME,
          confirmedAt: new Date(),
          confirmedById: user.id,
        },
      });

      const agg = await tx.paiement.aggregate({
        where: {
          demandeId: paiement.demandeId,
          status: PaiementStatus.CONFIRME,
        },
        _sum: { amount: true },
      });
      const totalPaid = agg._sum.amount ?? 0;

      const netDue = Math.max(
        0,
        (paiement.demande.tarifAmount ?? 0) - paiement.demande.subventionAmount,
      );
      if (totalPaid > netDue) {
        throw new ConflictException({
          code: 'PAYMENT_EXCEEDS_BALANCE',
          message: 'Total confirmed payments exceed net amount due',
        });
      }

      const balanceAfter = Math.max(0, netDue - totalPaid);

      await tx.demandeCertification.update({
        where: { id: paiement.demandeId },
        data: { amountPaid: totalPaid },
      });

      const seqRows = await tx.$queryRaw<Array<{ val: bigint }>>`
        SELECT nextval('seq_recu') AS val
      `;
      const year = new Date().getUTCFullYear();
      const seqStr = String(seqRows[0].val).padStart(6, '0');
      const recuNumber = `RC-${year}-${seqStr}`;

      const pdfBuffer = await this.renderReceiptPdf({
        recuNumber,
        demandeReference: paiement.demande.reference,
        ouvrageNumber: paiement.demande.ouvrage.aquasafeNumber,
        amount: confirmed.amount,
        balanceAfter,
        canal: confirmed.canal,
        reference: confirmed.reference,
        issuedAt: new Date(),
      });

      const pdfDoc = await this.documentsService.createFromBuffer(tx, {
        buffer: pdfBuffer,
        kind: DocumentKind.RECU_PDF,
        allowedMimes: ['application/pdf'],
        prefix: 'recus',
        originalName: `${recuNumber}.pdf`,
        uploadedById: user.id,
        ouvrageId: paiement.demande.ouvrageId,
        dossierId: paiement.demande.ouvrage.dossier?.id,
        demandeId: paiement.demandeId,
      });

      const recu = await tx.recu.create({
        data: {
          number: recuNumber,
          paiementId: confirmed.id,
          amount: confirmed.amount,
          balanceAfter,
          documentId: pdfDoc.id,
          issuedById: user.id,
        },
      });

      const paidPct = netDue === 0 ? 100 : (totalPaid * 100) / netDue;
      if (
        paiement.demande.status === DemandeStatus.EN_ATTENTE_PAIEMENT &&
        paidPct >= minPaidPercent
      ) {
        await this.stateMachine.transition(tx, {
          demandeId: paiement.demandeId,
          toStatus: DemandeStatus.PRELEVEMENT_PLANIFIE,
          actorId: user.id,
          actorRole: user.role,
          reason: `Payment threshold met (${paidPct.toFixed(0)}%)`,
          ip,
        });
      }

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'PAIEMENT_CONFIRMED',
        entityType: 'Paiement',
        entityId: confirmed.id,
        after: {
          recuNumber: recu.number,
          amount: confirmed.amount,
          balanceAfter,
        },
        ip,
      });

      if (paiement.demande.ouvrage.owner) {
        await this.notifications.enqueue(tx, {
          userId: paiement.demande.ouvrage.owner.id,
          channel: NotificationChannel.IN_APP,
          recipient: paiement.demande.ouvrage.owner.id,
          templateCode: 'PAIEMENT_CONFIRME',
          payload: {
            recuNumber: recu.number,
            amount: confirmed.amount,
            balanceAfter,
          },
        });
      }

      return recu;
    });
  }

  async reject(
    user: AuthUser,
    paiementId: string,
    dto: RejectPaiementDto,
    ip?: string | null,
  ) {
    const allowedConfirmRoles = await this.systemParams.getJson<Role[]>(
      'paymentConfirmRoles',
      [Role.ADMIN],
    );
    if (!allowedConfirmRoles.includes(user.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Role not configured to reject payments',
      });
    }

    const paiement = await this.prisma.paiement.findUnique({
      where: { id: paiementId },
    });
    if (!paiement) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Paiement not found',
      });
    }
    if (paiement.status !== PaiementStatus.DECLARE) {
      throw new ConflictException({
        code: 'PAYMENT_NOT_DECLARE',
        message: 'Only DECLARE payments can be rejected',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.paiement.update({
        where: { id: paiementId },
        data: {
          status: PaiementStatus.REJETE,
          rejectedReason: dto.reason,
        },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'PAIEMENT_REJECTED',
        entityType: 'Paiement',
        entityId: paiementId,
        reason: dto.reason,
        ip,
      });

      return updated;
    });
  }

  async getReceiptPdfUrl(user: AuthUser, recuId: string) {
    const recu = await this.prisma.recu.findUnique({
      where: { id: recuId },
      include: {
        document: true,
        paiement: {
          include: {
            demande: { include: { ouvrage: true } },
          },
        },
      },
    });
    if (!recu || !recu.document) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Receipt PDF not found',
      });
    }

    this.scopePolicy.assertCanAccessOuvrage(user, {
      communeId: recu.paiement.demande.ouvrage.communeId,
      ownerId: recu.paiement.demande.ouvrage.ownerId,
      builderOrgId: recu.paiement.demande.ouvrage.builderOrgId,
    });

    return this.storage.createSignedDownloadUrl(recu.document.objectKey);
  }

  private async renderReceiptPdf(data: {
    recuNumber: string;
    demandeReference: string;
    ouvrageNumber: string;
    amount: number;
    balanceAfter: number;
    canal: string;
    reference: string;
    issuedAt: Date;
  }): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 420]);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    page.drawText('AQUASAFE CAMEROUN — RECU DE PAIEMENT / PAYMENT RECEIPT', {
      x: 40,
      y: 375,
      size: 13,
      font: fontBold,
      color: rgb(0.05, 0.25, 0.45),
    });
    page.drawText('Pilote en cours de validation', {
      x: 40,
      y: 355,
      size: 10,
      font,
      color: rgb(0.6, 0.2, 0.1),
    });

    const lines = [
      `Recu N° / Receipt No: ${data.recuNumber}`,
      `Date (UTC): ${data.issuedAt.toISOString()}`,
      `Demande / Request: ${data.demandeReference}`,
      `Ouvrage / Water Point: ${data.ouvrageNumber}`,
      `Canal / Channel: ${data.canal}`,
      `Reference transaction: ${data.reference}`,
      `Montant regle / Amount paid: ${data.amount} FCFA`,
      `Solde restant / Remaining balance: ${data.balanceAfter} FCFA`,
    ];

    lines.forEach((line, idx) => {
      page.drawText(line, {
        x: 40,
        y: 310 - idx * 24,
        size: 11,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
    });

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }
}
