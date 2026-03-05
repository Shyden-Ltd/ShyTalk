#!/bin/bash
# Backup R2 bucket to local folder
# Run manually or via Task Scheduler: bash scripts/backup-r2.sh
#
# Syncs all files from the shytalk-media R2 bucket to backups/r2/
# Only downloads new or changed files (incremental).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups/r2"
RCLONE="${RCLONE:-rclone}"

mkdir -p "$BACKUP_DIR"

echo "$(date): Starting R2 backup to $BACKUP_DIR"
"$RCLONE" sync shytalk-r2:shytalk-media "$BACKUP_DIR" \
  --progress \
  --log-level INFO \
  --transfers 4
STATUS=$?

if [ $STATUS -eq 0 ]; then
  echo "$(date): Backup complete — $(find "$BACKUP_DIR" -type f | wc -l) files"
else
  echo "$(date): Backup FAILED with exit code $STATUS"
fi
