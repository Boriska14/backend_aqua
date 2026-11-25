import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContreAnalyseStatus,
  DemandeStatus,
  DocumentKind,
  PrelevementStatus,
  Prisma,
  SyncOutcome,
} from '@prisma/client';
import sharp from 'sharp';
import { ScopePolicyService } from '../../common/guards/scope-policy.service';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DemandeStateMachineService } from '../demandes/demande-state-machine.service';
import { DocumentsService } from '../documents/documents.service';
import {
  CreatePrelevementDto,
  ListPrelevementsQueryDto,
  ReceptionPrelevementDto,
  SyncPrelevementsDto,
} from './dto/prelevement.dto';

const MAX_PHOTO_WEBP_BYTES = 200 * 1024;

@Injectable()
export class PrelevementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopePolicy: ScopePolicyService,
    private readonly stateMachine: DemandeStateMachineService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
  ) {}

  async list(user: AuthUser, query: ListPrelevementsQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const scopeWhere = this.scopePolicy.prelevementWhere(user);

    const where: Prisma.PrelevementWhereInput = {
      AND: [scopeWhere, { ...(query.status ? { status: query.status } : {}) }],
    };

    const [rows, total] = await Promise.all([
      this.prisma.prelevement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          demande: {
            select: {
              id: true,
              reference: true,
              status: true,
              ouvrageId: true,
            },
          },
        },
      }),
      this.prisma.prelevement.count({ where }),
    ]);

    return paginate(rows, total, page, limit);
  }

  async create(user: AuthUser, dto: CreatePrelevementDto, ip?: string | null) {
    this.assertAgentHabilitated(user);

    const existing = await this.prisma.prelevement.findUnique({
      where: { clientUuid: dto.clientUuid },
    });
    if (existing) {
      return existing;
    }

    const demande = await this.prisma.demandeCertification.findUnique({
      where: { id: dto.demandeId },
      include: {
        ouvrage: true,
        contreAnalyses: {
          where: { status: ContreAnalyseStatus.OUVERTE },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!demande) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Demande not found',
      });
    }

    if (!this.scopePolicy.hasCommune(user, demande.ouvrage.communeId)) {
      throw new ForbiddenException({
        code: 'AGENT_OUT_OF_SCOPE',
        message: 'Ouvrage commune is outside agent scope',
      });
    }

    const isCounterAnalysis =
      demande.status === DemandeStatus.EN_CONTRE_ANALYSE &&
      demande.contreAnalyses.length > 0 &&
      !demande.contreAnalyses[0].newPrelevementId;

    if (
      demande.status !== DemandeStatus.PRELEVEMENT_PLANIFIE &&
      !isCounterAnalysis
    ) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Demande is not awaiting sampling',
      });
    }

    const targetLabId = isCounterAnalysis
      ? (demande.contreAnalyses[0].laboratoireId ?? demande.laboratoireId)
      : demande.laboratoireId;
    if (!targetLabId) {
      throw new ConflictException({
        code: 'LABO_REQUIRED',
        message: 'No laboratory assigned to demande',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const prelevement = await tx.prelevement.create({
        data: {
          clientUuid: dto.clientUuid,
          demandeId: demande.id,
          agentId: user.id,
          laboratoireId: targetLabId,
          bottleCode: dto.bottleCode.trim(),
          collectedAt: new Date(dto.collectedAt),
          latitude: dto.latitude,
          longitude: dto.longitude,
          gpsAccuracyM: dto.gpsAccuracyM ?? null,
          waterTempC: dto.waterTempC ?? null,
          transportTempC: dto.transportTempC ?? null,
          transportNotes: dto.transportNotes ?? null,
          status: PrelevementStatus.REALISE,
        },
      });

      if (isCounterAnalysis) {
        await tx.contreAnalyse.update({
          where: { id: demande.contreAnalyses[0].id },
          data: {
            newPrelevementId: prelevement.id,
            status: ContreAnalyseStatus.EN_COURS,
          },
        });
      } else {
        await this.stateMachine.transition(tx, {
          demandeId: demande.id,
          toStatus: DemandeStatus.PRELEVE,
          actorId: user.id,
          actorRole: user.role,
          ip,
        });
      }

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'PRELEVEMENT_RECORDED',
        entityType: 'Prelevement',
        entityId: prelevement.id,
        after: {
          demandeId: demande.id,
          clientUuid: dto.clientUuid,
          clientCollectedAt: dto.collectedAt,
        },
        ip,
      });

      return prelevement;
    });
  }

  async syncBatch(
    user: AuthUser,
    dto: SyncPrelevementsDto,
    ip?: string | null,
  ) {
    const results: Array<{
      clientUuid: string;
      outcome: SyncOutcome;
      prelevementId?: string;
      message?: string;
    }> = [];

    for (const item of dto.items) {
      const existingPrelevement = await this.prisma.prelevement.findUnique({
        where: { clientUuid: item.clientUuid },
      });
      if (existingPrelevement) {
        results.push({
          clientUuid: item.clientUuid,
          outcome: SyncOutcome.DUPLICATE,
          prelevementId: existingPrelevement.id,
        });
        continue;
      }

      const existingQueue = await this.prisma.prelevementSyncQueue.findUnique({
        where: { clientUuid: item.clientUuid },
      });
      if (existingQueue) {
        results.push({
          clientUuid: item.clientUuid,
          outcome: SyncOutcome.DUPLICATE,
          message: 'Already processed in sync queue',
        });
        continue;
      }

      if (!this.isAgentHabilitated(user)) {
        results.push({
          clientUuid: item.clientUuid,
          outcome: SyncOutcome.REJECTED,
          message: 'Agent accreditation expired or missing',
        });
        continue;
      }

      const demande = await this.prisma.demandeCertification.findUnique({
        where: { id: item.demandeId },
        include: { ouvrage: true },
      });
      if (!demande) {
        results.push({
          clientUuid: item.clientUuid,
          outcome: SyncOutcome.REJECTED,
          message: 'Demande not found',
        });
        continue;
      }

      if (!this.scopePolicy.hasCommune(user, demande.ouvrage.communeId)) {
        results.push({
          clientUuid: item.clientUuid,
          outcome: SyncOutcome.REJECTED,
          message: 'Ouvrage commune outside agent scope',
        });
        continue;
      }

      if (demande.status !== DemandeStatus.PRELEVEMENT_PLANIFIE) {
        // Preserve conflict in PrelevementSyncQueue instead of losing or blindly applying
        await this.prisma.$transaction(async (tx) => {
          await tx.prelevementSyncQueue.create({
            data: {
              clientUuid: item.clientUuid,
              demandeId: demande.id,
              agentId: user.id,
              payload: item as unknown as Prisma.InputJsonValue,
              clientTs: new Date(item.collectedAt),
              outcome: SyncOutcome.CONFLICT,
              conflictInfo: {
                currentDemandeStatus: demande.status,
                reason: 'Demande status changed since offline capture',
              },
            },
          });
          await this.auditService.log(tx, {
            actorId: user.id,
            actorRole: user.role,
            action: 'PRELEVEMENT_SYNC_CONFLICT',
            entityType: 'DemandeCertification',
            entityId: demande.id,
            after: {
              clientUuid: item.clientUuid,
              demandeStatus: demande.status,
            },
            ip,
          });
        });

        results.push({
          clientUuid: item.clientUuid,
          outcome: SyncOutcome.CONFLICT,
          message: `Demande state is ${demande.status}`,
        });
        continue;
      }

      try {
        const created = await this.create(user, item, ip);
        await this.prisma.prelevementSyncQueue.create({
          data: {
            clientUuid: item.clientUuid,
            demandeId: demande.id,
            agentId: user.id,
            payload: item as unknown as Prisma.InputJsonValue,
            clientTs: new Date(item.collectedAt),
            outcome: SyncOutcome.APPLIED,
            resolvedAt: new Date(),
          },
        });
        results.push({
          clientUuid: item.clientUuid,
          outcome: SyncOutcome.APPLIED,
          prelevementId: created.id,
        });
      } catch (err) {
        results.push({
          clientUuid: item.clientUuid,
          outcome: SyncOutcome.REJECTED,
          message: err instanceof Error ? err.message : 'Rejected',
        });
      }
    }

    return { results };
  }

  async uploadPhoto(
    user: AuthUser,
    prelevementId: string,
    file: Express.Multer.File,
    ip?: string | null,
  ) {
    this.documentsService.validateFilePresent(file);

    const prelevement = await this.prisma.prelevement.findUnique({
      where: { id: prelevementId },
      include: {
        demande: { include: { ouvrage: { include: { dossier: true } } } },
      },
    });
    if (!prelevement) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Prelevement not found',
      });
    }
    if (prelevement.agentId !== user.id) {
      this.scopePolicy.deny();
    }

    let webpBuffer = await sharp(file.buffer)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    if (webpBuffer.length > MAX_PHOTO_WEBP_BYTES) {
      webpBuffer = await sharp(file.buffer)
        .rotate()
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 60 })
        .toBuffer();
    }

    if (webpBuffer.length > MAX_PHOTO_WEBP_BYTES) {
      webpBuffer = await sharp(file.buffer)
        .rotate()
        .resize({ width: 900, withoutEnlargement: true })
        .webp({ quality: 45 })
        .toBuffer();
    }

    return this.prisma.$transaction(async (tx) => {
      const doc = await this.documentsService.createFromBuffer(tx, {
        buffer: webpBuffer,
        kind: DocumentKind.PHOTO_PRELEVEMENT,
        allowedMimes: ['image/webp'],
        prefix: 'prelevements',
        maxBytes: MAX_PHOTO_WEBP_BYTES,
        originalName: `${prelevement.bottleCode}.webp`,
        uploadedById: user.id,
        ouvrageId: prelevement.demande.ouvrageId,
        dossierId: prelevement.demande.ouvrage.dossier?.id,
        demandeId: prelevement.demandeId,
        prelevementId: prelevement.id,
      });

      await tx.prelevement.update({
        where: { id: prelevement.id },
        data: { photoDocumentId: doc.id },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'PRELEVEMENT_PHOTO_UPLOADED',
        entityType: 'Prelevement',
        entityId: prelevement.id,
        after: { documentId: doc.id, sizeBytes: doc.sizeBytes },
        ip,
      });

      return doc;
    });
  }

  async reception(
    user: AuthUser,
    prelevementId: string,
    dto: ReceptionPrelevementDto,
    ip?: string | null,
  ) {
    const prelevement = await this.prisma.prelevement.findUnique({
      where: { id: prelevementId },
      include: { demande: true },
    });
    if (!prelevement) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Prelevement not found',
      });
    }

    this.scopePolicy.assertCanAccessLabo(user, prelevement.laboratoireId);

    if (
      prelevement.status === PrelevementStatus.RECU_LABO ||
      prelevement.status === PrelevementStatus.REJETE_LABO
    ) {
      throw new ConflictException({
        code: 'PRELEVEMENT_ALREADY_RECEIVED',
        message: 'Prelevement reception already recorded',
      });
    }

    if (!dto.accepted && !dto.reason) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Rejection reason is required when bottle is rejected',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.prelevement.update({
        where: { id: prelevement.id },
        data: {
          status: dto.accepted
            ? PrelevementStatus.RECU_LABO
            : PrelevementStatus.REJETE_LABO,
          receivedAt: new Date(),
          rejectionReason: dto.accepted ? null : dto.reason,
        },
      });

      if (prelevement.demande.status === DemandeStatus.PRELEVE) {
        await this.stateMachine.transition(tx, {
          demandeId: prelevement.demandeId,
          toStatus: dto.accepted
            ? DemandeStatus.EN_ANALYSE
            : DemandeStatus.PRELEVEMENT_PLANIFIE,
          actorId: user.id,
          actorRole: user.role,
          reason: dto.reason ?? 'Laboratory reception',
          ip,
        });
      }

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: dto.accepted
          ? 'PRELEVEMENT_RECU_LABO'
          : 'PRELEVEMENT_REJETE_LABO',
        entityType: 'Prelevement',
        entityId: prelevement.id,
        reason: dto.reason ?? null,
        ip,
      });

      return updated;
    });
  }

  private isAgentHabilitated(user: AuthUser): boolean {
    if (!user.habilitationUntil) {
      return false;
    }
    return new Date(user.habilitationUntil) > new Date();
  }

  private assertAgentHabilitated(user: AuthUser): void {
    if (!this.isAgentHabilitated(user)) {
      throw new ForbiddenException({
        code: 'AGENT_NOT_HABILITATED',
        message: 'Sampling agent accreditation is missing or expired',
      });
    }
  }
}
