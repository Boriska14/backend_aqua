import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentKind, Prisma, Role } from '@prisma/client';
import { ScopePolicyService } from '../../common/guards/scope-policy.service';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AllowedMimeType, StorageService } from './storage.service';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly scopePolicy: ScopePolicyService,
    private readonly auditService: AuditService,
  ) {}

  async createFromBuffer(
    tx: Prisma.TransactionClient,
    params: {
      buffer: Buffer;
      kind: DocumentKind;
      allowedMimes?: AllowedMimeType[];
      prefix?: string;
      maxBytes?: number;
      originalName?: string;
      uploadedById?: string;
      ouvrageId?: string;
      dossierId?: string;
      demandeId?: string;
      prelevementId?: string;
      signalementId?: string;
      subventionId?: string;
      rapportId?: string;
    },
  ) {
    const uploaded = await this.storage.uploadBuffer(
      params.buffer,
      params.allowedMimes,
      params.prefix ?? 'documents',
      params.maxBytes,
    );

    return tx.document.create({
      data: {
        kind: params.kind,
        objectKey: uploaded.objectKey,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        sha256: uploaded.sha256,
        originalName: params.originalName ?? null,
        uploadedById: params.uploadedById ?? null,
        ouvrageId: params.ouvrageId ?? null,
        dossierId: params.dossierId ?? null,
        demandeId: params.demandeId ?? null,
        prelevementId: params.prelevementId ?? null,
        signalementId: params.signalementId ?? null,
        subventionId: params.subventionId ?? null,
        rapportId: params.rapportId ?? null,
      },
    });
  }

  async getSignedDownloadForUser(
    documentId: string,
    user: AuthUser,
    ip?: string | null,
  ) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        ouvrage: {
          include: {
            demandes: { select: { laboratoireId: true } },
          },
        },
        demande: {
          include: {
            ouvrage: {
              include: { demandes: { select: { laboratoireId: true } } },
            },
          },
        },
        signalement: true,
      },
    });

    if (!doc) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Document not found',
      });
    }

    if (user.role !== Role.MINEE && user.role !== Role.ADMIN) {
      const targetOuvrage = doc.ouvrage ?? doc.demande?.ouvrage ?? null;
      if (targetOuvrage) {
        this.scopePolicy.assertCanAccessOuvrage(user, {
          communeId: targetOuvrage.communeId,
          ownerId: targetOuvrage.ownerId,
          builderOrgId: targetOuvrage.builderOrgId,
          demandeLabIds: targetOuvrage.demandes.map((d) => d.laboratoireId),
        });
      } else if (doc.signalement) {
        this.scopePolicy.assertCanAccessCommune(
          user,
          doc.signalement.communeId,
        );
      } else if (doc.uploadedById !== user.id) {
        throw new ForbiddenException({
          code: 'FORBIDDEN_SCOPE',
          message: 'Access denied to document',
        });
      }
    }

    const url = await this.storage.createSignedDownloadUrl(doc.objectKey);

    await this.auditService.log(this.prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: 'DOCUMENT_DOWNLOAD_SIGNED',
      entityType: 'Document',
      entityId: doc.id,
      ip,
    });

    return { url, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes };
  }

  validateFilePresent(
    file?: Express.Multer.File,
  ): asserts file is Express.Multer.File {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'File upload is required',
      });
    }
  }
}
