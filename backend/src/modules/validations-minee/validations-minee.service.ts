import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DemandeStatus, NotificationChannel, Role } from '@prisma/client';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CertificatsService } from '../certificats/certificats.service';
import { DemandeStateMachineService } from '../demandes/demande-state-machine.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  BatchValidateMineeDto,
  CreateDelegationDto,
  MineeDecisionChoice,
} from './dto/validation-minee.dto';

@Injectable()
export class ValidationsMineeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly certificatsService: CertificatsService,
    private readonly stateMachine: DemandeStateMachineService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async listQueue(user: AuthUser, query: PageQueryDto) {
    await this.assertCanValidateMinee(user);

    const { skip, take, page, limit } = getPaginationParams(query);
    const where = { status: DemandeStatus.EN_VALIDATION_MINEE };

    const [rows, total] = await Promise.all([
      this.prisma.demandeCertification.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        skip,
        take,
        include: {
          ouvrage: {
            select: {
              id: true,
              aquasafeNumber: true,
              name: true,
              communeId: true,
            },
          },
          prelevements: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { analyse: { include: { procesVerbal: true } } },
          },
        },
      }),
      this.prisma.demandeCertification.count({ where }),
    ]);

    return paginate(rows, total, page, limit);
  }

  async batchValidate(
    user: AuthUser,
    dto: BatchValidateMineeDto,
    ip?: string | null,
  ) {
    await this.assertCanValidateMinee(user);

    const results: Array<{
      demandeId: string;
      status: 'OK' | 'ERROR';
      certificatId?: string;
      certificatNumber?: string;
      error?: string;
    }> = [];

    for (const item of dto.decisions) {
      try {
        if (item.decision === MineeDecisionChoice.REJETER) {
          if (!item.reason) {
            throw new BadRequestException('Rejection reason is required');
          }
          await this.prisma.$transaction(async (tx) => {
            const d = await this.stateMachine.transition(tx, {
              demandeId: item.demandeId,
              toStatus: DemandeStatus.REJETEE,
              actorId: user.id,
              actorRole: user.role,
              reason: item.reason,
              ip,
              extraData: { rejectedReason: item.reason },
            });
            const ouvrage = await tx.ouvrage.findUnique({
              where: { id: d.ouvrageId },
            });
            if (ouvrage?.ownerId) {
              await this.notifications.enqueue(tx, {
                userId: ouvrage.ownerId,
                channel: NotificationChannel.IN_APP,
                recipient: ouvrage.ownerId,
                templateCode: 'DEMANDE_REJETEE_MINEE',
                payload: { reference: d.reference, reason: item.reason },
              });
            }
          });
          results.push({ demandeId: item.demandeId, status: 'OK' });
        } else {
          const cert = await this.prisma.$transaction((tx) =>
            this.certificatsService.issueForDemande(tx, {
              demandeId: item.demandeId,
              actorId: user.id,
              actorRole: user.role,
              ip,
            }),
          );
          results.push({
            demandeId: item.demandeId,
            status: 'OK',
            certificatId: cert.id,
            certificatNumber: cert.number,
          });
        }
      } catch (err) {
        results.push({
          demandeId: item.demandeId,
          status: 'ERROR',
          error: err instanceof Error ? err.message : 'Validation failed',
        });
      }
    }

    return { results };
  }

  async listDelegations() {
    return this.prisma.delegationValidation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        delegator: { select: { id: true, fullName: true } },
        delegue: { select: { id: true, fullName: true, role: true } },
      },
    });
  }

  async createDelegation(
    actor: AuthUser,
    dto: CreateDelegationDto,
    ip?: string | null,
  ) {
    const validFrom = new Date(dto.validFrom);
    const validUntil = new Date(dto.validUntil);
    if (validUntil <= validFrom) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'validUntil must be after validFrom',
      });
    }

    const delegue = await this.prisma.user.findUnique({
      where: { id: dto.delegueId },
    });
    if (!delegue) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Delegate user not found',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const delegation = await tx.delegationValidation.create({
        data: {
          delegatorId: actor.id,
          delegueId: dto.delegueId,
          validFrom,
          validUntil,
          reason: dto.reason,
        },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'MINEE_DELEGATION_CREATED',
        entityType: 'DelegationValidation',
        entityId: delegation.id,
        reason: dto.reason,
        after: {
          delegueId: dto.delegueId,
          validFrom,
          validUntil,
        },
        ip,
      });

      return delegation;
    });
  }

  async revokeDelegation(actor: AuthUser, id: string, ip?: string | null) {
    const delegation = await this.prisma.delegationValidation.findUnique({
      where: { id },
    });
    if (!delegation) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Delegation not found',
      });
    }
    if (delegation.revokedAt) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Delegation already revoked',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.delegationValidation.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'MINEE_DELEGATION_REVOKED',
        entityType: 'DelegationValidation',
        entityId: id,
        ip,
      });
    });
  }

  private async assertCanValidateMinee(user: AuthUser): Promise<void> {
    if (user.role === Role.MINEE) {
      return;
    }
    const now = new Date();
    const activeDelegation = await this.prisma.delegationValidation.findFirst({
      where: {
        delegueId: user.id,
        revokedAt: null,
        validFrom: { lte: now },
        validUntil: { gte: now },
      },
    });
    if (!activeDelegation) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'MINEE role or active validation delegation required',
      });
    }
  }
}
