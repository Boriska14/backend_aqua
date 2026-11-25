import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentKind,
  NotificationChannel,
  Prisma,
  Role,
  SignalementCategorie,
  SignalementStatus,
} from '@prisma/client';
import sharp from 'sharp';
import { ScopePolicyService } from '../../common/guards/scope-policy.service';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import {
  generateRandomTrackingNumber,
  sha256Hex,
} from '../../common/utils/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateSignalementDto,
  ListSignalementsQueryDto,
  UpdateSignalementDto,
} from './dto/signalement.dto';

const MAX_PHOTO_WEBP_BYTES = 200 * 1024;

@Injectable()
export class SignalementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly scopePolicy: ScopePolicyService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly notifications: NotificationsService,
  ) {}

  async createPublic(
    dto: CreateSignalementDto,
    photos: Express.Multer.File[],
    ip: string | undefined,
  ) {
    if (dto.clientUuid) {
      const existing = await this.prisma.signalement.findUnique({
        where: { clientUuid: dto.clientUuid },
      });
      if (existing) {
        return {
          trackingNumber: existing.trackingNumber,
          status: existing.status,
        };
      }
    }

    const salt = this.configService.getOrThrow<string>('IP_HASH_SALT');
    const ipHash = sha256Hex(`${salt}:${ip ?? 'unknown'}`);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentByIp = await this.prisma.signalement.count({
      where: {
        ipHash,
        createdAt: { gte: oneHourAgo },
      },
    });
    if (recentByIp >= 5) {
      throw new HttpException(
        {
          code: 'SIGNALEMENT_RATE_LIMITED',
          message: 'Maximum 5 reports per hour per IP exceeded',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let ouvrageId: string | null = null;
    let communeId: number | null = null;

    if (dto.qrToken) {
      const qr = await this.prisma.qrToken.findUnique({
        where: { token: dto.qrToken },
        include: { certificat: { include: { ouvrage: true } } },
      });
      if (qr?.certificat?.ouvrage) {
        ouvrageId = qr.certificat.ouvrage.id;
        communeId = qr.certificat.ouvrage.communeId;
      }
    }

    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      if (!communeId) {
        const communeRows = await this.prisma.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM communes
          WHERE boundary IS NOT NULL
            AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326))
          LIMIT 1
        `;
        if (communeRows.length > 0) {
          communeId = communeRows[0].id;
        }
      }

      if (!ouvrageId) {
        const nearest = await this.prisma.$queryRaw<
          Array<{ id: string; communeId: number }>
        >`
          SELECT id, "communeId"
          FROM ouvrages
          WHERE location IS NOT NULL
            AND ST_DWithin(
              location::geography,
              ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)::geography,
              500
            )
          ORDER BY ST_Distance(
            location::geography,
            ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)::geography
          ) ASC
          LIMIT 1
        `;
        if (nearest.length > 0) {
          ouvrageId = nearest[0].id;
          communeId = communeId ?? nearest[0].communeId;
        }
      }
    }

    const severity =
      dto.category === SignalementCategorie.EAU_SUSPECTE ||
      dto.category === SignalementCategorie.FRAUDE_PRESUMEE
        ? 3
        : 1;

    const initialStatus =
      severity === 3
        ? SignalementStatus.ESCALADE_MINEE
        : SignalementStatus.RECU;

    const preparedPhotos: Buffer[] = [];
    for (const file of (photos ?? []).slice(0, 3)) {
      if (!file.buffer) continue;
      let webp = await sharp(file.buffer)
        .rotate()
        .resize({ width: 1400, withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer();
      if (webp.length > MAX_PHOTO_WEBP_BYTES) {
        webp = await sharp(file.buffer)
          .rotate()
          .resize({ width: 1000, withoutEnlargement: true })
          .webp({ quality: 50 })
          .toBuffer();
      }
      preparedPhotos.push(webp);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const trackingNumber = generateRandomTrackingNumber('SG');

      const sig = await tx.signalement.create({
        data: {
          trackingNumber,
          clientUuid: dto.clientUuid ?? null,
          ouvrageId,
          communeId,
          category: dto.category,
          severity,
          description: dto.description ?? null,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          qrToken: dto.qrToken ?? null,
          contactPhone: dto.contactPhone ?? null,
          ipHash,
          status: initialStatus,
        },
      });

      for (const photoBuf of preparedPhotos) {
        await this.documentsService.createFromBuffer(tx, {
          buffer: photoBuf,
          kind: DocumentKind.PHOTO_SIGNALEMENT,
          allowedMimes: ['image/webp'],
          prefix: 'signalements',
          maxBytes: MAX_PHOTO_WEBP_BYTES,
          uploadedById: undefined,
          ouvrageId: ouvrageId ?? undefined,
          signalementId: sig.id,
        });
      }

      if (communeId) {
        const agents = await tx.user.findMany({
          where: {
            role: Role.AGENT_COMMUNAL,
            communeScopes: { some: { communeId } },
          },
          select: { id: true },
        });
        for (const a of agents) {
          await this.notifications.enqueue(tx, {
            userId: a.id,
            channel: NotificationChannel.IN_APP,
            recipient: a.id,
            templateCode: 'SIGNALEMENT_NOUVEAU',
            payload: { trackingNumber, category: dto.category, severity },
          });
        }
      }

      if (severity === 3) {
        const mineeUsers = await tx.user.findMany({
          where: { role: Role.MINEE },
          select: { id: true },
        });
        for (const m of mineeUsers) {
          await this.notifications.enqueue(tx, {
            userId: m.id,
            channel: NotificationChannel.IN_APP,
            recipient: m.id,
            templateCode: 'SIGNALEMENT_ESCALADE_MINEE',
            payload: { trackingNumber, category: dto.category },
          });
        }
      }

      await this.auditService.log(tx, {
        actorId: null,
        actorRole: null,
        action: 'SIGNALEMENT_CREATED',
        entityType: 'Signalement',
        entityId: sig.id,
        after: { trackingNumber, category: dto.category, severity, communeId },
        ip: null,
      });

      return sig;
    });

    return {
      trackingNumber: created.trackingNumber,
      status: created.status,
    };
  }

  async trackPublic(trackingNumber: string) {
    const sig = await this.prisma.signalement.findUnique({
      where: { trackingNumber },
      select: {
        trackingNumber: true,
        category: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!sig) {
      throw new NotFoundException({
        code: 'SIGNALEMENT_NOT_FOUND',
        message: 'Signalement not found',
      });
    }
    return sig;
  }

  async listStaff(user: AuthUser, query: ListSignalementsQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const scopeWhere = this.scopePolicy.signalementWhere(user);

    const where: Prisma.SignalementWhereInput = {
      AND: [
        scopeWhere,
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.category ? { category: query.category } : {}),
        },
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.signalement.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          commune: { select: { id: true, name: true } },
          ouvrage: { select: { id: true, aquasafeNumber: true, name: true } },
        },
      }),
      this.prisma.signalement.count({ where }),
    ]);

    return paginate(rows, total, page, limit);
  }

  async findOneStaff(user: AuthUser, id: string) {
    const sig = await this.prisma.signalement.findUnique({
      where: { id },
      include: {
        photos: true,
        commune: { select: { id: true, name: true } },
        ouvrage: { select: { id: true, aquasafeNumber: true, name: true } },
      },
    });
    if (!sig) {
      throw new NotFoundException({
        code: 'SIGNALEMENT_NOT_FOUND',
        message: 'Signalement not found',
      });
    }

    this.scopePolicy.assertCanAccessCommune(user, sig.communeId);
    return sig;
  }

  async updateStaff(
    user: AuthUser,
    id: string,
    dto: UpdateSignalementDto,
    ip?: string | null,
  ) {
    const sig = await this.prisma.signalement.findUnique({ where: { id } });
    if (!sig) {
      throw new NotFoundException({
        code: 'SIGNALEMENT_NOT_FOUND',
        message: 'Signalement not found',
      });
    }

    this.scopePolicy.assertCanAccessCommune(user, sig.communeId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.signalement.update({
        where: { id },
        data: {
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.resolutionNote !== undefined
            ? { resolutionNote: dto.resolutionNote }
            : {}),
          assignedToId: sig.assignedToId ?? user.id,
        },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'SIGNALEMENT_UPDATED',
        entityType: 'Signalement',
        entityId: id,
        before: { status: sig.status },
        after: { status: updated.status },
        reason: dto.resolutionNote ?? null,
        ip,
      });

      return updated;
    });
  }
}
