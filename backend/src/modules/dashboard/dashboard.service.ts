import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  AnalyseStatus,
  CertificatStatus,
  DemandeStatus,
  OuvrageStatus,
  Prisma,
  Role,
  SignalementStatus,
  Verdict,
} from '@prisma/client';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardQueryDto } from './dto/dashboard.dto';

const OPEN_SIGNALEMENT_STATUSES: SignalementStatus[] = [
  SignalementStatus.RECU,
  SignalementStatus.PRIS_EN_CHARGE,
  SignalementStatus.ESCALADE_MINEE,
];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getMineeDashboard(query: DashboardQueryDto) {
    const now = new Date();
    const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const fromDate = query.from ? new Date(query.from) : undefined;
    const toDate = query.to ? new Date(query.to) : undefined;
    const dateRange: Prisma.DateTimeFilter | undefined =
      fromDate || toDate
        ? {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          }
        : undefined;

    const ouvrageWhere: Prisma.OuvrageWhereInput = query.regionId
      ? { commune: { regionId: query.regionId } }
      : {};

    const certScope: Prisma.CertificatWhereInput = query.regionId
      ? { ouvrage: { commune: { regionId: query.regionId } } }
      : {};

    const [
      ouvragesTotal,
      ouvragesCertifies,
      analysesTotal,
      analysesConformes,
      certificatsExpirantDans60Jours,
      certificatsExpires,
      signalementsOuverts,
      certifiedCerts,
      communes,
    ] = await Promise.all([
      this.prisma.ouvrage.count({ where: ouvrageWhere }),
      this.prisma.ouvrage.count({
        where: { ...ouvrageWhere, status: OuvrageStatus.CERTIFIE },
      }),
      this.prisma.analyseResultat.count({
        where: {
          status: { in: [AnalyseStatus.SOUMISE, AnalyseStatus.AMENDEE] },
          ...(dateRange ? { submittedAt: dateRange } : {}),
          ...(query.regionId
            ? {
                prelevement: {
                  demande: {
                    ouvrage: { commune: { regionId: query.regionId } },
                  },
                },
              }
            : {}),
        },
      }),
      this.prisma.analyseResultat.count({
        where: {
          status: { in: [AnalyseStatus.SOUMISE, AnalyseStatus.AMENDEE] },
          verdict: Verdict.CONFORME,
          ...(dateRange ? { submittedAt: dateRange } : {}),
          ...(query.regionId
            ? {
                prelevement: {
                  demande: {
                    ouvrage: { commune: { regionId: query.regionId } },
                  },
                },
              }
            : {}),
        },
      }),
      this.prisma.certificat.count({
        where: {
          ...certScope,
          status: CertificatStatus.ACTIF,
          validUntil: { gte: now, lte: in60Days },
        },
      }),
      this.prisma.certificat.count({
        where: {
          ...certScope,
          status: CertificatStatus.EXPIRE,
        },
      }),
      this.prisma.signalement.count({
        where: {
          status: { in: OPEN_SIGNALEMENT_STATUSES },
          ...(dateRange ? { createdAt: dateRange } : {}),
          ...(query.regionId ? { commune: { regionId: query.regionId } } : {}),
        },
      }),
      this.prisma.certificat.findMany({
        where: {
          ...certScope,
          ...(dateRange ? { issuedAt: dateRange } : {}),
        },
        select: {
          issuedAt: true,
          demande: { select: { submittedAt: true } },
        },
        take: 1000,
      }),
      this.prisma.commune.findMany({
        where: query.regionId ? { regionId: query.regionId } : {},
        select: {
          id: true,
          name: true,
          region: { select: { code: true, name: true } },
          _count: {
            select: {
              ouvrages: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    const certifiedByCommune = await this.prisma.ouvrage.groupBy({
      by: ['communeId'],
      where: {
        ...ouvrageWhere,
        status: OuvrageStatus.CERTIFIE,
      },
      _count: { _all: true },
    });
    const certifiedMap = new Map(
      certifiedByCommune.map((c) => [c.communeId, c._count._all]),
    );

    const openSigByCommune = await this.prisma.signalement.groupBy({
      by: ['communeId'],
      where: {
        communeId: { not: null },
        status: { in: OPEN_SIGNALEMENT_STATUSES },
      },
      _count: { _all: true },
    });
    const openSigMap = new Map(
      openSigByCommune
        .filter((s) => s.communeId !== null)
        .map((s) => [s.communeId as number, s._count._all]),
    );

    const delaysDays = certifiedCerts
      .filter((c) => c.demande.submittedAt !== null)
      .map(
        (c) =>
          (c.issuedAt.getTime() - (c.demande.submittedAt as Date).getTime()) /
          (1000 * 60 * 60 * 24),
      )
      .filter((d) => d >= 0);

    const delaiMoyenDemandeValidationJours =
      delaysDays.length > 0
        ? Number(
            (
              delaysDays.reduce((acc, v) => acc + v, 0) / delaysDays.length
            ).toFixed(2),
          )
        : 0;

    return {
      pilot: 'Pilote en cours de validation',
      ouvragesTotal,
      ouvragesCertifies,
      tauxCouverture:
        ouvragesTotal > 0
          ? Number(((ouvragesCertifies / ouvragesTotal) * 100).toFixed(2))
          : 0,
      tauxConformite:
        analysesTotal > 0
          ? Number(((analysesConformes / analysesTotal) * 100).toFixed(2))
          : 0,
      delaiMoyenDemandeValidationJours,
      certificatsExpirantDans60Jours,
      certificatsExpires,
      signalementsOuverts,
      parCommune: communes.map((c) => ({
        communeId: c.id,
        communeName: c.name,
        regionCode: c.region.code,
        regionName: c.region.name,
        ouvragesTotal: c._count.ouvrages,
        ouvragesCertifies: certifiedMap.get(c.id) ?? 0,
        signalementsOuverts: openSigMap.get(c.id) ?? 0,
      })),
      generatedAt: now.toISOString(),
    };
  }

  async getCommuneDashboard(user: AuthUser) {
    if (
      user.role !== Role.AGENT_COMMUNAL ||
      user.communeScopeIds.length === 0
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_SCOPE',
        message: 'No municipality scope assigned',
      });
    }

    const now = new Date();
    const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const scopeIds = user.communeScopeIds;

    const [
      communes,
      ouvragesTotal,
      ouvragesCertifies,
      demandesEnCours,
      demandesAValiderCommune,
      certificatsExpirantDans60Jours,
      signalementsOuverts,
    ] = await Promise.all([
      this.prisma.commune.findMany({
        where: { id: { in: scopeIds } },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.ouvrage.count({ where: { communeId: { in: scopeIds } } }),
      this.prisma.ouvrage.count({
        where: { communeId: { in: scopeIds }, status: OuvrageStatus.CERTIFIE },
      }),
      this.prisma.demandeCertification.count({
        where: {
          ouvrage: { communeId: { in: scopeIds } },
          status: {
            notIn: [
              DemandeStatus.CERTIFIEE,
              DemandeStatus.REJETEE,
              DemandeStatus.ANNULEE,
            ],
          },
        },
      }),
      this.prisma.demandeCertification.count({
        where: {
          ouvrage: { communeId: { in: scopeIds } },
          status: DemandeStatus.SOUMISE,
        },
      }),
      this.prisma.certificat.count({
        where: {
          ouvrage: { communeId: { in: scopeIds } },
          status: CertificatStatus.ACTIF,
          validUntil: { gte: now, lte: in60Days },
        },
      }),
      this.prisma.signalement.count({
        where: {
          communeId: { in: scopeIds },
          status: { in: OPEN_SIGNALEMENT_STATUSES },
        },
      }),
    ]);

    return {
      pilot: 'Pilote en cours de validation',
      communes,
      ouvragesTotal,
      ouvragesCertifies,
      tauxCouverture:
        ouvragesTotal > 0
          ? Number(((ouvragesCertifies / ouvragesTotal) * 100).toFixed(2))
          : 0,
      demandesEnCours,
      demandesAValiderCommune,
      certificatsExpirantDans60Jours,
      signalementsOuverts,
      generatedAt: now.toISOString(),
    };
  }
}
