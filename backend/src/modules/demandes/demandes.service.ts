import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DemandeStatus,
  DemandeType,
  NotificationChannel,
  Prisma,
} from '@prisma/client';
import { ScopePolicyService } from '../../common/guards/scope-policy.service';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import { SystemParamsService } from '../../common/utils/system-params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OuvrageStatusService } from '../ouvrages/ouvrage-status.service';
import { TarifsService } from '../tarifs/tarifs.service';
import {
  computeDemandeStep,
  DEMANDE_TERMINAL_STATUSES,
  DemandeStateMachineService,
} from './demande-state-machine.service';
import {
  CommuneDecision,
  CommuneValidationDto,
  CreateContreAnalyseDto,
  CreateDemandeDto,
  ListDemandesQueryDto,
  SubmitDemandeDto,
} from './dto/demande.dto';

@Injectable()
export class DemandesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopePolicy: ScopePolicyService,
    private readonly stateMachine: DemandeStateMachineService,
    private readonly tarifsService: TarifsService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ouvrageStatus: OuvrageStatusService,
    private readonly systemParams: SystemParamsService,
  ) {}

  async list(user: AuthUser, query: ListDemandesQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const scopeWhere = this.scopePolicy.demandeWhere(user);

    const where: Prisma.DemandeCertificationWhereInput = {
      AND: [
        scopeWhere,
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.ouvrageId ? { ouvrageId: query.ouvrageId } : {}),
        },
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.demandeCertification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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
        },
      }),
      this.prisma.demandeCertification.count({ where }),
    ]);

    return paginate(
      rows.map((d) => this.serializeDemande(d)),
      total,
      page,
      limit,
    );
  }

  async findOne(user: AuthUser, id: string) {
    const demande = await this.prisma.demandeCertification.findUnique({
      where: { id },
      include: {
        ouvrage: true,
        transitions: { orderBy: { createdAt: 'asc' } },
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
      demandeLabIds: [demande.laboratoireId],
    });

    return {
      ...this.serializeDemande(demande),
      history: demande.transitions.map((t) => ({
        at: t.createdAt,
        from: t.fromStatus,
        to: t.toStatus,
        actor: t.actorId ?? 'SYSTEM',
      })),
    };
  }

  async create(user: AuthUser, dto: CreateDemandeDto, ip?: string | null) {
    const ouvrage = await this.prisma.ouvrage.findUnique({
      where: { id: dto.ouvrageId },
    });
    if (!ouvrage) {
      throw new NotFoundException({
        code: 'OUVRAGE_NOT_FOUND',
        message: 'Ouvrage not found',
      });
    }

    this.scopePolicy.assertCanAccessOuvrage(user, {
      communeId: ouvrage.communeId,
      ownerId: ouvrage.ownerId,
      builderOrgId: ouvrage.builderOrgId,
    });

    const activeExisting = await this.prisma.demandeCertification.findFirst({
      where: {
        ouvrageId: dto.ouvrageId,
        status: { notIn: DEMANDE_TERMINAL_STATUSES },
      },
    });
    if (activeExisting) {
      throw new ConflictException({
        code: 'DEMANDE_ACTIVE_EXISTS',
        message:
          'An active certification request already exists for this water point',
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const seqRows = await tx.$queryRaw<Array<{ val: bigint }>>`
        SELECT nextval('seq_demande') AS val
      `;
      const year = new Date().getUTCFullYear();
      const seqStr = String(seqRows[0].val).padStart(6, '0');
      const reference = `DC-${year}-${seqStr}`;

      const demande = await tx.demandeCertification.create({
        data: {
          reference,
          ouvrageId: ouvrage.id,
          type: dto.type ?? DemandeType.INITIALE,
          status: DemandeStatus.BROUILLON,
          applicantId: user.id,
        },
      });

      await tx.demandeTransition.create({
        data: {
          demandeId: demande.id,
          fromStatus: null,
          toStatus: DemandeStatus.BROUILLON,
          actorId: user.id,
        },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'DEMANDE_CREATED',
        entityType: 'DemandeCertification',
        entityId: demande.id,
        after: { reference: demande.reference, ouvrageId: ouvrage.id },
        ip,
      });

      await this.ouvrageStatus.recalculate(tx, ouvrage.id);

      return demande;
    });

    return this.serializeDemande(created);
  }

  async submit(
    user: AuthUser,
    id: string,
    dto: SubmitDemandeDto,
    ip?: string | null,
  ) {
    const demande = await this.prisma.demandeCertification.findUnique({
      where: { id },
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

    if (
      !demande.ouvrage.name ||
      !demande.ouvrage.communeId ||
      !Number.isFinite(demande.ouvrage.latitude) ||
      !Number.isFinite(demande.ouvrage.longitude)
    ) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Ouvrage sheet is incomplete',
      });
    }

    const labo = await this.prisma.laboratoire.findUnique({
      where: { id: dto.laboratoireId },
    });
    if (!labo || !labo.isReferenced) {
      throw new ConflictException({
        code: 'LABO_REQUIRED',
        message: 'A referenced laboratory must be selected',
      });
    }

    const { ligne } = await this.tarifsService.resolveActiveLigne(
      demande.ouvrage.type,
      demande.ouvrage.usage,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      return this.stateMachine.transition(tx, {
        demandeId: id,
        toStatus: DemandeStatus.SOUMISE,
        actorId: user.id,
        actorRole: user.role,
        ip,
        extraData: {
          laboratoire: { connect: { id: labo.id } },
          grilleLigne: { connect: { id: ligne.id } },
          tarifAmount: ligne.amount,
          submittedAt: new Date(),
        },
      });
    });

    return this.serializeDemande(updated);
  }

  async communeValidation(
    user: AuthUser,
    id: string,
    dto: CommuneValidationDto,
    ip?: string | null,
  ) {
    const demande = await this.prisma.demandeCertification.findUnique({
      where: { id },
      include: { ouvrage: { include: { owner: true } } },
    });
    if (!demande) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Demande not found',
      });
    }

    this.scopePolicy.assertCanAccessCommune(user, demande.ouvrage.communeId);

    if (dto.decision === CommuneDecision.REJETER && !dto.reason) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Rejection reason is required',
      });
    }

    const minPaidPercent = await this.systemParams.getNumber(
      'minPaidPercentBeforeSampling',
      100,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.decision === CommuneDecision.REJETER) {
        const rejected = await this.stateMachine.transition(tx, {
          demandeId: id,
          toStatus: DemandeStatus.REJETEE,
          actorId: user.id,
          actorRole: user.role,
          reason: dto.reason,
          ip,
          extraData: { rejectedReason: dto.reason },
        });
        if (demande.ouvrage.owner) {
          await this.notifications.enqueue(tx, {
            userId: demande.ouvrage.owner.id,
            channel: NotificationChannel.IN_APP,
            recipient: demande.ouvrage.owner.id,
            templateCode: 'DEMANDE_REJETEE',
            payload: { reference: demande.reference, reason: dto.reason },
          });
        }
        return rejected;
      }

      await this.stateMachine.transition(tx, {
        demandeId: id,
        toStatus: DemandeStatus.VALIDEE_COMMUNE,
        actorId: user.id,
        actorRole: user.role,
        ip,
        extraData: { validatedCommuneAt: new Date() },
      });

      const netDue = Math.max(
        0,
        (demande.tarifAmount ?? 0) - demande.subventionAmount,
      );
      const nextStatus =
        netDue === 0 || minPaidPercent === 0
          ? DemandeStatus.PRELEVEMENT_PLANIFIE
          : DemandeStatus.EN_ATTENTE_PAIEMENT;

      const finalDemande = await this.stateMachine.transition(tx, {
        demandeId: id,
        toStatus: nextStatus,
        actorId: user.id,
        actorRole: user.role,
        ip,
      });

      if (demande.ouvrage.owner) {
        await this.notifications.enqueue(tx, {
          userId: demande.ouvrage.owner.id,
          channel: NotificationChannel.IN_APP,
          recipient: demande.ouvrage.owner.id,
          templateCode: `DEMANDE_${nextStatus}`,
          payload: { reference: demande.reference, netDue },
        });
      }

      return finalDemande;
    });

    return this.serializeDemande(updated);
  }

  async cancel(user: AuthUser, id: string, ip?: string | null) {
    const demande = await this.prisma.demandeCertification.findUnique({
      where: { id },
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

    const updated = await this.prisma.$transaction((tx) =>
      this.stateMachine.transition(tx, {
        demandeId: id,
        toStatus: DemandeStatus.ANNULEE,
        actorId: user.id,
        actorRole: user.role,
        ip,
        extraData: { cancelledAt: new Date() },
      }),
    );

    return this.serializeDemande(updated);
  }

  async openContreAnalyse(
    user: AuthUser,
    id: string,
    dto: CreateContreAnalyseDto,
    ip?: string | null,
  ) {
    const demande = await this.prisma.demandeCertification.findUnique({
      where: { id },
      include: {
        ouvrage: true,
        prelevements: {
          orderBy: { createdAt: 'desc' },
          include: { analyse: true },
        },
        contreAnalyses: true,
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

    if (demande.status !== DemandeStatus.NON_CONFORME) {
      throw new ConflictException({
        code: 'CONTRE_ANALYSE_DENIED',
        message: 'Counter-analysis can only be opened from NON_CONFORME state',
      });
    }

    const initialAnalyse = demande.prelevements
      .map((p) => p.analyse)
      .find((a) => a !== null);
    if (!initialAnalyse) {
      throw new ConflictException({
        code: 'CONTRE_ANALYSE_DENIED',
        message: 'Initial analysis not found',
      });
    }

    if (dto.laboratoireId === initialAnalyse.laboratoireId) {
      throw new ConflictException({
        code: 'CONTRE_ANALYSE_SAME_LAB',
        message:
          'Counter-analysis laboratory must differ from initial laboratory',
      });
    }

    const lab = await this.prisma.laboratoire.findUnique({
      where: { id: dto.laboratoireId },
    });
    if (!lab || !lab.isReferenced) {
      throw new ConflictException({
        code: 'LABO_REQUIRED',
        message: 'Target laboratory not found or not referenced',
      });
    }

    const maxCount = await this.systemParams.getNumber(
      'contreAnalyseMaxCount',
      1,
    );
    if (demande.contreAnalyses.length >= maxCount) {
      throw new ConflictException({
        code: 'CONTRE_ANALYSE_DENIED',
        message: 'Maximum counter-analysis quota reached',
      });
    }

    const maxDelayDays = await this.systemParams.getNumber(
      'contreAnalyseMaxDelayDays',
      30,
    );
    if (initialAnalyse.submittedAt) {
      const ageDays =
        (Date.now() - initialAnalyse.submittedAt.getTime()) /
        (1000 * 60 * 60 * 24);
      if (ageDays > maxDelayDays) {
        throw new ConflictException({
          code: 'CONTRE_ANALYSE_DENIED',
          message: 'Counter-analysis delay window expired',
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const contre = await tx.contreAnalyse.create({
        data: {
          demandeId: demande.id,
          initialAnalyseId: initialAnalyse.id,
          laboratoireId: dto.laboratoireId,
          payeur: dto.payeur,
          requestedById: user.id,
        },
      });

      await this.stateMachine.transition(tx, {
        demandeId: demande.id,
        toStatus: DemandeStatus.EN_CONTRE_ANALYSE,
        actorId: user.id,
        actorRole: user.role,
        ip,
        extraData: {
          laboratoire: { connect: { id: dto.laboratoireId } },
        },
      });

      return contre;
    });
  }

  private serializeDemande(d: {
    id: string;
    reference: string;
    ouvrageId: string;
    type: DemandeType;
    status: DemandeStatus;
    laboratoireId: string | null;
    tarifAmount: number | null;
    subventionAmount: number;
    amountPaid: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const netDue = Math.max(0, (d.tarifAmount ?? 0) - d.subventionAmount);
    return {
      id: d.id,
      reference: d.reference,
      ouvrageId: d.ouvrageId,
      type: d.type,
      status: d.status,
      step: computeDemandeStep(d.status),
      laboratoireId: d.laboratoireId,
      tarifAmount: d.tarifAmount,
      subventionAmount: d.subventionAmount,
      amountPaid: d.amountPaid,
      balanceDue: Math.max(0, netDue - d.amountPaid),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }
}
