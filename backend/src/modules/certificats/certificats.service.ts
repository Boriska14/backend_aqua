import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CertificatStatus,
  DemandeStatus,
  DocumentKind,
  NotificationChannel,
  Prisma,
  QrTokenStatus,
  Role,
  Verdict,
} from '@prisma/client';
import { ScopePolicyService } from '../../common/guards/scope-policy.service';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import { generateBase62Token } from '../../common/utils/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DemandeStateMachineService } from '../demandes/demande-state-machine.service';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OuvrageStatusService } from '../ouvrages/ouvrage-status.service';
import { CertificatPdfService } from './certificat-pdf.service';
import {
  ConfirmPlaqueDto,
  ListCertificatsQueryDto,
  ReasonDto,
} from './dto/certificat.dto';

type PrismaTx = Prisma.TransactionClient | PrismaService;

const LIVE_CERT_STATUSES: CertificatStatus[] = [
  CertificatStatus.EMIS,
  CertificatStatus.ACTIF,
  CertificatStatus.SUSPENDU,
];

@Injectable()
export class CertificatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopePolicy: ScopePolicyService,
    private readonly auditService: AuditService,
    private readonly stateMachine: DemandeStateMachineService,
    private readonly ouvrageStatus: OuvrageStatusService,
    private readonly documentsService: DocumentsService,
    private readonly pdfService: CertificatPdfService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthUser, query: ListCertificatsQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const scopeWhere = this.scopePolicy.certificatWhere(user);

    const expiringBefore = query.expiringInDays
      ? new Date(Date.now() + query.expiringInDays * 24 * 60 * 60 * 1000)
      : null;

    const where: Prisma.CertificatWhereInput = {
      AND: [
        scopeWhere,
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.communeId
            ? { ouvrage: { communeId: query.communeId } }
            : {}),
          ...(expiringBefore
            ? {
                status: CertificatStatus.ACTIF,
                validUntil: { lte: expiringBefore, gte: new Date() },
              }
            : {}),
        },
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.certificat.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip,
        take,
        include: {
          referentiel: { select: { code: true, version: true } },
          ouvrage: {
            select: {
              id: true,
              aquasafeNumber: true,
              name: true,
              communeId: true,
            },
          },
          transitions: { orderBy: { createdAt: 'asc' } },
        },
      }),
      this.prisma.certificat.count({ where }),
    ]);

    return paginate(
      rows.map((c) => this.serializeCertificat(c)),
      total,
      page,
      limit,
    );
  }

  async findOne(user: AuthUser, id: string) {
    const cert = await this.prisma.certificat.findUnique({
      where: { id },
      include: {
        ouvrage: true,
        referentiel: true,
        qrToken: { select: { token: true, status: true, revokedAt: true } },
        transitions: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!cert) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Certificat not found',
      });
    }

    this.scopePolicy.assertCanAccessOuvrage(user, {
      communeId: cert.ouvrage.communeId,
      ownerId: cert.ouvrage.ownerId,
      builderOrgId: cert.ouvrage.builderOrgId,
    });

    return this.serializeCertificat(cert);
  }

  async getPdfBuffer(
    user: AuthUser,
    id: string,
    lang: 'fr' | 'en' = 'fr',
  ): Promise<{ buffer: Buffer; filename: string }> {
    const cert = await this.prisma.certificat.findUnique({
      where: { id },
      include: {
        ouvrage: { include: { commune: true } },
        referentiel: true,
        qrToken: true,
      },
    });
    if (!cert || !cert.qrToken) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Certificat not found',
      });
    }

    this.scopePolicy.assertCanAccessOuvrage(user, {
      communeId: cert.ouvrage.communeId,
      ownerId: cert.ouvrage.ownerId,
      builderOrgId: cert.ouvrage.builderOrgId,
    });

    const buffer = await this.pdfService.render({
      number: cert.number,
      aquasafeNumber: cert.ouvrage.aquasafeNumber,
      ouvrageName: cert.ouvrage.name,
      village: cert.ouvrage.village,
      communeName: cert.ouvrage.commune.name,
      referentiel: `${cert.referentiel.code} ${cert.referentiel.version}`,
      issuedAt: cert.issuedAt,
      validFrom: cert.validFrom ?? cert.issuedAt,
      validUntil: cert.validUntil ?? cert.issuedAt,
      qrToken: cert.qrToken.token,
      lang,
    });

    return { buffer, filename: `${cert.number}.pdf` };
  }

  async issueForDemande(
    tx: PrismaTx,
    params: {
      demandeId: string;
      actorId: string;
      actorRole: Role;
      ip?: string | null;
    },
  ) {
    const demande = await tx.demandeCertification.findUnique({
      where: { id: params.demandeId },
      include: {
        ouvrage: { include: { commune: true, owner: true, dossier: true } },
        prelevements: {
          orderBy: { createdAt: 'desc' },
          include: {
            analyse: {
              include: {
                referentiel: true,
                procesVerbal: true,
              },
            },
          },
        },
        contreAnalyses: {
          orderBy: { createdAt: 'desc' },
          include: {
            newAnalyse: {
              include: {
                referentiel: true,
                procesVerbal: true,
              },
            },
          },
        },
      },
    });

    if (!demande) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Demande not found',
      });
    }
    if (demande.status !== DemandeStatus.EN_VALIDATION_MINEE) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Demande must be in EN_VALIDATION_MINEE state',
      });
    }

    const latestContre = demande.contreAnalyses[0]?.newAnalyse ?? null;
    const latestInit =
      demande.prelevements.map((p) => p.analyse).find((a) => a !== null) ??
      null;
    const qualifyingAnalyse = latestContre ?? latestInit;

    if (
      !qualifyingAnalyse ||
      qualifyingAnalyse.verdict !== Verdict.CONFORME ||
      !qualifyingAnalyse.procesVerbal
    ) {
      throw new ConflictException({
        code: 'CERTIFICAT_NOT_CONFORME',
        message: 'Conforming analysis with signed PV is required',
      });
    }

    const referentiel = qualifyingAnalyse.referentiel;
    if (!referentiel.validityMonths || referentiel.validityMonths <= 0) {
      throw new ConflictException({
        code: 'NORME_MISSING_VALIDITY',
        message: 'Referentiel validityMonths is not configured',
      });
    }

    // Retire/replace existing live certificate if renewing or replacing
    const previousLive = await tx.certificat.findFirst({
      where: {
        ouvrageId: demande.ouvrageId,
        status: { in: LIVE_CERT_STATUSES },
      },
    });
    const previousLatest =
      previousLive ??
      (await tx.certificat.findFirst({
        where: { ouvrageId: demande.ouvrageId },
        orderBy: { issuedAt: 'desc' },
      }));

    if (previousLive) {
      await tx.certificat.update({
        where: { id: previousLive.id },
        data: { status: CertificatStatus.REMPLACE },
      });
      await tx.certificatTransition.create({
        data: {
          certificatId: previousLive.id,
          fromStatus: previousLive.status,
          toStatus: CertificatStatus.REMPLACE,
          reason: `Replaced by renewal demande ${demande.reference}`,
          actorId: params.actorId,
        },
      });
    }

    const seqRows = await tx.$queryRaw<Array<{ val: bigint }>>`
      SELECT nextval('seq_certificat') AS val
    `;
    const now = new Date();
    const year = now.getUTCFullYear();
    const seqStr = String(seqRows[0].val).padStart(6, '0');
    const certNumber = `CC-${year}-${seqStr}`;

    const validFrom = now;
    const validUntil = new Date(validFrom);
    validUntil.setUTCMonth(
      validUntil.getUTCMonth() + referentiel.validityMonths,
    );

    const qrTokenValue = generateBase62Token(16);

    const pdfBuffer = await this.pdfService.render({
      number: certNumber,
      aquasafeNumber: demande.ouvrage.aquasafeNumber,
      ouvrageName: demande.ouvrage.name,
      village: demande.ouvrage.village,
      communeName: demande.ouvrage.commune.name,
      referentiel: `${referentiel.code} ${referentiel.version}`,
      issuedAt: now,
      validFrom,
      validUntil,
      qrToken: qrTokenValue,
      lang: 'fr',
    });

    const pdfDoc = await this.documentsService.createFromBuffer(
      tx as Prisma.TransactionClient,
      {
        buffer: pdfBuffer,
        kind: DocumentKind.CERTIFICAT_PDF,
        allowedMimes: ['application/pdf'],
        prefix: 'certificats',
        originalName: `${certNumber}.pdf`,
        uploadedById: params.actorId,
        ouvrageId: demande.ouvrageId,
        dossierId: demande.ouvrage.dossier?.id,
        demandeId: demande.id,
      },
    );

    const certificat = await tx.certificat.create({
      data: {
        number: certNumber,
        ouvrageId: demande.ouvrageId,
        demandeId: demande.id,
        referentielId: referentiel.id,
        status: CertificatStatus.EMIS,
        issuedAt: now,
        issuedById: params.actorId,
        validFrom,
        validUntil,
        pdfDocumentId: pdfDoc.id,
        qrToken: {
          create: {
            token: qrTokenValue,
            status: QrTokenStatus.ACTIVE,
          },
        },
      },
    });

    if (previousLatest && !previousLatest.replacedById) {
      await tx.certificat.update({
        where: { id: previousLatest.id },
        data: { replacedById: certificat.id },
      });
    }

    await tx.certificatTransition.create({
      data: {
        certificatId: certificat.id,
        fromStatus: null,
        toStatus: CertificatStatus.EMIS,
        reason: `MINEE validation of demande ${demande.reference}`,
        actorId: params.actorId,
      },
    });

    await this.stateMachine.transition(tx, {
      demandeId: demande.id,
      toStatus: DemandeStatus.CERTIFIEE,
      actorId: params.actorId,
      actorRole: params.actorRole,
      ip: params.ip,
    });

    await this.auditService.log(tx, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'CERTIFICAT_ISSUED',
      entityType: 'Certificat',
      entityId: certificat.id,
      after: {
        number: certificat.number,
        ouvrageId: certificat.ouvrageId,
        validUntil: certificat.validUntil,
      },
      ip: params.ip,
    });

    if (demande.ouvrage.owner) {
      await this.notifications.enqueue(tx, {
        userId: demande.ouvrage.owner.id,
        channel: NotificationChannel.IN_APP,
        recipient: demande.ouvrage.owner.id,
        templateCode: 'CERTIFICAT_EMIS',
        payload: {
          certificatNumber: certificat.number,
          ouvrageNumber: demande.ouvrage.aquasafeNumber,
        },
      });
    }

    return certificat;
  }

  async confirmPlaque(
    user: AuthUser,
    id: string,
    dto: ConfirmPlaqueDto,
    ip?: string | null,
  ) {
    const cert = await this.prisma.certificat.findUnique({
      where: { id },
      include: { ouvrage: true },
    });
    if (!cert) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Certificat not found',
      });
    }

    this.scopePolicy.assertCanAccessCommune(user, cert.ouvrage.communeId);

    if (cert.status !== CertificatStatus.EMIS) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Certificate must be in EMIS status to confirm plaque',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.certificat.update({
        where: { id },
        data: {
          status: CertificatStatus.ACTIF,
          plaquePhotoDocId: dto.photoDocumentId ?? null,
          plaqueConfirmedAt: new Date(),
        },
      });

      await tx.certificatTransition.create({
        data: {
          certificatId: id,
          fromStatus: CertificatStatus.EMIS,
          toStatus: CertificatStatus.ACTIF,
          reason: 'Plaque physique posée et confirmée',
          actorId: user.id,
        },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'CERTIFICAT_ACTIVATED',
        entityType: 'Certificat',
        entityId: id,
        before: { status: CertificatStatus.EMIS },
        after: { status: CertificatStatus.ACTIF },
        ip,
      });

      await this.ouvrageStatus.recalculate(tx, cert.ouvrageId);

      return updated;
    });
  }

  async suspend(
    user: AuthUser,
    id: string,
    dto: ReasonDto,
    ip?: string | null,
  ) {
    return this.transitionCertificateState(user, id, {
      allowedFrom: [CertificatStatus.EMIS, CertificatStatus.ACTIF],
      toStatus: CertificatStatus.SUSPENDU,
      qrStatus: QrTokenStatus.REVOKED,
      reason: dto.reason,
      action: 'CERTIFICAT_SUSPENDED',
      ip,
    });
  }

  async reactivate(
    user: AuthUser,
    id: string,
    dto: ReasonDto,
    ip?: string | null,
  ) {
    return this.transitionCertificateState(user, id, {
      allowedFrom: [CertificatStatus.SUSPENDU],
      toStatus: CertificatStatus.ACTIF,
      qrStatus: QrTokenStatus.ACTIVE,
      reason: dto.reason,
      action: 'CERTIFICAT_REACTIVATED',
      ip,
    });
  }

  async withdraw(
    user: AuthUser,
    id: string,
    dto: ReasonDto,
    ip?: string | null,
  ) {
    return this.transitionCertificateState(user, id, {
      allowedFrom: [
        CertificatStatus.EMIS,
        CertificatStatus.ACTIF,
        CertificatStatus.SUSPENDU,
      ],
      toStatus: CertificatStatus.RETIRE,
      qrStatus: QrTokenStatus.REVOKED,
      reason: dto.reason,
      action: 'CERTIFICAT_WITHDRAWN',
      ip,
    });
  }

  private async transitionCertificateState(
    user: AuthUser,
    id: string,
    opts: {
      allowedFrom: CertificatStatus[];
      toStatus: CertificatStatus;
      qrStatus: QrTokenStatus;
      reason: string;
      action: string;
      ip?: string | null;
    },
  ) {
    const cert = await this.prisma.certificat.findUnique({
      where: { id },
      include: { ouvrage: { include: { owner: true } } },
    });
    if (!cert) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Certificat not found',
      });
    }
    if (!opts.allowedFrom.includes(cert.status)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `Cannot transition certificate from ${cert.status} to ${opts.toStatus}`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.certificat.update({
        where: { id },
        data: { status: opts.toStatus },
      });

      await tx.qrToken.updateMany({
        where: { certificatId: id },
        data: {
          status: opts.qrStatus,
          revokedAt:
            opts.qrStatus === QrTokenStatus.REVOKED ? new Date() : null,
        },
      });

      await tx.certificatTransition.create({
        data: {
          certificatId: id,
          fromStatus: cert.status,
          toStatus: opts.toStatus,
          reason: opts.reason,
          actorId: user.id,
        },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: opts.action,
        entityType: 'Certificat',
        entityId: id,
        reason: opts.reason,
        before: { status: cert.status },
        after: { status: opts.toStatus },
        ip: opts.ip,
      });

      await this.ouvrageStatus.recalculate(tx, cert.ouvrageId);

      if (cert.ouvrage.owner) {
        await this.notifications.enqueue(tx, {
          userId: cert.ouvrage.owner.id,
          channel: NotificationChannel.IN_APP,
          recipient: cert.ouvrage.owner.id,
          templateCode: opts.action,
          payload: {
            certificatNumber: cert.number,
            reason: opts.reason,
          },
        });
      }

      return updated;
    });
  }

  private serializeCertificat(c: {
    id: string;
    number: string;
    status: CertificatStatus;
    issuedAt: Date;
    validFrom: Date | null;
    validUntil: Date | null;
    referentiel?: { code: string; version: string };
    transitions?: Array<{
      fromStatus: CertificatStatus | null;
      toStatus: CertificatStatus;
      reason: string;
      actorId: string | null;
      createdAt: Date;
    }>;
  }) {
    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    const expiringSoon =
      c.status === CertificatStatus.ACTIF &&
      c.validUntil !== null &&
      c.validUntil.getTime() - Date.now() <= sixtyDaysMs &&
      c.validUntil.getTime() >= Date.now();

    return {
      id: c.id,
      number: c.number,
      status: c.status,
      issuedAt: c.issuedAt,
      validFrom: c.validFrom ? c.validFrom.toISOString().slice(0, 10) : null,
      validUntil: c.validUntil ? c.validUntil.toISOString().slice(0, 10) : null,
      expiringSoon,
      referentiel: c.referentiel
        ? `${c.referentiel.code} ${c.referentiel.version}`
        : undefined,
      ...(c.transitions
        ? {
            transitions: c.transitions.map((t) => ({
              from: t.fromStatus,
              to: t.toStatus,
              reason: t.reason,
              actor: t.actorId ?? 'SYSTEM',
              at: t.createdAt,
            })),
          }
        : {}),
    };
  }
}
