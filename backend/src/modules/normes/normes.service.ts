import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NormeStatus } from '@prisma/client';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateNormeDto, SeuilItemDto } from './dto/norme.dto';

@Injectable()
export class NormesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: PageQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const [rows, total] = await Promise.all([
      this.prisma.normeReferentiel.findMany({
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take,
        include: { seuils: { orderBy: { parameterCode: 'asc' } } },
      }),
      this.prisma.normeReferentiel.count(),
    ]);
    return paginate(rows, total, page, limit);
  }

  async create(actor: AuthUser, dto: CreateNormeDto, ip?: string | null) {
    const dup = await this.prisma.normeReferentiel.findUnique({
      where: {
        code_version: {
          code: dto.code.trim(),
          version: dto.version.trim(),
        },
      },
    });
    if (dup) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'A referentiel with this code and version already exists',
      });
    }

    let copiedSeuils: Array<{
      parameterCode: string;
      label: string;
      type: 'PHYSICO_CHIMIQUE' | 'BACTERIOLOGIQUE';
      unit: string | null;
      minValue: number | null;
      maxValue: number | null;
      isCritical: boolean;
      isMandatory: boolean;
    }> = [];

    if (dto.copyFromId) {
      const source = await this.prisma.normeReferentiel.findUnique({
        where: { id: dto.copyFromId },
        include: { seuils: true },
      });
      if (!source) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Source referentiel not found',
        });
      }
      copiedSeuils = source.seuils.map((s) => ({
        parameterCode: s.parameterCode,
        label: s.label,
        type: s.type,
        unit: s.unit,
        minValue: s.minValue,
        maxValue: s.maxValue,
        isCritical: s.isCritical,
        isMandatory: s.isMandatory,
      }));
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.normeReferentiel.create({
        data: {
          code: dto.code.trim(),
          version: dto.version.trim(),
          status: NormeStatus.BROUILLON,
          validityMonths: dto.validityMonths ?? null,
          ...(copiedSeuils.length > 0
            ? { seuils: { createMany: { data: copiedSeuils } } }
            : {}),
        },
        include: { seuils: true },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'NORME_CREATED',
        entityType: 'NormeReferentiel',
        entityId: created.id,
        after: { code: created.code, version: created.version },
        ip,
      });

      return created;
    });
  }

  async replaceSeuils(
    actor: AuthUser,
    id: string,
    items: SeuilItemDto[],
    ip?: string | null,
  ) {
    const norme = await this.prisma.normeReferentiel.findUnique({
      where: { id },
    });
    if (!norme) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Referentiel not found',
      });
    }
    if (norme.status !== NormeStatus.BROUILLON) {
      throw new ConflictException({
        code: 'NORME_LOCKED',
        message: 'Only BROUILLON referentiels can have thresholds updated',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.normeSeuil.deleteMany({ where: { referentielId: id } });
      if (items.length > 0) {
        await tx.normeSeuil.createMany({
          data: items.map((item) => ({
            referentielId: id,
            parameterCode: item.parameterCode.trim().toUpperCase(),
            label: item.label.trim(),
            type: item.type,
            unit: item.unit ?? null,
            minValue: item.minValue ?? null,
            maxValue: item.maxValue ?? null,
            isCritical: item.isCritical ?? false,
            isMandatory: item.isMandatory ?? true,
          })),
        });
      }

      const updated = await tx.normeReferentiel.findUniqueOrThrow({
        where: { id },
        include: { seuils: { orderBy: { parameterCode: 'asc' } } },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'NORME_SEUILS_UPDATED',
        entityType: 'NormeReferentiel',
        entityId: id,
        after: { seuilsCount: updated.seuils.length },
        ip,
      });

      return updated;
    });
  }

  async publish(actor: AuthUser, id: string, ip?: string | null) {
    const norme = await this.prisma.normeReferentiel.findUnique({
      where: { id },
      include: { seuils: true },
    });
    if (!norme) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Referentiel not found',
      });
    }
    if (norme.status !== NormeStatus.BROUILLON) {
      throw new ConflictException({
        code: 'NORME_LOCKED',
        message: 'Only BROUILLON referentiels can be published',
      });
    }
    if (!norme.validityMonths || norme.validityMonths <= 0) {
      throw new ConflictException({
        code: 'NORME_MISSING_VALIDITY',
        message: 'validityMonths must be configured before publishing',
      });
    }
    if (norme.seuils.length === 0) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: 'Cannot publish a referentiel without thresholds',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.normeReferentiel.updateMany({
        where: { status: NormeStatus.PUBLIE },
        data: { status: NormeStatus.ARCHIVE },
      });

      const published = await tx.normeReferentiel.update({
        where: { id },
        data: {
          status: NormeStatus.PUBLIE,
          publishedAt: new Date(),
          publishedById: actor.id,
        },
        include: { seuils: true },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'NORME_PUBLISHED',
        entityType: 'NormeReferentiel',
        entityId: id,
        after: {
          code: published.code,
          version: published.version,
          validityMonths: published.validityMonths,
        },
        ip,
      });

      return published;
    });
  }

  async getActivePublished() {
    const active = await this.prisma.normeReferentiel.findFirst({
      where: { status: NormeStatus.PUBLIE },
      include: { seuils: true },
      orderBy: { publishedAt: 'desc' },
    });
    if (!active) {
      throw new ConflictException({
        code: 'NO_ACTIVE_NORME',
        message: 'No active published standard referentiel',
      });
    }
    return active;
  }
}
