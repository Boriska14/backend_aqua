import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GrilleStatus, OuvrageType, OuvrageUsage } from '@prisma/client';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateGrilleDto } from './dto/tarif.dto';

@Injectable()
export class TarifsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listGrilles(query: PageQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const [rows, total] = await Promise.all([
      this.prisma.grilleTarifaire.findMany({
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: { lignes: true },
      }),
      this.prisma.grilleTarifaire.count(),
    ]);
    return paginate(rows, total, page, limit);
  }

  async createGrille(
    actor: AuthUser,
    dto: CreateGrilleDto,
    ip?: string | null,
  ) {
    const latest = await this.prisma.grilleTarifaire.findFirst({
      orderBy: { version: 'desc' },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      const grille = await tx.grilleTarifaire.create({
        data: {
          name: dto.name.trim(),
          version: nextVersion,
          status: GrilleStatus.BROUILLON,
          lignes: {
            create: dto.lignes.map((l) => ({
              ouvrageType: l.ouvrageType,
              usage: l.usage,
              amount: l.amount,
            })),
          },
        },
        include: { lignes: true },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'GRILLE_CREATED',
        entityType: 'GrilleTarifaire',
        entityId: grille.id,
        after: { version: grille.version, lignesCount: grille.lignes.length },
        ip,
      });

      return grille;
    });
  }

  async activateGrille(actor: AuthUser, id: string, ip?: string | null) {
    const target = await this.prisma.grilleTarifaire.findUnique({
      where: { id },
      include: { lignes: true },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Tariff grid not found',
      });
    }
    if (target.lignes.length === 0) {
      throw new ConflictException({
        code: 'GRID_INACTIVE',
        message: 'Cannot activate an empty tariff grid',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.grilleTarifaire.updateMany({
        where: { status: GrilleStatus.ACTIVE },
        data: { status: GrilleStatus.ARCHIVEE },
      });

      const activated = await tx.grilleTarifaire.update({
        where: { id },
        data: {
          status: GrilleStatus.ACTIVE,
          activatedAt: new Date(),
          activatedById: actor.id,
        },
        include: { lignes: true },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'GRILLE_ACTIVATED',
        entityType: 'GrilleTarifaire',
        entityId: id,
        after: { version: activated.version, status: activated.status },
        ip,
      });

      return activated;
    });
  }

  async resolveActiveLigne(type: OuvrageType, usage: OuvrageUsage) {
    const activeGrille = await this.prisma.grilleTarifaire.findFirst({
      where: { status: GrilleStatus.ACTIVE },
      include: { lignes: true },
      orderBy: { activatedAt: 'desc' },
    });

    if (!activeGrille) {
      throw new ConflictException({
        code: 'GRID_INACTIVE',
        message: 'No active tariff grid available',
      });
    }

    const ligne = activeGrille.lignes.find(
      (l) => l.ouvrageType === type && l.usage === usage,
    );
    if (!ligne) {
      throw new ConflictException({
        code: 'GRID_INACTIVE',
        message: `No tariff line configured for ${type} / ${usage}`,
      });
    }

    return { grille: activeGrille, ligne };
  }

  async estimateForOuvrage(ouvrageId: string) {
    const ouvrage = await this.prisma.ouvrage.findUnique({
      where: { id: ouvrageId },
    });
    if (!ouvrage) {
      throw new NotFoundException({
        code: 'OUVRAGE_NOT_FOUND',
        message: 'Ouvrage not found',
      });
    }

    const { grille, ligne } = await this.resolveActiveLigne(
      ouvrage.type,
      ouvrage.usage,
    );

    return {
      amount: ligne.amount,
      grilleVersion: grille.version,
    };
  }
}
