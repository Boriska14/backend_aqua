#!/usr/bin/env bash
set -euo pipefail

# AquaSafe — PostgreSQL restore + SHA-256 audit chain verification script (EN-06)
# Usage:
#   DATABASE_URL="postgresql://..." ./scripts/restore.sh /path/to/aquasafe_YYYYMMDD.dump[.gpg]

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <dump_or_gpg_file>" >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required" >&2
  exit 1
fi

INPUT_FILE="$1"
WORK_DUMP="${INPUT_FILE}"
TMP_DUMP=""

if [ -f "${INPUT_FILE}.sha256" ]; then
  echo "[1/4] Verifying SHA-256 checksum..."
  sha256sum -c "${INPUT_FILE}.sha256"
fi

if [[ "${INPUT_FILE}" == *.gpg ]]; then
  echo "[2/4] Decrypting GPG backup..."
  TMP_DUMP="$(mktemp /tmp/aquasafe_restore_XXXXXX.dump)"
  if [ -n "${GPG_PASSPHRASE:-}" ]; then
    gpg --batch --yes --passphrase "${GPG_PASSPHRASE}" --decrypt --output "${TMP_DUMP}" "${INPUT_FILE}"
  else
    gpg --batch --yes --decrypt --output "${TMP_DUMP}" "${INPUT_FILE}"
  fi
  WORK_DUMP="${TMP_DUMP}"
else
  echo "[2/4] Dump is not GPG-encrypted, proceeding directly..."
fi

echo "[3/4] Restoring database with pg_restore..."
pg_restore --clean --if-exists --no-owner --no-acl --dbname="${DATABASE_URL}" "${WORK_DUMP}"

if [ -n "${TMP_DUMP}" ] && [ -f "${TMP_DUMP}" ]; then
  rm -f "${TMP_DUMP}"
fi

echo "[4/4] Verifying audit_log SHA-256 chain integrity..."
BROKEN_COUNT="$(psql "${DATABASE_URL}" -tAc "SELECT COUNT(*) FROM audit_verify_chain();")"
if [ "${BROKEN_COUNT}" != "0" ]; then
  echo "ERROR: audit_verify_chain() detected ${BROKEN_COUNT} broken rows!" >&2
  exit 2
fi

echo "Restore and integrity check succeeded."
