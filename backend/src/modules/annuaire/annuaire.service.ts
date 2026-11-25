import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentKind, Prisma } from '@prisma/client';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import {
  CreateLaboratoireDto,
  CreateOrganisationDto,
  CreateRapportInterventionDto,
  ListLaboratoiresQueryDto,
  ListOrganisationsQueryDto,
  UpdateLaboratoireDto,
} from './dto/annuaire.dto';

@Injectable()
export class AnnuaireService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
  ) {}

  async listLaboratoires(query: ListLaboratoiresQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const where: Prisma.LaboratoireWhereInput = {
      isReferenced: true,
      ...(query.communeId ? { communeId: query.communeId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.laboratoire.findMany({
        where,
        select: {
          id: true,
          name: true,
          agrementNumber: true,
          agrementValidUntil: true,
          scopeAccreditation: true,
          communeId: true,
          commune: { select: { id: true, name: true } },
          phone: true,
          email: true,
          isReferenced: true,
        },
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.prisma.laboratoire.count({ where }),
    ]);

    return paginate(rows, total, page, limit);
  }

  async createLaboratoire(
    dto: CreateLaboratoireDto,
    actor: AuthUser,
    ip?: string | null,
  ) {
    if (dto.communeId) {
      const commune = await this.prisma.commune.findUnique({
        where: { id: dto.communeId },
      });
      if (!commune) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Unknown communeId',
        });
      }
    }

    const existing = await this.prisma.laboratoire.findUnique({
      where: { agrementNumber: dto.agrementNumber },
    });
    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Agreement number already exists',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const lab = await tx.laboratoire.create({
        data: {
          name: dto.name,
          agrementNumber: dto.agrementNumber,
          agrementValidUntil: dto.agrementValidUntil
            ? new Date(dto.agrementValidUntil)
            : null,
          scopeAccreditation: dto.scopeAccreditation,
          communeId: dto.communeId ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          isReferenced: dto.isReferenced ?? true,
        },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'LABORATOIRE_CREATED',
        entityType: 'Laboratoire',
        entityId: lab.id,
        after: {
          name: lab.name,
          agrementNumber: lab.agrementNumber,
          isReferenced: lab.isReferenced,
        },
        ip,
      });

      return lab;
    });
  }

  async updateLaboratoire(
    id: string,
    dto: UpdateLaboratoireDto,
    actor: AuthUser,
    ip?: string | null,
  ) {
    const existing = await this.prisma.laboratoire.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Laboratory not found',
      });
    }

    if (dto.communeId) {
      const commune = await this.prisma.commune.findUnique({
        where: { id: dto.communeId },
      });
      if (!commune) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Unknown communeId',
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.laboratoire.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.agrementValidUntil !== undefined
            ? { agrementValidUntil: new Date(dto.agrementValidUntil) }
            : {}),
          ...(dto.scopeAccreditation !== undefined
            ? { scopeAccreditation: dto.scopeAccreditation }
            : {}),
          ...(dto.communeId !== undefined ? { communeId: dto.communeId } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.isReferenced !== undefined
            ? { isReferenced: dto.isReferenced }
            : {}),
        },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'LABORATOIRE_UPDATED',
        entityType: 'Laboratoire',
        entityId: id,
        before: {
          isReferenced: existing.isReferenced,
          agrementValidUntil: existing.agrementValidUntil,
          scopeAccreditation: existing.scopeAccreditation,
        },
        after: {
          isReferenced: updated.isReferenced,
          agrementValidUntil: updated.agrementValidUntil,
          scopeAccreditation: updated.scopeAccreditation,
        },
        ip,
      });

      return updated;
    });
  }

  async listOrganisations(query: ListOrganisationsQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const where: Prisma.OrganisationWhereInput = {
      isReferenced: true,
      ...(query.type ? { type: query.type } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.organisation.findMany({
        where,
        include: { commune: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.prisma.organisation.count({ where }),
    ]);

    return paginate(rows, total, page, limit);
  }

  async createOrganisation(
    dto: CreateOrganisationDto,
    actor: AuthUser,
    ip?: string | null,
  ) {
    if (dto.communeId) {
      const commune = await this.prisma.commune.findUnique({
        where: { id: dto.communeId },
      });
      if (!commune) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Unknown communeId',
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organisation.create({
        data: {
          name: dto.name,
          type: dto.type,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          communeId: dto.communeId ?? null,
          isReferenced: dto.isReferenced ?? true,
        },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'ORGANISATION_CREATED',
        entityType: 'Organisation',
        entityId: org.id,
        after: { name: org.name, type: org.type },
        ip,
      });

      return org;
    });
  }

  async createRapportIntervention(
    dto: CreateRapportInterventionDto,
    file: Express.Multer.File | undefined,
    actor: AuthUser,
    ip?: string | null,
  ) {
    this.documentsService.validateFilePresent(file);

    const ouvrage = await this.prisma.ouvrage.findUnique({
      where: { id: dto.ouvrageId },
      include: { dossier: true },
    });
    if (!ouvrage) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Water point not found',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // Strictly isolated from certification status/verdict: informational treatment report only
      const rapport = await tx.rapportIntervention.create({
        data: {
          ouvrageId: ouvrage.id,
          organisationId: actor.organisationId ?? null,
          submittedById: actor.id,
          summary: dto.summary ?? null,
          treatedAt: dto.treatedAt ? new Date(dto.treatedAt) : null,
        },
      });

      const doc = await this.documentsService.createFromBuffer(tx, {
        buffer: file.buffer,
        kind: DocumentKind.RAPPORT_TRAITEMENT,
        allowedMimes: [
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
        ],
        prefix: 'rapports-intervention',
        originalName: file.originalname,
        uploadedById: actor.id,
        ouvrageId: ouvrage.id,
        dossierId: ouvrage.dossier?.id,
        rapportId: rapport.id,
      });

      const updatedRapport = await tx.rapportIntervention.update({
        where: { id: rapport.id },
        data: { documentId: doc.id },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'RAPPORT_INTERVENTION_SUBMITTED',
        entityType: 'RapportIntervention',
        entityId: rapport.id,
        after: {
          ouvrageId: ouvrage.id,
          documentId: doc.id,
          treatedAt: updatedRapport.treatedAt,
        },
        ip,
      });

      return updatedRapport;
    });
  }
}
