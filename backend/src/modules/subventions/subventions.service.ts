import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DemandeStatus,
  NotificationChannel,
  Prisma,
  Role,
  SubventionStatus,
} from '@prisma/client';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { ScopePolicyService } from '../../common/guards/scope-policy.service';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DemandeStateMachineService } from '../demandes/demande-state-machine.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CommuneSubventionDecisionDto,
  CreateEnveloppeDto,
  CreateSubventionDto,
  MineeSubventionDecisionDto,
} from './dto/subvention.dto';

@Injectable()
export class SubventionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopePolicy: ScopePolicyService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly demandeStateMachine: DemandeStateMachineService,
  ) {}

  async list(user: AuthUser, query: PageQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const where: Prisma.SubventionWhereInput =
      this.scopePolicy.subventionWhere(user);

    const [rows, total] = await Promise.all([
      this.prisma.subvention.findMany({
        where,
        include: {
          demande: {
            select: {
              id: true,
              reference: true,
              status: true,
              tarifAmount: true,
              subventionAmount: true,
              ouvrage: {
                select: {
                  id: true,
                  aquasafeNumber: true,
                  name: true,
                  communeId: true,
                },
              },
            },
          },
          enveloppe: { select: { id: true, financeur: true } },
          justificatifs: {
            select: {
              id: true,
              kind: true,
              originalName: true,
              sizeBytes: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.subvention.count({ where }),
    ]);

    return paginate(rows, total, page, limit);
  }

  async create(dto: CreateSubventionDto, actor: AuthUser, ip?: string | null) {
    const demande = await this.prisma.demandeCertification.findUnique({
      where: { id: dto.demandeId },
      include: {
        ouvrage: true,
        subvention: true,
      },
    });
    if (!demande) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Demande not found',
      });
    }

    this.scopePolicy.assertCanAccessOuvrage(actor, {
      communeId: demande.ouvrage.communeId,
      ownerId: demande.ouvrage.ownerId,
      builderOrgId: demande.ouvrage.builderOrgId,
    });

    if (demande.subvention) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'A subsidy request already exists for this demande',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.subvention.create({
        data: {
          demandeId: demande.id,
          status: SubventionStatus.SOUMISE,
        },
      });

      if (
        dto.justificatifDocumentIds &&
        dto.justificatifDocumentIds.length > 0
      ) {
        await tx.document.updateMany({
          where: {
            id: { in: dto.justificatifDocumentIds },
            OR: [
              { uploadedById: actor.id },
              { ouvrageId: demande.ouvrageId },
              { demandeId: demande.id },
            ],
          },
          data: { subventionId: created.id },
        });
      }

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'SUBVENTION_SUBMITTED',
        entityType: 'Subvention',
        entityId: created.id,
        after: { demandeId: demande.id, status: created.status },
        ip,
      });

      return created;
    });
  }

  async communeDecision(
    id: string,
    dto: CommuneSubventionDecisionDto,
    actor: AuthUser,
    ip?: string | null,
  ) {
    const sub = await this.prisma.subvention.findUnique({
      where: { id },
      include: { demande: { include: { ouvrage: true } } },
    });
    if (!sub) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Subvention not found',
      });
    }

    this.scopePolicy.assertCanAccessCommune(
      actor,
      sub.demande.ouvrage.communeId,
    );

    if (sub.status !== SubventionStatus.SOUMISE) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Subvention is not in SOUMISE status',
      });
    }

    const nextStatus = dto.eligible
      ? SubventionStatus.ELIGIBLE_COMMUNE
      : SubventionStatus.NON_ELIGIBLE_COMMUNE;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.subvention.update({
        where: { id },
        data: {
          status: nextStatus,
          eligible: dto.eligible,
          criterion: dto.criterion ?? null,
          communeNote: dto.note ?? null,
        },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: `SUBVENTION_${nextStatus}`,
        entityType: 'Subvention',
        entityId: id,
        before: { status: sub.status },
        after: {
          status: nextStatus,
          eligible: dto.eligible,
          criterion: dto.criterion ?? null,
        },
        ip,
      });

      return updated;
    });
  }

  async mineeDecision(
    id: string,
    dto: MineeSubventionDecisionDto,
    actor: AuthUser,
    ip?: string | null,
  ) {
    const sub = await this.prisma.subvention.findUnique({
      where: { id },
      include: {
        demande: {
          include: {
            ouvrage: true,
            applicant: { select: { id: true, phone: true, email: true } },
          },
        },
      },
    });
    if (!sub) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Subvention not found',
      });
    }

    if (
      sub.status !== SubventionStatus.ELIGIBLE_COMMUNE &&
      sub.status !== SubventionStatus.SOUMISE
    ) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Subvention has already been decided',
      });
    }

    if (!dto.accorder) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.subvention.update({
          where: { id },
          data: {
            status: SubventionStatus.REFUSEE,
            amount: 0,
            mineeReason: dto.reason ?? null,
            decidedAt: new Date(),
          },
        });

        await this.auditService.log(tx, {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'SUBVENTION_REFUSEE',
          entityType: 'Subvention',
          entityId: id,
          reason: dto.reason ?? null,
          before: { status: sub.status },
          after: { status: SubventionStatus.REFUSEE },
          ip,
        });

        if (sub.demande.applicant) {
          await this.notificationsService.enqueue(tx, {
            userId: sub.demande.applicant.id,
            channel: NotificationChannel.IN_APP,
            recipient: sub.demande.applicant.id,
            templateCode: 'SUBVENTION_REFUSEE',
            payload: {
              demandeReference: sub.demande.reference,
              reason: dto.reason ?? '',
            },
          });
        }

        return updated;
      });
    }

    if (!dto.enveloppeId || !dto.amount || dto.amount <= 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          'enveloppeId and positive amount are required when granting a subsidy',
      });
    }

    const grantedAmount = dto.amount;
    if (
      sub.demande.tarifAmount !== null &&
      grantedAmount > sub.demande.tarifAmount
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Subsidy amount cannot exceed demand tariff amount',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const enveloppe = await tx.enveloppeSubvention.findUnique({
        where: { id: dto.enveloppeId },
      });
      if (!enveloppe) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Subsidy envelope not found',
        });
      }

      if (
        enveloppe.communeId !== null &&
        enveloppe.communeId !== sub.demande.ouvrage.communeId
      ) {
        throw new ConflictException({
          code: 'FORBIDDEN_SCOPE',
          message: 'Envelope is restricted to a different municipality',
        });
      }

      // Atomic conditional increment to prevent overdraft under concurrency
      const debited = await tx.$executeRaw`
        UPDATE enveloppes_subvention
        SET consumed = consumed + ${grantedAmount}, "updatedAt" = NOW()
        WHERE id = ${enveloppe.id}
          AND (total - consumed) >= ${grantedAmount}
      `;
      if (debited === 0) {
        throw new ConflictException({
          code: 'SUBVENTION_INSUFFICIENT_ENVELOPPE',
          message: 'Insufficient balance in selected subsidy envelope',
        });
      }

      const updatedSub = await tx.subvention.update({
        where: { id },
        data: {
          status: SubventionStatus.ACCORDEE,
          enveloppeId: enveloppe.id,
          amount: grantedAmount,
          mineeReason: dto.reason ?? null,
          decidedAt: new Date(),
        },
      });

      await tx.demandeCertification.update({
        where: { id: sub.demandeId },
        data: { subventionAmount: grantedAmount },
      });

      // If demande is awaiting payment and net due is now <= 0, unlock sampling directly
      if (
        sub.demande.status === DemandeStatus.EN_ATTENTE_PAIEMENT &&
        sub.demande.tarifAmount !== null
      ) {
        const netRemaining =
          sub.demande.tarifAmount - grantedAmount - sub.demande.amountPaid;
        if (netRemaining <= 0) {
          await this.demandeStateMachine.transition(tx, {
            demandeId: sub.demandeId,
            toStatus: DemandeStatus.PRELEVEMENT_PLANIFIE,
            actorId: actor.id,
            actorRole: actor.role,
            reason: 'Covered by granted subsidy',
            ip,
          });
        }
      }

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'SUBVENTION_ACCORDEE',
        entityType: 'Subvention',
        entityId: id,
        reason: dto.reason ?? null,
        before: { status: sub.status },
        after: {
          status: SubventionStatus.ACCORDEE,
          enveloppeId: enveloppe.id,
          amount: grantedAmount,
        },
        ip,
      });

      if (sub.demande.applicant) {
        await this.notificationsService.enqueue(tx, {
          userId: sub.demande.applicant.id,
          channel: NotificationChannel.IN_APP,
          recipient: sub.demande.applicant.id,
          templateCode: 'SUBVENTION_ACCORDEE',
          payload: {
            demandeReference: sub.demande.reference,
            amount: grantedAmount,
          },
        });
      }

      return updatedSub;
    });
  }

  async listEnveloppes(user: AuthUser, query: PageQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const where: Prisma.EnveloppeSubventionWhereInput =
      user.role === Role.AGENT_COMMUNAL
        ? {
            OR: [
              { communeId: { in: user.communeScopeIds } },
              { communeId: null },
            ],
          }
        : {};

    const [rows, total] = await Promise.all([
      this.prisma.enveloppeSubvention.findMany({
        where,
        include: { commune: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.enveloppeSubvention.count({ where }),
    ]);

    return paginate(
      rows.map((e) => ({
        ...e,
        remaining: e.total - e.consumed,
      })),
      total,
      page,
      limit,
    );
  }

  async createEnveloppe(
    dto: CreateEnveloppeDto,
    actor: AuthUser,
    ip?: string | null,
  ) {
    if (dto.communeId) {
      const commune = await this.prisma.commune.findUnique({
        where: { id: dto.communeId },
      });
      if (!commune) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Unknown communeId',
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.enveloppeSubvention.create({
        data: {
          financeur: dto.financeur,
          total: dto.total,
          communeId: dto.communeId ?? null,
        },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'ENVELOPPE_SUBVENTION_CREATED',
        entityType: 'EnveloppeSubvention',
        entityId: created.id,
        after: {
          financeur: created.financeur,
          total: created.total,
          communeId: created.communeId,
        },
        ip,
      });

      return created;
    });
  }
}
