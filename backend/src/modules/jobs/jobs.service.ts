import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CertificatStatus, NotificationChannel, Role } from '@prisma/client';
import { SystemParamsService } from '../../common/utils/system-params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OuvrageStatusService } from '../ouvrages/ouvrage-status.service';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly ouvrageStatus: OuvrageStatusService,
    private readonly notifications: NotificationsService,
    private readonly systemParams: SystemParamsService,
  ) {}

  @Cron('0 2 * * *')
  async expireCertificates(): Promise<number> {
    const now = new Date();
    const expiredCandidates = await this.prisma.certificat.findMany({
      where: {
        status: { in: [CertificatStatus.ACTIF, CertificatStatus.SUSPENDU] },
        validUntil: { lt: now },
      },
      include: { ouvrage: { include: { owner: true } } },
    });

    let count = 0;
    for (const cert of expiredCandidates) {
      await this.prisma.$transaction(async (tx) => {
        const res = await tx.certificat.updateMany({
          where: {
            id: cert.id,
            status: { in: [CertificatStatus.ACTIF, CertificatStatus.SUSPENDU] },
          },
          data: { status: CertificatStatus.EXPIRE },
        });
        if (res.count === 0) {
          return;
        }

        await tx.certificatTransition.create({
          data: {
            certificatId: cert.id,
            fromStatus: cert.status,
            toStatus: CertificatStatus.EXPIRE,
            reason: 'Expiration automatique (validUntil dépassé)',
            actorId: null,
          },
        });

        await this.auditService.log(tx, {
          actorId: null,
          actorRole: null,
          action: 'CERTIFICAT_EXPIRED_AUTO',
          entityType: 'Certificat',
          entityId: cert.id,
          reason: 'Expiration automatique (validUntil dépassé)',
          before: { status: cert.status },
          after: { status: CertificatStatus.EXPIRE },
        });

        await this.ouvrageStatus.recalculate(tx, cert.ouvrageId);

        if (cert.ouvrage.owner) {
          await this.notifications.enqueue(tx, {
            userId: cert.ouvrage.owner.id,
            channel: NotificationChannel.IN_APP,
            recipient: cert.ouvrage.owner.id,
            templateCode: 'CERTIFICAT_EXPIRE',
            payload: {
              certificatNumber: cert.number,
              ouvrageNumber: cert.ouvrage.aquasafeNumber,
            },
            idempotencyKey: `CERT_EXPIRED:${cert.id}`,
          });
        }
        count++;
      });
    }

    if (count > 0) {
      this.logger.log(`Expired ${count} certificate(s)`);
    }
    return count;
  }

  @Cron('0 6 * * *')
  async sendExpiringJ60Alerts(): Promise<number> {
    const now = new Date();
    const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const expiring = await this.prisma.certificat.findMany({
      where: {
        status: CertificatStatus.ACTIF,
        validUntil: { gte: now, lte: in60Days },
      },
      include: {
        ouvrage: { include: { owner: true } },
      },
    });

    let enqueued = 0;
    for (const cert of expiring) {
      const communeAgents = await this.prisma.user.findMany({
        where: {
          role: Role.AGENT_COMMUNAL,
          communeScopes: { some: { communeId: cert.ouvrage.communeId } },
        },
        select: { id: true },
      });

      await this.prisma.$transaction(async (tx) => {
        if (cert.ouvrage.owner) {
          await this.notifications.enqueue(tx, {
            userId: cert.ouvrage.owner.id,
            channel: NotificationChannel.IN_APP,
            recipient: cert.ouvrage.owner.id,
            templateCode: 'CERTIFICAT_EXPIRANT_J60',
            payload: {
              certificatNumber: cert.number,
              validUntil: cert.validUntil,
            },
            idempotencyKey: `CERT_EXPIRING_60:${cert.id}:OWNER:${cert.ouvrage.owner.id}`,
          });
          enqueued++;
        }

        for (const agent of communeAgents) {
          await this.notifications.enqueue(tx, {
            userId: agent.id,
            channel: NotificationChannel.IN_APP,
            recipient: agent.id,
            templateCode: 'CERTIFICAT_EXPIRANT_J60',
            payload: {
              certificatNumber: cert.number,
              ouvrageNumber: cert.ouvrage.aquasafeNumber,
              validUntil: cert.validUntil,
            },
            idempotencyKey: `CERT_EXPIRING_60:${cert.id}:COMMUNE:${agent.id}`,
          });
          enqueued++;
        }
      });
    }

    return enqueued;
  }

  @Cron('0 8 * * 1')
  async remindUnconfirmedPlaques(): Promise<number> {
    const thresholdDays = await this.systemParams.getNumber(
      'unconfirmedPlaqueDays',
      14,
    );
    const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

    const pending = await this.prisma.certificat.findMany({
      where: {
        status: CertificatStatus.EMIS,
        issuedAt: { lt: cutoff },
      },
      include: { ouvrage: true },
    });

    let count = 0;
    for (const cert of pending) {
      const agents = await this.prisma.user.findMany({
        where: {
          role: Role.AGENT_COMMUNAL,
          communeScopes: { some: { communeId: cert.ouvrage.communeId } },
        },
        select: { id: true },
      });
      await this.prisma.$transaction(async (tx) => {
        for (const agent of agents) {
          await this.notifications.enqueue(tx, {
            userId: agent.id,
            channel: NotificationChannel.IN_APP,
            recipient: agent.id,
            templateCode: 'RELANCE_PLAQUE_NON_CONFIRMEE',
            payload: {
              certificatNumber: cert.number,
              ouvrageNumber: cert.ouvrage.aquasafeNumber,
            },
            idempotencyKey: `PLAQUE_REMIND:${cert.id}:${agent.id}:${new Date().toISOString().slice(0, 10)}`,
          });
          count++;
        }
      });
    }
    return count;
  }

  @Cron('0 3 * * *')
  async purgeExpiredAuthTokens(): Promise<void> {
    const now = new Date();
    const [otpRes, refreshRes] = await Promise.all([
      this.prisma.userAuthCode.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
      this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
    ]);
    if (otpRes.count > 0 || refreshRes.count > 0) {
      this.logger.log(
        `Purged ${otpRes.count} OTP codes and ${refreshRes.count} refresh tokens`,
      );
    }
  }
}
