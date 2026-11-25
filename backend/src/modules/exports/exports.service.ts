import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../documents/storage.service';

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
  ) {}

  async createSystemExport(actor: AuthUser, ip?: string | null) {
    const exportId = randomUUID();
    const exportedAt = new Date().toISOString();

    const [
      regions,
      communes,
      users,
      laboratoires,
      organisations,
      ouvrages,
      dossiers,
      documents,
      demandes,
      demandeTransitions,
      paiements,
      recus,
      prelevements,
      normes,
      analyses,
      amendements,
      contreAnalyses,
      certificats,
      certificatTransitions,
      qrTokens,
      delegations,
      grilles,
      enveloppes,
      subventions,
      signalements,
      rapports,
      systemParameters,
      auditLogs,
    ] = await Promise.all([
      this.prisma.region.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.commune.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.user.findMany({
        select: {
          id: true,
          role: true,
          status: true,
          fullName: true,
          phone: true,
          email: true,
          locale: true,
          communeId: true,
          laboratoireId: true,
          organisationId: true,
          habilitationUntil: true,
          mfaEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.laboratoire.findMany(),
      this.prisma.organisation.findMany(),
      this.prisma.ouvrage.findMany(),
      this.prisma.dossierNumerique.findMany(),
      this.prisma.document.findMany(),
      this.prisma.demandeCertification.findMany(),
      this.prisma.demandeTransition.findMany(),
      this.prisma.paiement.findMany(),
      this.prisma.recu.findMany(),
      this.prisma.prelevement.findMany(),
      this.prisma.normeReferentiel.findMany({ include: { seuils: true } }),
      this.prisma.analyseResultat.findMany({
        include: { valeurs: true, procesVerbal: true },
      }),
      this.prisma.analyseAmendement.findMany(),
      this.prisma.contreAnalyse.findMany(),
      this.prisma.certificat.findMany(),
      this.prisma.certificatTransition.findMany(),
      this.prisma.qrToken.findMany(),
      this.prisma.delegationValidation.findMany(),
      this.prisma.grilleTarifaire.findMany({ include: { lignes: true } }),
      this.prisma.enveloppeSubvention.findMany(),
      this.prisma.subvention.findMany(),
      this.prisma.signalement.findMany(),
      this.prisma.rapportIntervention.findMany(),
      this.prisma.systemParameter.findMany(),
      this.prisma.auditLog.findMany({ orderBy: { seq: 'asc' } }),
    ]);

    const payload = {
      exportId,
      formatVersion: '1.0.0',
      pilot: 'Pilote en cours de validation',
      exportedAt,
      exportedBy: {
        id: actor.id,
        role: actor.role,
      },
      data: {
        regions,
        communes,
        users,
        laboratoires,
        organisations,
        ouvrages,
        dossiers,
        documents,
        demandes,
        demandeTransitions,
        paiements,
        recus,
        prelevements,
        normes,
        analyses,
        amendements,
        contreAnalyses,
        certificats,
        certificatTransitions,
        qrTokens,
        delegations,
        grilles,
        enveloppes,
        subventions,
        signalements,
        rapports,
        systemParameters,
        auditLogs,
      },
    };

    const jsonString = JSON.stringify(payload, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    const buffer = Buffer.from(jsonString, 'utf8');
    const uploaded = await this.storageService.uploadExportJson(buffer);

    const counts = {
      regions: regions.length,
      communes: communes.length,
      users: users.length,
      ouvrages: ouvrages.length,
      documents: documents.length,
      demandes: demandes.length,
      certificats: certificats.length,
      analyses: analyses.length,
      auditLogs: auditLogs.length,
    };

    await this.auditService.log(this.prisma, {
      actorId: actor.id,
      actorRole: actor.role,
      action: 'SYSTEM_EXPORT',
      entityType: 'System',
      entityId: exportId,
      after: {
        objectKey: uploaded.objectKey,
        sha256: uploaded.sha256,
        sizeBytes: uploaded.sizeBytes,
        counts,
      },
      ip,
    });

    return {
      exportId,
      exportedAt,
      objectKey: uploaded.objectKey,
      sha256: uploaded.sha256,
      sizeBytes: uploaded.sizeBytes,
      signedUrl: uploaded.signedUrl,
      counts,
    };
  }
}
