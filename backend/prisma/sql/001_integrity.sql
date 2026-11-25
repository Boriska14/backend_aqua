-- AquaSafe — 001_integrity.sql
-- À appliquer APRÈS la migration Prisma initiale : `prisma migrate dev --create-only`, puis coller ce fichier
-- dans le dossier de migration généré. Prisma ne sait pas exprimer ces objets.
-- Noms de colonnes : camelCase cités ("ouvrageId"), car le schéma Prisma n'utilise pas @map sur les champs.
-- Tables : snake_case (@@map).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────── 1. Colonnes géométriques ─────────────
ALTER TABLE ouvrages ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);
CREATE INDEX IF NOT EXISTS ouvrages_location_gix ON ouvrages USING GIST (location);

ALTER TABLE communes ADD COLUMN IF NOT EXISTS boundary geometry(MultiPolygon, 4326);
CREATE INDEX IF NOT EXISTS communes_boundary_gix ON communes USING GIST (boundary);

-- location dérivée de latitude/longitude (source de vérité unique = lat/lng)
CREATE OR REPLACE FUNCTION ouvrages_sync_location() RETURNS trigger AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude::float8, NEW.latitude::float8), 4326);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ouvrages_location ON ouvrages;
CREATE TRIGGER trg_ouvrages_location BEFORE INSERT OR UPDATE OF latitude, longitude ON ouvrages
FOR EACH ROW EXECUTE FUNCTION ouvrages_sync_location();

-- Anti-doublon géographique (EF-04), appelé par le service via $queryRaw :
-- SELECT id FROM ouvrages
--  WHERE type = $1
--    AND ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($lng,$lat),4326)::geography, 15);

-- ───────────── 2. Audit : ajout seul + chaînage calculé en base ─────────────
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log est en ajout seul (% interdit)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

DROP TRIGGER IF EXISTS trg_audit_no_truncate ON audit_log;
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_log
FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutation();

