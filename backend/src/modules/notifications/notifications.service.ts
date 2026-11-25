import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  NotificationChannel,
  NotificationStatus,
  Prisma,
} from '@prisma/client';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { SMS_PROVIDER, SmsProvider } from '../auth/sms/sms-provider.interface';
import { EMAIL_PROVIDER, EmailProvider } from './email.provider';

type PrismaTx = Prisma.TransactionClient | PrismaService;

export interface EnqueueNotificationInput {
  userId?: string | null;
  channel: NotificationChannel;
  recipient: string;
  templateCode: string;
  payload: Prisma.InputJsonValue;
  idempotencyKey?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async enqueue(tx: PrismaTx, input: EnqueueNotificationInput): Promise<void> {
    if (input.idempotencyKey) {
      const existing = await tx.notification.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return;
      }
    }

    await tx.notification.create({
      data: {
        userId: input.userId ?? null,
        channel: input.channel,
        recipient: input.recipient,
        templateCode: input.templateCode,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey ?? null,
        status:
          input.channel === NotificationChannel.IN_APP
            ? NotificationStatus.SENT
            : NotificationStatus.PENDING,
        sentAt:
          input.channel === NotificationChannel.IN_APP ? new Date() : null,
      },
    });
  }

  async listForUser(
    userId: string,
    query: PageQueryDto & { unreadOnly?: boolean },
  ) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const where: Prisma.NotificationWhereInput = {
      userId,
      channel: NotificationChannel.IN_APP,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return paginate(rows, total, page, limit);
  }

  async markAsRead(userId: string, notificationId: string): Promise<void> {
    const found = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!found || found.userId !== userId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Notification not found',
      });
    }
    if (!found.readAt) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { readAt: new Date() },
      });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchPending(): Promise<number> {
    const now = new Date();
    const pending = await this.prisma.notification.findMany({
      where: {
        status: NotificationStatus.PENDING,
        nextAttemptAt: { lte: now },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    let sentCount = 0;
    for (const notif of pending) {
      try {
        if (notif.channel === NotificationChannel.SMS) {
          await this.smsProvider.send(
            notif.recipient,
            `[AquaSafe] ${notif.templateCode}: ${JSON.stringify(notif.payload)}`,
          );
        } else if (notif.channel === NotificationChannel.EMAIL) {
          await this.emailProvider.send(
            notif.recipient,
            `AquaSafe - ${notif.templateCode}`,
            JSON.stringify(notif.payload),
          );
        }

        await this.prisma.notification.update({
          where: { id: notif.id },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
            attempts: { increment: 1 },
          },
        });
        sentCount++;
      } catch (err) {
        const nextAttempt = notif.attempts + 1;
        const maxAttempts = 3;
        const backoffMinutes = 2 ** nextAttempt;
        const failed = nextAttempt >= maxAttempts;
        const message = err instanceof Error ? err.message : 'Dispatch error';
        this.logger.warn(
          `Notification ${notif.id} attempt ${nextAttempt} failed: ${message}`,
        );

        await this.prisma.notification.update({
          where: { id: notif.id },
          data: {
            attempts: nextAttempt,
            lastError: message,
            status: failed
              ? NotificationStatus.FAILED
              : NotificationStatus.PENDING,
            nextAttemptAt: new Date(Date.now() + backoffMinutes * 60_000),
          },
        });
      }
    }
    return sentCount;
  }
}
