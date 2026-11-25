import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DemandeStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OuvrageStatusService } from '../ouvrages/ouvrage-status.service';

type PrismaTx = Prisma.TransactionClient | PrismaService;

export const DEMANDE_TERMINAL_STATUSES: DemandeStatus[] = [
  DemandeStatus.CERTIFIEE,
  DemandeStatus.REJETEE,
  DemandeStatus.ANNULEE,
];

export const DEMANDE_ALLOWED_TRANSITIONS: Record<
  DemandeStatus,
  DemandeStatus[]
> = {
  [DemandeStatus.BROUILLON]: [DemandeStatus.SOUMISE, DemandeStatus.ANNULEE],
  [DemandeStatus.SOUMISE]: [
    DemandeStatus.VALIDEE_COMMUNE,
    DemandeStatus.REJETEE,
    DemandeStatus.ANNULEE,
  ],
  [DemandeStatus.VALIDEE_COMMUNE]: [
    DemandeStatus.EN_ATTENTE_PAIEMENT,
    DemandeStatus.PRELEVEMENT_PLANIFIE,
    DemandeStatus.ANNULEE,
  ],
  [DemandeStatus.EN_ATTENTE_PAIEMENT]: [
    DemandeStatus.PRELEVEMENT_PLANIFIE,
    DemandeStatus.ANNULEE,
  ],
  [DemandeStatus.PRELEVEMENT_PLANIFIE]: [
    DemandeStatus.PRELEVE,
    DemandeStatus.ANNULEE,
  ],
  [DemandeStatus.PRELEVE]: [
    DemandeStatus.EN_ANALYSE,
    DemandeStatus.PRELEVEMENT_PLANIFIE,
    DemandeStatus.ANNULEE,
  ],
  [DemandeStatus.EN_ANALYSE]: [DemandeStatus.ANALYSE_SOUMISE],
  [DemandeStatus.ANALYSE_SOUMISE]: [
    DemandeStatus.EN_VALIDATION_MINEE,
    DemandeStatus.NON_CONFORME,
  ],
  [DemandeStatus.NON_CONFORME]: [DemandeStatus.EN_CONTRE_ANALYSE],
  [DemandeStatus.EN_CONTRE_ANALYSE]: [
    DemandeStatus.EN_VALIDATION_MINEE,
    DemandeStatus.NON_CONFORME,
  ],
  [DemandeStatus.EN_VALIDATION_MINEE]: [
    DemandeStatus.CERTIFIEE,
    DemandeStatus.REJETEE,
  ],
  [DemandeStatus.CERTIFIEE]: [],
  [DemandeStatus.REJETEE]: [],
  [DemandeStatus.ANNULEE]: [],
};

const STEP_MAP: Record<DemandeStatus, number> = {
  [DemandeStatus.BROUILLON]: 1,
  [DemandeStatus.SOUMISE]: 1,
  [DemandeStatus.VALIDEE_COMMUNE]: 2,
  [DemandeStatus.REJETEE]: 2,
  [DemandeStatus.ANNULEE]: 2,
  [DemandeStatus.EN_ATTENTE_PAIEMENT]: 3,
  [DemandeStatus.PRELEVEMENT_PLANIFIE]: 4,
  [DemandeStatus.PRELEVE]: 4,
  [DemandeStatus.EN_ANALYSE]: 5,
  [DemandeStatus.ANALYSE_SOUMISE]: 5,
  [DemandeStatus.NON_CONFORME]: 5,
  [DemandeStatus.EN_CONTRE_ANALYSE]: 5,
  [DemandeStatus.EN_VALIDATION_MINEE]: 6,
  [DemandeStatus.CERTIFIEE]: 6,
};

export function computeDemandeStep(status: DemandeStatus): number {
  return STEP_MAP[status] ?? 1;
}

@Injectable()
export class DemandeStateMachineService {
  constructor(
    private readonly auditService: AuditService,
    private readonly ouvrageStatusService: OuvrageStatusService,
  ) {}

  async transition(
    tx: PrismaTx,
    params: {
      demandeId: string;
      toStatus: DemandeStatus;
      actorId: string | null;
      actorRole: Role | null;
      reason?: string | null;
      ip?: string | null;
      extraData?: Prisma.DemandeCertificationUpdateInput;
    },
  ) {
    const current = await tx.demandeCertification.findUnique({
      where: { id: params.demandeId },
    });
    if (!current) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Demande not found',
      });
    }

    const allowed = DEMANDE_ALLOWED_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(params.toStatus)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `Transition ${current.status} -> ${params.toStatus} is not allowed`,
      });
    }

    const updated = await tx.demandeCertification.update({
      where: { id: current.id },
      data: {
        status: params.toStatus,
        ...(params.extraData ?? {}),
      },
    });

    await tx.demandeTransition.create({
      data: {
        demandeId: current.id,
        fromStatus: current.status,
        toStatus: params.toStatus,
        reason: params.reason ?? null,
        actorId: params.actorId,
      },
    });

    await this.auditService.log(tx, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: `DEMANDE_${params.toStatus}`,
      entityType: 'DemandeCertification',
      entityId: current.id,
      reason: params.reason ?? null,
      before: { status: current.status },
      after: { status: params.toStatus },
      ip: params.ip ?? null,
    });

    await this.ouvrageStatusService.recalculate(tx, current.ouvrageId);

    return updated;
  }
}
