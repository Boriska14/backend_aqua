import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../types/auth-user.type';

export type ScopeResourceType =
  | 'Ouvrage'
  | 'Demande'
  | 'Prelevement'
  | 'Analyse'
  | 'Certificat'
  | 'Signalement'
  | 'Paiement'
  | 'Subvention';

@Injectable()
export class ScopePolicyService {
  ouvrageWhere(user: AuthUser): Prisma.OuvrageWhereInput {
    switch (user.role) {
      case Role.MINEE:
      case Role.ADMIN:
        return {};
      case Role.AGENT_COMMUNAL:
      case Role.AGENT_PRELEVEUR:
        return { communeId: { in: this.communeIdsOrNone(user) } };
      case Role.PROPRIETAIRE:
        return { ownerId: user.id };
      case Role.ENTREPRISE_FORAGE_ONG:
        return user.organisationId
          ? { builderOrgId: user.organisationId }
          : { ownerId: user.id };
      case Role.LABORATOIRE:
        return user.laboratoireId
          ? {
              demandes: {
                some: { laboratoireId: user.laboratoireId },
              },
            }
          : { id: '__none__' };
      case Role.ENTREPRISE_TRAITEMENT:
        return {
          OR: [
            { isPublic: true },
            ...(user.organisationId
              ? [
                  {
                    rapports: { some: { organisationId: user.organisationId } },
                  },
                ]
              : []),
          ],
        };
      default:
        return { id: '__none__' };
    }
  }

  demandeWhere(user: AuthUser): Prisma.DemandeCertificationWhereInput {
    switch (user.role) {
      case Role.MINEE:
      case Role.ADMIN:
        return {};
      case Role.PROPRIETAIRE:
        return {
          OR: [{ applicantId: user.id }, { ouvrage: { ownerId: user.id } }],
        };
      case Role.ENTREPRISE_FORAGE_ONG:
        return {
          OR: [
            { applicantId: user.id },
            ...(user.organisationId
              ? [{ ouvrage: { builderOrgId: user.organisationId } }]
              : []),
          ],
        };
      case Role.AGENT_COMMUNAL:
      case Role.AGENT_PRELEVEUR:
        return {
          ouvrage: { communeId: { in: this.communeIdsOrNone(user) } },
        };
      case Role.LABORATOIRE:
        return user.laboratoireId
          ? { laboratoireId: user.laboratoireId }
          : { id: '__none__' };
      default:
        return { id: '__none__' };
    }
  }

  prelevementWhere(user: AuthUser): Prisma.PrelevementWhereInput {
    switch (user.role) {
      case Role.MINEE:
      case Role.ADMIN:
        return {};
      case Role.AGENT_PRELEVEUR:
        return {
          OR: [
            { agentId: user.id },
            {
              demande: {
                ouvrage: { communeId: { in: this.communeIdsOrNone(user) } },
              },
            },
          ],
        };
      case Role.AGENT_COMMUNAL:
        return {
          demande: {
            ouvrage: { communeId: { in: this.communeIdsOrNone(user) } },
          },
        };
      case Role.LABORATOIRE:
        return user.laboratoireId
          ? { laboratoireId: user.laboratoireId }
          : { id: '__none__' };
      case Role.PROPRIETAIRE:
        return { demande: { ouvrage: { ownerId: user.id } } };
      default:
        return { id: '__none__' };
    }
  }

  analyseWhere(user: AuthUser): Prisma.AnalyseResultatWhereInput {
    switch (user.role) {
      case Role.MINEE:
      case Role.ADMIN:
        return {};
      case Role.LABORATOIRE:
        return user.laboratoireId
          ? { laboratoireId: user.laboratoireId }
          : { id: '__none__' };
      case Role.AGENT_COMMUNAL:
        return {
          prelevement: {
            demande: {
              ouvrage: { communeId: { in: this.communeIdsOrNone(user) } },
            },
          },
        };
      case Role.PROPRIETAIRE:
        return {
          prelevement: {
            demande: { ouvrage: { ownerId: user.id } },
          },
        };
      default:
        return { id: '__none__' };
    }
  }

