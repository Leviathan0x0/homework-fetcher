#!/usr/bin/env bash
#
# SQLite-consistent backups for the MMSS64 VPS.
#
# - Uses sqlite3's .backup (the SQLite backup API), which is safe against a
#   live WAL database. Never `cp` the primary file while the app is running.
# - Archives the attachments directory alongside each database snapshot.
# - Keeps the newest BACKUP_KEEP generations of each, prunes the rest.
# - Optionally uploads each new backup to Azure Blob Storage when
#   BACKUP_AZURE_URL is set (a container URL with SAS query string). The app
#   itself has no Azure dependency; unset the variable to move elsewhere.
#
# Run as the app user from the systemd timer (infra/systemd/mmss64-backup.*),
# or by hand:  ./scripts/backup-sqlite.sh
#
# Environment (normally from /etc/mmss64/mmss.env + /etc/mmss64/backup.env):
#   SQLITE_DB_PATH     primary database        (default /var/lib/mmss64/mmss.db)
#   UPLOADS_DIR        attachments directory   (default /var/lib/mmss64/attachments)
#   BACKUP_ROOT        where snapshots go      (default /var/backups/mmss64)
#   BACKUP_KEEP        generations to keep     (default 14)
#   BACKUP_AZURE_URL   optional blob container URL + SAS for off-VM upload

set -euo pipefail

DB="${SQLITE_DB_PATH:-/var/lib/mmss64/mmss.db}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/mmss64/attachments}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/mmss64}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_ROOT"

if [ ! -f "$DB" ]; then
  echo "Database $DB does not exist; nothing to back up." >&2
  exit 1
fi

DB_SNAP="$BACKUP_ROOT/mmss-$STAMP.db"

# SQLite backup API: consistent even while the app is writing (WAL included).
sqlite3 "$DB" ".backup '$DB_SNAP'"

# A backup we cannot read is not a backup.
INTEGRITY="$(sqlite3 "$DB_SNAP" 'PRAGMA integrity_check;')"
if [ "$INTEGRITY" != "ok" ]; then
  echo "Backup failed integrity check: $INTEGRITY" >&2
  rm -f "$DB_SNAP"
  exit 1
fi

# Attachments snapshot (files on disk, not in SQLite).
UPLOAD_SNAP=""
if [ -d "$UPLOADS_DIR" ]; then
  UPLOAD_SNAP="$BACKUP_ROOT/uploads-$STAMP.tar.gz"
  tar -czf "$UPLOAD_SNAP" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
fi

# Retention: keep the newest KEEP generations of each artefact.
ls -1t "$BACKUP_ROOT"/mmss-*.db 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
done
ls -1t "$BACKUP_ROOT"/uploads-*.tar.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
done

# Optional off-VM upload. Failure warns but does not fail the local backup.
if [ -n "${BACKUP_AZURE_URL:-}" ]; then
  for artifact in "$DB_SNAP" ${UPLOAD_SNAP:+"$UPLOAD_SNAP"}; do
    name="$(basename "$artifact")"
    if curl -sfS -X PUT \
      --data-binary "@$artifact" \
      -H "x-ms-blob-type: BlockBlob" \
      -H "x-ms-version: 2021-12-02" \
      "${BACKUP_AZURE_URL%/}/$name" >/dev/null; then
      echo "Uploaded $name to Azure Blob Storage"
    else
      echo "WARNING: failed to upload $name to Azure Blob Storage" >&2
    fi
  done
fi

echo "Backup OK: $DB_SNAP${UPLOAD_SNAP:+ and $UPLOAD_SNAP}"
