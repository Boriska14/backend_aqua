import { Injectable } from '@nestjs/common';
import {
  CertificatStatus,
  DemandeStatus,
  OuvrageStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type PrismaTx = Prisma.TransactionClient | PrismaService;

const TERMINAL_DEMANDE_STATUSES: DemandeStatus[] = [
  DemandeStatus.CERTIFIEE,
  DemandeStatus.REJETEE,
  DemandeStatus.ANNULEE,
];

@Injectable()
export class OuvrageStatusService {
  async recalculate(tx: PrismaTx, ouvrageId: string): Promise<OuvrageStatus> {
    const ouvrage = await tx.ouvrage.findUniqueOrThrow({
      where: { id: ouvrageId },
    });

    if (ouvrage.status === OuvrageStatus.HORS_SERVICE) {
      return OuvrageStatus.HORS_SERVICE;
    }

    const now = new Date();
    const latestCert = await tx.certificat.findFirst({
      where: {
        ouvrageId,
        status: {
          in: [
            CertificatStatus.ACTIF,
            CertificatStatus.SUSPENDU,
            CertificatStatus.EXPIRE,
            CertificatStatus.RETIRE,
            CertificatStatus.EMIS,
          ],
        },
      },
      orderBy: { issuedAt: 'desc' },
    });

    let nextStatus: OuvrageStatus = OuvrageStatus.NON_ENREGISTRE_CERTIF;

    if (latestCert) {
      if (
        latestCert.status === CertificatStatus.ACTIF &&
        (!latestCert.validUntil || latestCert.validUntil >= now)
      ) {
        nextStatus = OuvrageStatus.CERTIFIE;
      } else if (
        latestCert.status === CertificatStatus.EXPIRE ||
        (latestCert.status === CertificatStatus.ACTIF &&
          latestCert.validUntil &&
          latestCert.validUntil < now)
      ) {
        nextStatus = OuvrageStatus.CERTIF_EXPIREE;
      }
    }

    if (nextStatus === OuvrageStatus.NON_ENREGISTRE_CERTIF) {
      const latestDemande = await tx.demandeCertification.findFirst({
        where: { ouvrageId },
        orderBy: { createdAt: 'desc' },
      });
      if (latestDemande) {
        if (latestDemande.status === DemandeStatus.NON_CONFORME) {
          nextStatus = OuvrageStatus.NON_CONFORME;
        } else if (!TERMINAL_DEMANDE_STATUSES.includes(latestDemande.status)) {
          nextStatus = OuvrageStatus.EN_ATTENTE;
        }
      }
    }

    if (nextStatus !== ouvrage.status) {
      await tx.ouvrage.update({
        where: { id: ouvrageId },
        data: { status: nextStatus },
      });
    }

    return nextStatus;
  }
}
