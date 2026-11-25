import { CertificatStatus, NotificationChannel } from '@prisma/client';
import { SystemParamsService } from '../../common/utils/system-params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OuvrageStatusService } from '../ouvrages/ouvrage-status.service';
import { JobsService } from './jobs.service';

describe('JobsService (EF-31)', () => {
  it('enqueues J-60 alerts with deterministic idempotency keys per certificate and recipient', async () => {
    const enqueueCalls: Array<Record<string, unknown>> = [];
    const notifications = {
      enqueue: jest.fn((_tx: unknown, input: Record<string, unknown>) => {
        enqueueCalls.push(input);
        return Promise.resolve();
      }),
    } as unknown as NotificationsService;

    const prisma = {
      certificat: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cert-60',
            number: 'CC-2026-000060',
            validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            ouvrage: {
              aquasafeNumber: 'AS-CE-000060',
              communeId: 5,
              owner: { id: 'owner-60' },
            },
          },
        ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'agent-5' }]),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({}),
      ),
    } as unknown as PrismaService;

    const jobs = new JobsService(
      prisma,
      {} as AuditService,
      {} as OuvrageStatusService,
      notifications,
      {} as SystemParamsService,
    );

    const count = await jobs.sendExpiringJ60Alerts();
    expect(count).toBe(2);
    expect(enqueueCalls[0].channel).toBe(NotificationChannel.IN_APP);
    expect(enqueueCalls[0].idempotencyKey).toBe(
      'CERT_EXPIRING_60:cert-60:OWNER:owner-60',
    );
    expect(enqueueCalls[1].idempotencyKey).toBe(
      'CERT_EXPIRING_60:cert-60:COMMUNE:agent-5',
    );
  });

  it('expires ACTIF certificates past validUntil and logs transition with null actor', async () => {
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const recalc = jest.fn().mockResolvedValue(undefined);
    const enqueue = jest.fn().mockResolvedValue(undefined);

    const tx = {
      certificat: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      certificatTransition: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      certificat: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cert-exp',
            number: 'CC-2025-000002',
            status: CertificatStatus.ACTIF,
            ouvrageId: 'ouv-exp',
            ouvrage: { aquasafeNumber: 'AS-CE-000002', owner: null },
          },
        ]),
      },
      $transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) =>
        cb(tx),
      ),
    } as unknown as PrismaService;

    const jobs = new JobsService(
      prisma,
      { log: auditLog } as unknown as AuditService,
      { recalculate: recalc } as unknown as OuvrageStatusService,
      { enqueue } as unknown as NotificationsService,
      {} as SystemParamsService,
    );

    const expired = await jobs.expireCertificates();
    expect(expired).toBe(1);
    expect(tx.certificatTransition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          certificatId: 'cert-exp',
          fromStatus: CertificatStatus.ACTIF,
          toStatus: CertificatStatus.EXPIRE,
          actorId: null,
        }),
      }),
    );
    expect(recalc).toHaveBeenCalledWith(tx, 'ouv-exp');
  });
});