-- Le hash est calculé PAR LA BASE : le service insère sans prevHash/hash (renseigner des valeurs bidon à l'INSERT,
-- le trigger les écrase). Ainsi un bug ou une injection applicative ne peut pas forger la chaîne.
CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger AS $$
DECLARE last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(727001);  -- sérialise les écritures (volume pilote faible)
  SELECT hash INTO last_hash FROM audit_log ORDER BY seq DESC LIMIT 1;
  NEW."prevHash" := COALESCE(last_hash, repeat('0', 64));
  NEW.hash := encode(digest(
      NEW."prevHash" || '|' || to_char(NEW.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
      COALESCE(NEW."actorId"::text, '') || '|' || NEW.action || '|' || NEW."entityType" || '|' || NEW."entityId" || '|' ||
      COALESCE(NEW."after"::text, '') || COALESCE(NEW."before"::text, '') || COALESCE(NEW.reason, ''),
      'sha256'), 'hex');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_chain ON audit_log;
CREATE TRIGGER trg_audit_chain BEFORE INSERT ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_chain();
-- Note Prisma : "prevHash" et hash sont NOT NULL dans le schéma ; le service passe des chaînes vides à l'INSERT.

-- Vérification de chaîne (appelée par GET /audit-logs/verify-chain) : renvoie les seq incohérents
CREATE OR REPLACE FUNCTION audit_verify_chain() RETURNS TABLE(broken_seq bigint) AS $$
  SELECT a.seq
  FROM audit_log a
  LEFT JOIN LATERAL (SELECT hash FROM audit_log WHERE seq < a.seq ORDER BY seq DESC LIMIT 1) p ON true
  WHERE a."prevHash" <> COALESCE(p.hash, repeat('0', 64))
     OR a.hash <> encode(digest(
        a."prevHash" || '|' || to_char(a.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
        COALESCE(a."actorId"::text, '') || '|' || a.action || '|' || a."entityType" || '|' || a."entityId" || '|' ||
        COALESCE(a."after"::text, '') || COALESCE(a."before"::text, '') || COALESCE(a.reason, ''), 'sha256'), 'hex')
  ORDER BY a.seq;
$$ LANGUAGE sql STABLE;

-- ───────────── 3. Immutabilité métier ─────────────
-- Analyse soumise : valeurs verrouillées (EF-16). Correction = AnalyseAmendement uniquement.
CREATE OR REPLACE FUNCTION analyse_valeurs_lock() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status::text INTO st FROM analyse_resultats WHERE id = COALESCE(NEW."analyseId", OLD."analyseId");
  IF st <> 'EN_SAISIE' THEN
    RAISE EXCEPTION 'Analyse verrouillée : utiliser un amendement';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_valeurs_lock ON analyse_valeurs;
CREATE TRIGGER trg_valeurs_lock BEFORE INSERT OR UPDATE OR DELETE ON analyse_valeurs
FOR EACH ROW EXECUTE FUNCTION analyse_valeurs_lock();

-- PV, transitions de certificat, reçus : jamais modifiés ni supprimés
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% interdit sur %', TG_OP, TG_TABLE_NAME; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pv_immutable ON proces_verbaux;
CREATE TRIGGER trg_pv_immutable BEFORE UPDATE OR DELETE ON proces_verbaux
FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS trg_cert_trans_immutable ON certificat_transitions;
CREATE TRIGGER trg_cert_trans_immutable BEFORE UPDATE OR DELETE ON certificat_transitions
FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS trg_recus_immutable ON recus;
CREATE TRIGGER trg_recus_immutable BEFORE UPDATE OR DELETE ON recus
FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Norme publiée : seuils figés (une révision = nouvelle version, EF-36)
CREATE OR REPLACE FUNCTION norme_seuils_lock() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status::text INTO st FROM norme_referentiels WHERE id = COALESCE(NEW."referentielId", OLD."referentielId");
  IF st <> 'BROUILLON' THEN
    RAISE EXCEPTION 'Référentiel publié : créer une nouvelle version';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_seuils_lock ON norme_seuils;
CREATE TRIGGER trg_seuils_lock BEFORE INSERT OR UPDATE OR DELETE ON norme_seuils
FOR EACH ROW EXECUTE FUNCTION norme_seuils_lock();

-- ───────────── 4. Contraintes d'intégrité ─────────────
-- Un seul certificat « vivant » (EMIS/ACTIF/SUSPENDU) par ouvrage
CREATE UNIQUE INDEX IF NOT EXISTS certificats_one_live_per_ouvrage
  ON certificats ("ouvrageId") WHERE status IN ('EMIS', 'ACTIF', 'SUSPENDU');

ALTER TABLE paiements ADD CONSTRAINT paiements_amount_pos CHECK (amount > 0);
ALTER TABLE grille_tarifaire_lignes ADD CONSTRAINT grille_amount_nonneg CHECK (amount >= 0);

-- Contre-analyse : laboratoire différent du laboratoire initial (vérifié aussi en service)
CREATE OR REPLACE FUNCTION contre_analyse_labo_diff() RETURNS trigger AS $$
DECLARE init_lab uuid;
BEGIN
  SELECT "laboratoireId" INTO init_lab FROM analyse_resultats WHERE id = NEW."initialAnalyseId";
  IF NEW."laboratoireId" IS NOT NULL AND NEW."laboratoireId" = init_lab THEN
    RAISE EXCEPTION 'La contre-analyse doit être réalisée par un laboratoire différent';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_contre_labo ON contre_analyses;
CREATE TRIGGER trg_contre_labo BEFORE INSERT OR UPDATE ON contre_analyses
FOR EACH ROW EXECUTE FUNCTION contre_analyse_labo_diff();

-- ───────────── 5. Vue publique (liste fermée de champs : EF-06 / EF-24) ─────────────
-- NE JAMAIS ajouter propriétaire, téléphone ou montants. Toute évolution = revue MOA.
CREATE OR REPLACE VIEW ouvrage_public_view AS
SELECT
  o.id                AS "ouvrageId",
  o."aquasafeNumber"  AS "aquasafeNumber",
  o.name              AS name,
  o.village           AS village,
  c.name              AS "communeName",
  o.type              AS type,
  o.latitude          AS latitude,
  o.longitude         AS longitude,
  CASE
    WHEN cert.status = 'ACTIF'    AND cert."validUntil" >= now() THEN 'CERTIFIE'
    WHEN cert.status = 'ACTIF'    AND cert."validUntil" <  now() THEN 'EXPIRE'
    WHEN cert.status = 'SUSPENDU' THEN 'SUSPENDU'
    WHEN cert.status = 'EXPIRE'   THEN 'EXPIRE'
    WHEN cert.status = 'RETIRE'   THEN 'RETIRE'
    ELSE 'NON_CERTIFIE'
  END                 AS "publicStatus",
  cert.number         AS "certificatNumber",
  cert."validUntil"   AS "validUntil",
  o."lastControlAt"   AS "lastControlAt"
FROM ouvrages o
JOIN communes c ON c.id = o."communeId"
LEFT JOIN LATERAL (
  SELECT ce.* FROM certificats ce
  WHERE ce."ouvrageId" = o.id AND ce.status IN ('ACTIF', 'SUSPENDU', 'EXPIRE', 'RETIRE')
  ORDER BY ce."issuedAt" DESC LIMIT 1
) cert ON true;

-- ───────────── 6. Rôle applicatif à moindre privilège ─────────────
-- CREATE ROLE aquasafe_app LOGIN PASSWORD '...';
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO aquasafe_app;
-- REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, proces_verbaux, certificat_transitions, recus FROM aquasafe_app;
-- Seconde ligne de défense : même un bug applicatif ne peut pas réécrire l'audit.

-- ───────────── 7. Séquences de numérotation ─────────────
-- Utilisées par le service : SELECT nextval('seq_ouvrage'). Les numéros publics ne doivent révéler aucune donnée privée.
-- (Le numéro de suivi d'un signalement n'utilise PAS de séquence : il est aléatoire pour ne pas être énumérable.)
CREATE SEQUENCE IF NOT EXISTS seq_ouvrage;
CREATE SEQUENCE IF NOT EXISTS seq_demande;
CREATE SEQUENCE IF NOT EXISTS seq_certificat;
CREATE SEQUENCE IF NOT EXISTS seq_recu;
