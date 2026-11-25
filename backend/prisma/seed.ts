import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  GrilleStatus,
  NormeStatus,
  PrismaClient,
  Role,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { Pool } from 'pg';

const CAMEROON_REGIONS = [
  { code: 'AD', name: 'Adamaoua' },
  { code: 'CE', name: 'Centre' },
  { code: 'EN', name: 'Extrême-Nord' },
  { code: 'ES', name: 'Est' },
  { code: 'LT', name: 'Littoral' },
  { code: 'NO', name: 'Nord' },
  { code: 'NW', name: 'Nord-Ouest' },
  { code: 'OU', name: 'Ouest' },
  { code: 'SU', name: 'Sud' },
  { code: 'SW', name: 'Sud-Ouest' },
];

const DEFAULT_SYSTEM_PARAMETERS: Array<{
  key: string;
  value: unknown;
  description: string;
}> = [
  {
    key: 'duplicateRadiusM',
    value: 15,
    description: 'Rayon anti-doublon d’ouvrage en mètres (EF-04)',
  },
  {
    key: 'minPaidPercentBeforeSampling',
    value: 100,
    description:
      'Pourcentage minimal payé (sur tarif net) pour débloquer le prélèvement (Décision D5)',
  },
  {
    key: 'paymentConfirmRoles',
    value: ['ADMIN'],
    description: 'Rôles autorisés à confirmer un paiement manuel (Décision D2)',
  },
  {
    key: 'contreAnalyseMaxDelayDays',
    value: 15,
    description:
      'Délai maximal en jours pour ouvrir une contre-analyse après résultat non conforme (Décision D4b)',
  },
  {
    key: 'contreAnalyseMaxCount',
    value: 1,
    description:
      'Nombre maximal de contre-analyses par demande (Décision D4b)',
  },
  {
    key: 'unconfirmedPlaqueDays',
    value: 14,
    description:
      'Délai avant relance hebdomadaire des plaques EMIS non confirmées',
  },
  {
    key: 'ouvrageNumberPrefix',
    value: 'AS',
    description: 'Préfixe de numérotation publique des ouvrages (Décision D9)',
  },
  {
    key: 'personalDataRetentionDays',
    value: 1825,
    description:
      'Durée de conservation des données personnelles en jours (Décision D8)',
  },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set before running seed');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // 1. 10 regions of Cameroon (idempotent)
    for (const region of CAMEROON_REGIONS) {
      await prisma.region.upsert({
        where: { code: region.code },
        update: { name: region.name },
        create: { code: region.code, name: region.name },
      });
    }

    // 2. Default system parameters (only create missing keys so MOA overrides are preserved)
    for (const param of DEFAULT_SYSTEM_PARAMETERS) {
      const existing = await prisma.systemParameter.findUnique({
        where: { key: param.key },
      });
      if (!existing) {
        await prisma.systemParameter.create({
          data: {
            key: param.key,
            value: param.value as never,
            description: param.description,
          },
        });
      }
    }

    // 3. Initial ADMIN account (forced password change & 2FA enrollment on first login)
    const adminPhone = process.env.SEED_ADMIN_PHONE || '+237600000001';
    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@aquasafe.local';
    const existingAdmin = await prisma.user.findFirst({
      where: { role: Role.ADMIN },
    });

    if (!existingAdmin) {
      const initialPassword =
        process.env.SEED_ADMIN_PASSWORD || randomBytes(12).toString('base64url');
      const passwordHash = await argon2.hash(initialPassword, {
        type: argon2.argon2id,
      });

      await prisma.user.create({
        data: {
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
          fullName: 'Administrateur Initial AquaSafe',
          phone: adminPhone,
          email: adminEmail,
          passwordHash,
          locale: 'fr',
          mfaEnabled: false,
          mustChangePassword: true,
        },
      });

      console.log(
        `[SEED] Initial ADMIN created (phone=${adminPhone}, email=${adminEmail}).`,
      );
      if (!process.env.SEED_ADMIN_PASSWORD) {
        console.log(
          `[SEED] Generated temporary ADMIN password (change immediately & enroll 2FA): ${initialPassword}`,
        );
      }
    } else {
      console.log('[SEED] Existing ADMIN account preserved.');
    }

    // 4. Empty NormeReferentiel in BROUILLON (ZERO hardcoded NC 207 thresholds - Décision D7)
    const existingNorme = await prisma.normeReferentiel.findFirst({
      where: { code: 'NC-207', version: 'draft-1' },
    });
    if (!existingNorme) {
      await prisma.normeReferentiel.create({
        data: {
          code: 'NC-207',
          version: 'draft-1',
          status: NormeStatus.BROUILLON,
          validityMonths: null,
        },
      });
      console.log(
        '[SEED] Created empty NormeReferentiel NC-207 (draft-1) in BROUILLON without thresholds.',
      );
    }

    // 5. Empty GrilleTarifaire in BROUILLON (ZERO hardcoded tariffs - EF-10)
    const existingGrille = await prisma.grilleTarifaire.findFirst({
      where: { name: 'Grille pilote initiale (à paramétrer)' },
    });
    if (!existingGrille) {
      await prisma.grilleTarifaire.create({
        data: {
          name: 'Grille pilote initiale (à paramétrer)',
          version: 1,
          status: GrilleStatus.BROUILLON,
        },
      });
      console.log(
        '[SEED] Created empty GrilleTarifaire in BROUILLON without tariff lines.',
      );
    }

    console.log('[SEED] Completed successfully.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[SEED] Failed:', err);
  process.exit(1);
});
