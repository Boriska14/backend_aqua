import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentKind,
  OuvrageStatus,
  Prisma,
  Role,
  UserStatus,
} from '@prisma/client';
import { ScopePolicyService } from '../../common/guards/scope-policy.service';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import { normalizeCameroonPhone } from '../../common/utils/crypto.util';
import { SystemParamsService } from '../../common/utils/system-params.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import {
  CreateOuvrageDto,
  ListOuvragesQueryDto,
  UpdateOuvrageDto,
} from './dto/ouvrage.dto';

@Injectable()
export class OuvragesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopePolicy: ScopePolicyService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly systemParams: SystemParamsService,
    private readonly configService: ConfigService,
  ) {}

  async list(user: AuthUser, query: ListOuvragesQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const scopeWhere = this.scopePolicy.ouvrageWhere(user);

    const where: Prisma.OuvrageWhereInput = {
      AND: [
        scopeWhere,
        {
          ...(query.communeId ? { communeId: query.communeId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.type ? { type: query.type } : {}),
          ...(query.q
            ? {
                OR: [
                  {
                    aquasafeNumber: {
                      contains: query.q,
                      mode: 'insensitive',
                    },
                  },
                  { name: { contains: query.q, mode: 'insensitive' } },
                  { village: { contains: query.q, mode: 'insensitive' } },
                ],
              }
            : {}),
          ...(query.certExpiringBefore
            ? {
                certificats: {
                  some: {
                    status: 'ACTIF',
                    validUntil: { lte: new Date(query.certExpiringBefore) },
                  },
                },
              }
            : {}),
        },
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.ouvrage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          commune: { select: { id: true, name: true, regionId: true } },
          certificats: {
            where: { status: { in: ['EMIS', 'ACTIF', 'SUSPENDU'] } },
            orderBy: { issuedAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.ouvrage.count({ where }),
    ]);

    return paginate(
      rows.map(({ certificats, ...o }) => ({
        ...o,
        currentCertificat: certificats[0] ?? null,
      })),
      total,
      page,
      limit,
    );
  }

  async findOne(user: AuthUser, id: string) {
    const ouvrage = await this.prisma.ouvrage.findUnique({
      where: { id },
      include: {
        commune: { include: { region: true } },
        demandes: { select: { id: true, laboratoireId: true } },
        certificats: {
          orderBy: { issuedAt: 'desc' },
          take: 1,
          include: { transitions: { orderBy: { createdAt: 'desc' } } },
        },
      },
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
      demandeLabIds: ouvrage.demandes.map((d) => d.laboratoireId),
    });

    const { demandes: _d, certificats, ...rest } = ouvrage;
    void _d;
    return {
      ...rest,
      currentCertificat: certificats[0] ?? null,
    };
  }

  async create(user: AuthUser, dto: CreateOuvrageDto, ip?: string | null) {
    let targetCommuneId = dto.communeId;
    if (user.role === Role.AGENT_COMMUNAL) {
      if (!user.communeId && user.communeScopeIds.length === 0) {
        this.scopePolicy.deny();
      }
      targetCommuneId = user.communeId ?? user.communeScopeIds[0];
      if (!this.scopePolicy.hasCommune(user, targetCommuneId)) {
        this.scopePolicy.deny();
      }
    }

    const commune = await this.prisma.commune.findUnique({
      where: { id: targetCommuneId },
      include: { region: true },
    });
    if (!commune) {
      throw new NotFoundException({
        code: 'COMMUNE_NOT_FOUND',
        message: 'Commune not found',
      });
    }

    if (dto.sieId) {
      const existingSie = await this.prisma.ouvrage.findUnique({
        where: { sieId: dto.sieId },
      });
      if (existingSie) {
        throw new ConflictException({
          code: 'OUVRAGE_DUPLICATE',
          message: 'An ouvrage with this sieId already exists',
          existingOuvrage: existingSie,
        });
      }
    }

    const radiusM = await this.systemParams.getNumber(
      'duplicateRadiusM',
      this.configService.get<number>('DUPLICATE_RADIUS_M', 15),
    );

    const nearby = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ouvrages
      WHERE type = ${dto.type}::"OuvrageType"
        AND location IS NOT NULL
        AND ST_DWithin(
          location::geography,
          ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)::geography,
          ${radiusM}
        )
      LIMIT 1
    `;
    if (nearby.length > 0) {
      const existingOuvrage = await this.prisma.ouvrage.findUnique({
        where: { id: nearby[0].id },
      });
      throw new ConflictException({
        code: 'OUVRAGE_DUPLICATE',
        message: 'A similar ouvrage already exists nearby',
        existingOuvrage,
      });
    }

    const numberPrefix = await this.systemParams.getString(
      'ouvrageNumberPrefix',
      'AS',
    );

    return this.prisma.$transaction(async (tx) => {
      let ownerId: string | null = null;
      if (user.role === Role.PROPRIETAIRE) {
        ownerId = user.id;
      } else if (dto.ownerPhone) {
        const phone = normalizeCameroonPhone(dto.ownerPhone);
        if (!phone) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Invalid ownerPhone format',
          });
        }
        let owner = await tx.user.findUnique({ where: { phone } });
        if (!owner) {
          owner = await tx.user.create({
            data: {
              role: Role.PROPRIETAIRE,
              status: UserStatus.PENDING,
              fullName: 'Propriétaire',
              phone,
            },
          });
        }
        ownerId = owner.id;
      }

      const builderOrgId =
        user.role === Role.ENTREPRISE_FORAGE_ONG ? user.organisationId : null;

      const seqRows = await tx.$queryRaw<Array<{ val: bigint }>>`
        SELECT nextval('seq_ouvrage') AS val
      `;
      const seqStr = String(seqRows[0].val).padStart(6, '0');
      const aquasafeNumber = `${numberPrefix}-${commune.region.code}-${seqStr}`;

      const ouvrage = await tx.ouvrage.create({
        data: {
          aquasafeNumber,
          sieId: dto.sieId ?? null,
          type: dto.type,
          usage: dto.usage ?? 'DOMESTIQUE',
          name: dto.name.trim(),
          village: dto.village?.trim() ?? null,
          communeId: targetCommuneId,
          latitude: dto.latitude,
          longitude: dto.longitude,
          gpsAccuracyM: dto.gpsAccuracyM ?? null,
          yearBuilt: dto.yearBuilt ?? null,
          isPublic: dto.isPublic ?? true,
          ownerId,
          builderOrgId,
          dossier: {
            create: {},
          },
        },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'OUVRAGE_CREATED',
        entityType: 'Ouvrage',
        entityId: ouvrage.id,
        after: {
          aquasafeNumber: ouvrage.aquasafeNumber,
          communeId: ouvrage.communeId,
          type: ouvrage.type,
        },
        ip,
      });

      return ouvrage;
    });
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateOuvrageDto,
    ip?: string | null,
  ) {
    const existing = await this.prisma.ouvrage.findUnique({
      where: { id },
      include: { demandes: { select: { laboratoireId: true } } },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'OUVRAGE_NOT_FOUND',
        message: 'Ouvrage not found',
      });
    }

    this.scopePolicy.assertCanAccessOuvrage(user, {
      communeId: existing.communeId,
      ownerId: existing.ownerId,
      builderOrgId: existing.builderOrgId,
      demandeLabIds: existing.demandes.map((d) => d.laboratoireId),
    });

    if (dto.status !== undefined && dto.status !== OuvrageStatus.HORS_SERVICE) {
      throw new ForbiddenException({
        code: 'INVALID_TRANSITION',
        message: 'Only HORS_SERVICE can be set directly on an ouvrage',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ouvrage.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.village !== undefined ? { village: dto.village.trim() } : {}),
          ...(dto.usage !== undefined ? { usage: dto.usage } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
        },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'OUVRAGE_UPDATED',
        entityType: 'Ouvrage',
        entityId: id,
        before: {
          name: existing.name,
          status: existing.status,
          usage: existing.usage,
        },
        after: {
          name: updated.name,
          status: updated.status,
          usage: updated.usage,
        },
        ip,
      });

      return updated;
    });
  }

  async getDossier(user: AuthUser, id: string) {
    const ouvrage = await this.prisma.ouvrage.findUnique({
      where: { id },
      include: {
        dossier: {
          include: {
            documents: { orderBy: { createdAt: 'desc' } },
          },
        },
        documents: { orderBy: { createdAt: 'desc' } },
        demandes: {
          orderBy: { createdAt: 'desc' },
          include: { transitions: { orderBy: { createdAt: 'asc' } } },
        },
        certificats: {
          orderBy: { issuedAt: 'desc' },
          include: { transitions: { orderBy: { createdAt: 'asc' } } },
        },
      },
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
      demandeLabIds: ouvrage.demandes.map((d) => d.laboratoireId),
    });

    const timeline = [
      ...ouvrage.demandes.flatMap((d) =>
        d.transitions.map((t) => ({
          at: t.createdAt,
          event: `DEMANDE_${t.toStatus}`,
          actor: t.actorId ?? 'SYSTEM',
        })),
      ),
      ...ouvrage.certificats.flatMap((c) =>
        c.transitions.map((t) => ({
          at: t.createdAt,
          event: `CERTIFICAT_${t.toStatus}`,
          actor: t.actorId ?? 'SYSTEM',
        })),
      ),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return {
      ouvrageId: ouvrage.id,
      documents: ouvrage.documents,
      demandes: ouvrage.demandes,
      certificats: ouvrage.certificats,
      timeline,
    };
  }

  async addDocument(
    user: AuthUser,
    ouvrageId: string,
    kind: DocumentKind,
    file: Express.Multer.File,
    ip?: string | null,
  ) {
    this.documentsService.validateFilePresent(file);

    const ouvrage = await this.prisma.ouvrage.findUnique({
      where: { id: ouvrageId },
      include: {
        dossier: true,
        demandes: { select: { laboratoireId: true } },
      },
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
      demandeLabIds: ouvrage.demandes.map((d) => d.laboratoireId),
    });

    return this.prisma.$transaction(async (tx) => {
      const dossier =
        ouvrage.dossier ??
        (await tx.dossierNumerique.create({ data: { ouvrageId } }));

      const doc = await this.documentsService.createFromBuffer(tx, {
        buffer: file.buffer,
        kind,
        prefix: 'ouvrages',
        originalName: file.originalname,
        uploadedById: user.id,
        ouvrageId,
        dossierId: dossier.id,
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'OUVRAGE_DOCUMENT_ADDED',
        entityType: 'Document',
        entityId: doc.id,
        after: { ouvrageId, kind },
        ip,
      });

      return doc;
    });
  }
}
