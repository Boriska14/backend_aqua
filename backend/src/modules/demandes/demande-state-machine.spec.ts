import { ConflictException } from '@nestjs/common';
import { DemandeStatus, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { OuvrageStatusService } from '../ouvrages/ouvrage-status.service';
import {
  computeDemandeStep,
  DemandeStateMachineService,
} from './demande-state-machine.service';

describe('DemandeStateMachineService (EF-08)', () => {
  const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
  const mockOuvrageStatus = {
    recalculate: jest.fn().mockResolvedValue(undefined),
  };

  const service = new DemandeStateMachineService(
    mockAudit as unknown as AuditService,
    mockOuvrageStatus as unknown as OuvrageStatusService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps every DemandeStatus deterministically to steps 1..6', () => {
    expect(computeDemandeStep(DemandeStatus.BROUILLON)).toBe(1);
    expect(computeDemandeStep(DemandeStatus.SOUMISE)).toBe(1);
    expect(computeDemandeStep(DemandeStatus.VALIDEE_COMMUNE)).toBe(2);
    expect(computeDemandeStep(DemandeStatus.EN_ATTENTE_PAIEMENT)).toBe(3);
    expect(computeDemandeStep(DemandeStatus.PRELEVEMENT_PLANIFIE)).toBe(4);
    expect(computeDemandeStep(DemandeStatus.EN_ANALYSE)).toBe(5);
    expect(computeDemandeStep(DemandeStatus.EN_VALIDATION_MINEE)).toBe(6);
    expect(computeDemandeStep(DemandeStatus.CERTIFIEE)).toBe(6);
  });

  it('rejects illegal transitions such as BROUILLON -> CERTIFIEE', async () => {
    const tx = {
      demandeCertification: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'dem-1',
          ouvrageId: 'ouv-1',
          status: DemandeStatus.BROUILLON,
        }),
      },
    };

    await expect(
      service.transition(tx as never, {
        demandeId: 'dem-1',
        toStatus: DemandeStatus.CERTIFIEE,
        actorId: 'user-1',
        actorRole: Role.MINEE,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('writes DemandeTransition, AuditLog, and recalculates Ouvrage status on valid transition', async () => {
    const tx = {
      demandeCertification: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'dem-1',
          ouvrageId: 'ouv-1',
          status: DemandeStatus.SOUMISE,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'dem-1',
          ouvrageId: 'ouv-1',
          status: DemandeStatus.VALIDEE_COMMUNE,
        }),
      },
      demandeTransition: {
        create: jest.fn().mockResolvedValue({ id: 'tr-1' }),
      },
    };

    const result = await service.transition(tx as never, {
      demandeId: 'dem-1',
      toStatus: DemandeStatus.VALIDEE_COMMUNE,
      actorId: 'agent-1',
      actorRole: Role.AGENT_COMMUNAL,
      ip: '127.0.0.1',
    });

    expect(result.status).toBe(DemandeStatus.VALIDEE_COMMUNE);
    expect(tx.demandeTransition.create).toHaveBeenCalledTimes(1);
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
    expect(mockOuvrageStatus.recalculate).toHaveBeenCalledWith(tx, 'ouv-1');
  });
});
