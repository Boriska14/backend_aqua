import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AmendementStatus,
  AnalyseStatus,
  ContreAnalyseStatus,
  DemandeStatus,
  DocumentKind,
  NotificationChannel,
  PrelevementStatus,
  Prisma,
  Role,
  Verdict,
} from '@prisma/client';
import { ScopePolicyService } from '../../common/guards/scope-policy.service';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DemandeStateMachineService } from '../demandes/demande-state-machine.service';
import { DocumentsService } from '../documents/documents.service';
import { NormesService } from '../normes/normes.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AmendementDecisionChoice,
  CreateAmendementDto,
  DecideAmendementDto,
  ListAnalysesQueryDto,
  OpenAnalyseDto,
  PutAnalyseValeursDto,
} from './dto/analyse.dto';
import { computeVerdict } from './verdict.engine';

@Injectable()
export class AnalysesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopePolicy: ScopePolicyService,
    private readonly normesService: NormesService,
    private readonly documentsService: DocumentsService,
    private readonly stateMachine: DemandeStateMachineService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthUser, query: ListAnalysesQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const scopeWhere = this.scopePolicy.analyseWhere(user);
    const where: Prisma.AnalyseResultatWhereInput = {
      AND: [scopeWhere, { ...(query.status ? { status: query.status } : {}) }],
    };

    const [rows, total] = await Promise.all([
      this.prisma.analyseResultat.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          referentiel: { select: { code: true, version: true } },
          prelevement: { select: { demandeId: true, bottleCode: true } },
        },
      }),
      this.prisma.analyseResultat.count({ where }),
    ]);

    return paginate(rows, total, page, limit);
  }

  async findOne(user: AuthUser, id: string) {
    const analyse = await this.prisma.analyseResultat.findUnique({
      where: { id },
      include: {
        referentiel: { include: { seuils: true } },
        valeurs: { include: { seuil: true } },
        procesVerbal: true,
        amendements: { orderBy: { createdAt: 'desc' } },
        prelevement: { include: { demande: { include: { ouvrage: true } } } },
      },
    });
    if (!analyse) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Analyse not found',
      });
    }

    this.scopePolicy.assertCanAccessOuvrage(user, {
      communeId: analyse.prelevement.demande.ouvrage.communeId,
      ownerId: analyse.prelevement.demande.ouvrage.ownerId,
      builderOrgId: analyse.prelevement.demande.ouvrage.builderOrgId,
      demandeLabIds: [analyse.laboratoireId],
    });

    return {
      id: analyse.id,
      status: analyse.status,
      verdict: analyse.verdict,
      version: analyse.version,
      referentiel: `${analyse.referentiel.code} ${analyse.referentiel.version}`,
      procesVerbal: analyse.procesVerbal,
      amendements: analyse.amendements,
      values: analyse.valeurs.map((v) => ({
        parameterCode: v.parameterCode,
        label: v.seuil.label,
        unit: v.seuil.unit,
        value: v.value,
        presence: v.presence,
        min: v.seuil.minValue,
        max: v.seuil.maxValue,
        isCompliant: v.isCompliant,
      })),
    };
  }

  async open(user: AuthUser, dto: OpenAnalyseDto, ip?: string | null) {
    const prelevement = await this.prisma.prelevement.findUnique({
      where: { id: dto.prelevementId },
      include: { analyse: true },
    });
    if (!prelevement) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Prelevement not found',
      });
    }

    this.scopePolicy.assertCanAccessLabo(user, prelevement.laboratoireId);

    if (prelevement.status !== PrelevementStatus.RECU_LABO) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Prelevement must be received by laboratory first',
      });
    }
    if (prelevement.analyse) {
      return prelevement.analyse;
    }

    const activeNorme = await this.normesService.getActivePublished();

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.analyseResultat.create({
        data: {
          prelevementId: prelevement.id,
          laboratoireId: prelevement.laboratoireId,
          referentielId: activeNorme.id,
          status: AnalyseStatus.EN_SAISIE,
        },
      });

      const contre = await tx.contreAnalyse.findUnique({
        where: { newPrelevementId: prelevement.id },
      });
      if (contre) {
        await tx.contreAnalyse.update({
          where: { id: contre.id },
          data: { newAnalyseId: created.id },
        });
      }

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'ANALYSE_OPENED',
        entityType: 'AnalyseResultat',
        entityId: created.id,
        after: { referentielId: activeNorme.id },
        ip,
      });

      return created;
    });
  }

  async putValues(
    user: AuthUser,
    analyseId: string,
    dto: PutAnalyseValeursDto,
    ip?: string | null,
  ) {
    const analyse = await this.prisma.analyseResultat.findUnique({
      where: { id: analyseId },
      include: { referentiel: { include: { seuils: true } } },
    });
    if (!analyse) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Analyse not found',
      });
    }

    this.scopePolicy.assertCanAccessLabo(user, analyse.laboratoireId);

    if (analyse.status !== AnalyseStatus.EN_SAISIE) {
      throw new ConflictException({
        code: 'ANALYSE_LOCKED',
        message: 'Analysis is locked; request an amendment',
      });
    }

    const verdictResult = computeVerdict(
      analyse.referentiel.seuils,
      dto.values,
    );
    const seuilByCode = new Map(
      analyse.referentiel.seuils.map((s) => [s.parameterCode.toUpperCase(), s]),
    );
    const inputByCode = new Map(
      dto.values.map((v) => [v.parameterCode.trim().toUpperCase(), v]),
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.analyseValeur.deleteMany({ where: { analyseId } });

      const rowsToInsert: Prisma.AnalyseValeurCreateManyInput[] = [];
      for (const evalItem of verdictResult.evaluated) {
        const seuil = seuilByCode.get(evalItem.parameterCode);
        const input = inputByCode.get(evalItem.parameterCode);
        if (!seuil || !input) continue;
        rowsToInsert.push({
          analyseId,
          seuilId: seuil.id,
          parameterCode: evalItem.parameterCode,
          value: input.value ?? null,
          presence: input.presence ?? null,
          isCompliant: evalItem.isCompliant,
        });
      }

      if (rowsToInsert.length > 0) {
        await tx.analyseValeur.createMany({ data: rowsToInsert });
      }

      const updated = await tx.analyseResultat.update({
        where: { id: analyseId },
        data: {
          verdict: verdictResult.verdict,
          analystComment: dto.analystComment ?? analyse.analystComment,
          analysedAt: dto.analysedAt
            ? new Date(dto.analysedAt)
            : (analyse.analysedAt ?? new Date()),
        },
        include: { valeurs: true },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'ANALYSE_VALUES_SAVED',
        entityType: 'AnalyseResultat',
        entityId: analyseId,
        after: {
          provisionalVerdict: verdictResult.verdict,
          valuesCount: rowsToInsert.length,
        },
        ip,
      });

      return {
        ...updated,
        missingMandatory: verdictResult.missingMandatory,
      };
    });
  }

  async uploadProcesVerbal(
    user: AuthUser,
    analyseId: string,
    file: Express.Multer.File,
    ip?: string | null,
  ) {
    this.documentsService.validateFilePresent(file);

    const analyse = await this.prisma.analyseResultat.findUnique({
      where: { id: analyseId },
      include: {
        procesVerbal: true,
        prelevement: {
          include: {
            demande: { include: { ouvrage: { include: { dossier: true } } } },
          },
        },
      },
    });
    if (!analyse) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Analyse not found',
      });
    }

    this.scopePolicy.assertCanAccessLabo(user, analyse.laboratoireId);

    if (analyse.procesVerbal) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Proces-verbal already uploaded (immutable)',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const doc = await this.documentsService.createFromBuffer(tx, {
        buffer: file.buffer,
        kind: DocumentKind.PV_ANALYSE,
        allowedMimes: ['application/pdf'],
        prefix: 'proces-verbaux',
        originalName: file.originalname,
        uploadedById: user.id,
        ouvrageId: analyse.prelevement.demande.ouvrageId,
        dossierId: analyse.prelevement.demande.ouvrage.dossier?.id,
        demandeId: analyse.prelevement.demandeId,
        prelevementId: analyse.prelevementId,
      });

      const pv = await tx.procesVerbal.create({
        data: {
          analyseId: analyse.id,
          documentId: doc.id,
          sha256: doc.sha256,
          uploadedById: user.id,
        },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'PROCES_VERBAL_UPLOADED',
        entityType: 'ProcesVerbal',
        entityId: pv.id,
        after: { sha256: pv.sha256 },
        ip,
      });

      return pv;
    });
  }

  async submit(user: AuthUser, analyseId: string, ip?: string | null) {
    const analyse = await this.prisma.analyseResultat.findUnique({
      where: { id: analyseId },
      include: {
        referentiel: { include: { seuils: true } },
        valeurs: true,
        procesVerbal: true,
        contreAnalyseResultat: true,
        prelevement: {
          include: {
            demande: { include: { ouvrage: true } },
          },
        },
      },
    });
    if (!analyse) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Analyse not found',
      });
    }

    this.scopePolicy.assertCanAccessLabo(user, analyse.laboratoireId);

    if (analyse.status !== AnalyseStatus.EN_SAISIE) {
      throw new ConflictException({
        code: 'ANALYSE_LOCKED',
        message: 'Analysis already submitted',
      });
    }

    if (!analyse.procesVerbal) {
      throw new ConflictException({
        code: 'PV_REQUIRED',
        message: 'Signed PV PDF must be uploaded before submission',
      });
    }

    const verdictResult = computeVerdict(
      analyse.referentiel.seuils,
      analyse.valeurs.map((v) => ({
        parameterCode: v.parameterCode,
        value: v.value,
        presence: v.presence,
      })),
    );

    if (verdictResult.missingMandatory.length > 0) {
      throw new ConflictException({
        code: 'ANALYSE_INCOMPLETE',
        message: `Missing mandatory parameters: ${verdictResult.missingMandatory.join(', ')}`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const submitted = await tx.analyseResultat.update({
        where: { id: analyseId },
        data: {
          status: AnalyseStatus.SOUMISE,
          verdict: verdictResult.verdict,
          submittedAt: new Date(),
          submittedById: user.id,
        },
      });

      await tx.ouvrage.update({
        where: { id: analyse.prelevement.demande.ouvrageId },
        data: { lastControlAt: new Date() },
      });

      const demande = analyse.prelevement.demande;
      const targetNext =
        verdictResult.verdict === Verdict.CONFORME
          ? DemandeStatus.EN_VALIDATION_MINEE
          : DemandeStatus.NON_CONFORME;

      if (analyse.contreAnalyseResultat) {
        await tx.contreAnalyse.update({
          where: { id: analyse.contreAnalyseResultat.id },
          data: { status: ContreAnalyseStatus.TERMINEE },
        });
        await this.stateMachine.transition(tx, {
          demandeId: demande.id,
          toStatus: targetNext,
          actorId: user.id,
          actorRole: user.role,
          ip,
        });
      } else {
        await this.stateMachine.transition(tx, {
          demandeId: demande.id,
          toStatus: DemandeStatus.ANALYSE_SOUMISE,
          actorId: user.id,
          actorRole: user.role,
          ip,
        });
        await this.stateMachine.transition(tx, {
          demandeId: demande.id,
          toStatus: targetNext,
          actorId: user.id,
          actorRole: user.role,
          ip,
        });
      }

      if (verdictResult.verdict === Verdict.NON_CONFORME_GRAVE) {
        const recipients = await tx.user.findMany({
          where: {
            OR: [
              { role: Role.MINEE },
              {
                role: Role.AGENT_COMMUNAL,
                communeScopes: {
                  some: { communeId: demande.ouvrage.communeId },
                },
              },
            ],
          },
          select: { id: true, email: true, phone: true },
        });
        for (const r of recipients) {
          await this.notifications.enqueue(tx, {
            userId: r.id,
            channel: NotificationChannel.IN_APP,
            recipient: r.id,
            templateCode: 'ALERTE_SANITAIRE_GRAVE',
            payload: {
              ouvrageNumber: demande.ouvrage.aquasafeNumber,
              demandeReference: demande.reference,
              analyseId: submitted.id,
            },
            idempotencyKey: `ALERTE_GRAVE:${submitted.id}:${r.id}`,
          });
        }
      }

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'ANALYSE_SUBMITTED',
        entityType: 'AnalyseResultat',
        entityId: submitted.id,
        after: { verdict: submitted.verdict },
        ip,
      });

      return submitted;
    });
  }

  async requestAmendement(
    user: AuthUser,
    analyseId: string,
    dto: CreateAmendementDto,
    ip?: string | null,
  ) {
    const analyse = await this.prisma.analyseResultat.findUnique({
      where: { id: analyseId },
    });
    if (!analyse) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Analyse not found',
      });
    }

    this.scopePolicy.assertCanAccessLabo(user, analyse.laboratoireId);

    if (analyse.status === AnalyseStatus.EN_SAISIE) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'Analysis is still editable; update values directly',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.analyseAmendement.create({
        data: {
          analyseId,
          requestedById: user.id,
          reason: dto.reason,
          changes: dto.changes as unknown as Prisma.InputJsonValue,
          status: AmendementStatus.EN_ATTENTE,
        },
      });

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'ANALYSE_AMENDEMENT_REQUESTED',
        entityType: 'AnalyseAmendement',
        entityId: created.id,
        reason: dto.reason,
        ip,
      });

      return created;
    });
  }

  async decideAmendement(
    user: AuthUser,
    amendementId: string,
    dto: DecideAmendementDto,
    ip?: string | null,
  ) {
    const amendement = await this.prisma.analyseAmendement.findUnique({
      where: { id: amendementId },
      include: {
        analyse: {
          include: {
            referentiel: { include: { seuils: true } },
            valeurs: true,
          },
        },
      },
    });
    if (!amendement) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Amendement not found',
      });
    }
    if (amendement.status !== AmendementStatus.EN_ATTENTE) {
      throw new ConflictException({
        code: 'AMENDEMENT_ALREADY_DECIDED',
        message: 'Amendment already decided',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const nextStatus =
        dto.decision === AmendementDecisionChoice.APPROUVER
          ? AmendementStatus.APPROUVE
          : AmendementStatus.REFUSE;

      const updatedAmendement = await tx.analyseAmendement.update({
        where: { id: amendementId },
        data: {
          status: nextStatus,
          decidedById: user.id,
          decisionReason: dto.reason ?? null,
          decidedAt: new Date(),
        },
      });

      if (nextStatus === AmendementStatus.APPROUVE) {
        const changes =
          (amendement.changes as Array<{
            parameterCode: string;
            after?: number;
            presence?: boolean;
          }>) || [];
        const mergedValues = amendement.analyse.valeurs.map((v) => {
          const patch = changes.find(
            (c) =>
              c.parameterCode.toUpperCase() === v.parameterCode.toUpperCase(),
          );
          return {
            parameterCode: v.parameterCode,
            value: patch?.after ?? v.value,
            presence: patch?.presence ?? v.presence,
          };
        });
        const newVerdict = computeVerdict(
          amendement.analyse.referentiel.seuils,
          mergedValues,
        );

        await tx.analyseResultat.update({
          where: { id: amendement.analyseId },
          data: {
            status: AnalyseStatus.AMENDEE,
            verdict: newVerdict.verdict,
            version: { increment: 1 },
          },
        });
      }

      await this.auditService.log(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: `ANALYSE_AMENDEMENT_${nextStatus}`,
        entityType: 'AnalyseAmendement',
        entityId: amendementId,
        reason: dto.reason ?? null,
        ip,
      });

      return updatedAmendement;
    });
  }
}
