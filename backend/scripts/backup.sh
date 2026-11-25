#!/usr/bin/env bash
set -euo pipefail

# AquaSafe — Daily encrypted PostgreSQL backup script (EN-06)
# Usage:
#   DATABASE_URL="postgresql://..." GPG_RECIPIENT="ops@aquasafe.cm" BACKUP_DIR="/var/backups/aquasafe" ./scripts/backup.sh

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required" >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RAW_DUMP="${BACKUP_DIR}/aquasafe_${TIMESTAMP}.dump"
OUT_FILE="${RAW_DUMP}"

mkdir -p "${BACKUP_DIR}"

echo "[1/3] Running pg_dump..."
pg_dump --format=custom --no-owner --no-acl --file="${RAW_DUMP}" "${DATABASE_URL}"

if [ -n "${GPG_RECIPIENT:-}" ]; then
  echo "[2/3] Encrypting dump with GPG for ${GPG_RECIPIENT}..."
  gpg --batch --yes --trust-model always --encrypt --recipient "${GPG_RECIPIENT}" --output "${RAW_DUMP}.gpg" "${RAW_DUMP}"
  rm -f "${RAW_DUMP}"
  OUT_FILE="${RAW_DUMP}.gpg"
elif [ -n "${GPG_PASSPHRASE:-}" ]; then
  echo "[2/3] Encrypting dump with symmetric GPG..."
  gpg --batch --yes --passphrase "${GPG_PASSPHRASE}" --symmetric --cipher-algo AES256 --output "${RAW_DUMP}.gpg" "${RAW_DUMP}"
  rm -f "${RAW_DUMP}"
  OUT_FILE="${RAW_DUMP}.gpg"
else
  echo "[2/3] WARNING: No GPG_RECIPIENT or GPG_PASSPHRASE set; storing unencrypted dump."
fi

sha256sum "${OUT_FILE}" > "${OUT_FILE}.sha256"

if [ -n "${OFFSITE_S3_BUCKET:-}" ]; then
  echo "[3/3] Copying encrypted backup offsite to ${OFFSITE_S3_BUCKET}..."
  aws s3 cp "${OUT_FILE}" "${OFFSITE_S3_BUCKET}/$(basename "${OUT_FILE}")"
  aws s3 cp "${OUT_FILE}.sha256" "${OFFSITE_S3_BUCKET}/$(basename "${OUT_FILE}").sha256"
else
  echo "[3/3] OFFSITE_S3_BUCKET not set; skipping remote upload."
fi

echo "Backup completed: ${OUT_FILE}"
