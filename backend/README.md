# AquaSafe Backend API (Pilote en cours de validation)

API REST modulaire (**NestJS 11 + Prisma 7 + PostgreSQL 16 / PostGIS + MinIO S3**) pour la certification de la qualité de l'eau des forages et puits aménagés au Cameroun.

## Prérequis

- Node.js >= 22 LTS
- Docker & Docker Compose (PostgreSQL 16 + PostGIS 3.4, MinIO)

## Installation & Démarrage Local

```bash
cd backend
cp .env.example .env
# Renseigner les secrets (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, TOTP_ENCRYPTION_KEY, IP_HASH_SALT)

docker compose up -d db minio minio-init
npm install
npx prisma generate

# Créer la migration initiale puis y inclure les contraintes SQL/PostGIS/triggers d'audit
npx prisma migrate dev --create-only --name init
cat prisma/sql/001_integrity.sql >> prisma/migrations/*_init/migration.sql
npx prisma migrate dev

# Peupler les 10 régions, les paramètres système, l'ADMIN initial et des référentiels BROUILLON vides
npm run seed

# Lancer l'API (Swagger disponible sur /api/docs)
npm run start:dev
```

## Scripts Principaux

- `npm run build` — Compile le projet TypeScript NestJS (`dist/`)
- `npm run lint` — Vérifie les règles ESLint
- `npm test` — Lance les tests unitaires Jest
- `npm run test:e2e` — Lance les tests E2E Supertest
- `npm run seed` — Initialise la base pilote sans données sanitaires/tarifaires codées en dur
- `./scripts/backup.sh` — Sauvegarde PostgreSQL chiffrée GPG + empreinte SHA-256
- `./scripts/restore.sh <fichier>` — Restauration + contrôle d'intégrité `audit_verify_chain()`

## Couverture Fonctionnelle & Non-Fonctionnelle

- **Socle & Sécurité** : Auth OTP SMS (`SmsProvider`), Login staff `argon2id` + TOTP chiffré AES-256-GCM + 10 codes de secours (`EF-02`, `EF-03`), Refresh tokens rotatifs avec détection de réutilisation, RBAC + `ScopePolicyService` + `StrongAuthGuard` (`EF-01`).
- **Ouvrages & Géo** : Anti-doublon `ST_DWithin` 15 m et `sieId`, numérotation séquentielle, dossier numérique, import SIE CSV/XLSX par lots de 500 avec `dryRun` et `ST_Contains` (`EF-04`..`EF-07`).
- **Chaîne de certification** : Grilles tarifaires versionnées + snapshot tarifaire (`EF-10`), demandes 6 étapes (`EF-08`, `EF-09`), paiements manuels + reçus PDF (`EF-11`), prélèvements + synchronisation hors-ligne idempotente `PrelevementSyncQueue` (`EF-13`, `EN-05`), normes versionnées + moteur de verdict pur + PV SHA-256 + amendements + contre-analyses inter-labos (`EF-14`..`EF-17`, `EF-36`).
- **Certificats, QR & Public** : Validation par lot MINEE + délégations (`EF-18`), certificats 6 états + QR base62 opaque + révocation synchrone + PDF filigrané bilingue FR/EN (`EF-19`..`EF-22`), vérification QR 5 états à temps constant + carte GeoJSON clusterisée (`EF-23`, `EF-24`, `EF-28`).
- **Alertes, Pilotage & Réversibilité** : Signalements citoyens avec routage PostGIS et anti-abus 5/h/IP (`EF-25`), notifications outbox + jobs cron (`EF-31`), tableaux de bord MINEE/commune (`EF-29`, `EF-30`), annuaire & rapports d'intervention (`EF-32`..`EF-34`), subventions manuelles (`EF-35`), journal d'audit chaîné SHA-256 (`EF-37`), export système complet (`EN-12`), i18n FR/EN (`EN-02`), erreurs RFC 7807.
- **Hors périmètre pilote (non codés)** : `EF-12` passerelle de paiement automatique, `EF-27` vérification SMS automatique, `EF-38` exports CSV/GeoJSON ouverts.