  certificatWhere(user: AuthUser): Prisma.CertificatWhereInput {
    switch (user.role) {
      case Role.MINEE:
      case Role.ADMIN:
        return {};
      case Role.AGENT_COMMUNAL:
      case Role.AGENT_PRELEVEUR:
        return {
          ouvrage: { communeId: { in: this.communeIdsOrNone(user) } },
        };
      case Role.PROPRIETAIRE:
        return { ouvrage: { ownerId: user.id } };
      default:
        return { id: '__none__' };
    }
  }

  signalementWhere(user: AuthUser): Prisma.SignalementWhereInput {
    switch (user.role) {
      case Role.MINEE:
      case Role.ADMIN:
        return {};
      case Role.AGENT_COMMUNAL:
        return { communeId: { in: this.communeIdsOrNone(user) } };
      default:
        return { id: '__none__' };
    }
  }

  paiementWhere(user: AuthUser): Prisma.PaiementWhereInput {
    switch (user.role) {
      case Role.MINEE:
      case Role.ADMIN:
        return {};
      case Role.AGENT_COMMUNAL:
        return {
          demande: {
            ouvrage: { communeId: { in: this.communeIdsOrNone(user) } },
          },
        };
      case Role.PROPRIETAIRE:
        return {
          demande: {
            OR: [{ applicantId: user.id }, { ouvrage: { ownerId: user.id } }],
          },
        };
      case Role.ENTREPRISE_FORAGE_ONG:
        return {
          demande: {
            OR: [
              { applicantId: user.id },
              ...(user.organisationId
                ? [{ ouvrage: { builderOrgId: user.organisationId } }]
                : []),
            ],
          },
        };
      default:
        return { id: '__none__' };
    }
  }

  subventionWhere(user: AuthUser): Prisma.SubventionWhereInput {
    switch (user.role) {
      case Role.MINEE:
      case Role.ADMIN:
        return {};
      case Role.AGENT_COMMUNAL:
        return {
          demande: {
            ouvrage: { communeId: { in: this.communeIdsOrNone(user) } },
          },
        };
      case Role.PROPRIETAIRE:
        return {
          demande: {
            OR: [{ applicantId: user.id }, { ouvrage: { ownerId: user.id } }],
          },
        };
      default:
        return { id: '__none__' };
    }
  }

  assertCanAccessOuvrage(
    user: AuthUser,
    ouvrage: {
      communeId: number;
      ownerId: string | null;
      builderOrgId: string | null;
      demandeLabIds?: (string | null)[];
    },
  ): void {
    if (user.role === Role.MINEE || user.role === Role.ADMIN) {
      return;
    }
    if (
      user.role === Role.AGENT_COMMUNAL ||
      user.role === Role.AGENT_PRELEVEUR
    ) {
      if (this.hasCommune(user, ouvrage.communeId)) {
        return;
      }
    } else if (user.role === Role.PROPRIETAIRE) {
      if (ouvrage.ownerId === user.id) {
        return;
      }
    } else if (user.role === Role.ENTREPRISE_FORAGE_ONG) {
      if (
        (user.organisationId && ouvrage.builderOrgId === user.organisationId) ||
        ouvrage.ownerId === user.id
      ) {
        return;
      }
    } else if (user.role === Role.LABORATOIRE) {
      if (
        user.laboratoireId &&
        ouvrage.demandeLabIds?.includes(user.laboratoireId)
      ) {
        return;
      }
    }
    this.deny();
  }

  assertCanAccessCommune(user: AuthUser, communeId: number | null): void {
    if (user.role === Role.MINEE || user.role === Role.ADMIN) {
      return;
    }
    if (communeId !== null && this.hasCommune(user, communeId)) {
      return;
    }
    this.deny();
  }

  assertCanAccessLabo(user: AuthUser, laboratoireId: string | null): void {
    if (user.role === Role.MINEE || user.role === Role.ADMIN) {
      return;
    }
    if (
      user.role === Role.LABORATOIRE &&
      user.laboratoireId &&
      laboratoireId === user.laboratoireId
    ) {
      return;
    }
    this.deny();
  }

  hasCommune(user: AuthUser, communeId: number): boolean {
    return user.communeScopeIds.includes(communeId);
  }

  private communeIdsOrNone(user: AuthUser): number[] {
    return user.communeScopeIds.length > 0 ? user.communeScopeIds : [-1];
  }

  deny(): never {
    throw new ForbiddenException({
      code: 'FORBIDDEN_SCOPE',
      message: 'Resource outside authorized scope',
    });
  }
}
