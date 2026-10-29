#!/bin/sh
# Weekly consistent SQLite snapshot of the environment DB, pushed to the Synology NAS.
# Only the latest verified snapshot is kept, both on the NAS and locally.
# cron: 15 3 * * SUN /home/pihead/enviro-lite/backup_to_nas.sh >> /home/pihead/db-backups/backup.log 2>&1
set -eu

DB=/home/pihead/enviro-lite/environment
LOCAL_DIR=/home/pihead/db-backups
NAS=jmayeur@192.168.119.136
NAS_DIR=/volume1/misc/aqi-backups/${BACKUP_NAME:-outdoor}
KEY=/home/pihead/.ssh/id_ed25519_nas

mkdir -p "$LOCAL_DIR"
snap="$LOCAL_DIR/environment-$(date +%Y%m%d-%H%M%S).db"

# .backup gives a consistent copy even while the collector is writing
sqlite3 "$DB" ".backup '$snap'"
check=$(sqlite3 -noheader -list "$snap" "PRAGMA integrity_check;")
if [ "$check" != "ok" ]; then
    echo "$(date -Is) integrity check failed: $check" >&2
    exit 1
fi
gzip -f "$snap"

name=$(basename "$snap").gz
# Stream over plain ssh (DSM's rsync service is off); write to .part, verify, then rename
ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$NAS" \
    "mkdir -p '$NAS_DIR' && cat > '$NAS_DIR/$name.part'" < "$snap.gz"
local_sum=$(sha256sum "$snap.gz" | cut -d' ' -f1)
remote_sum=$(ssh -i "$KEY" -o BatchMode=yes "$NAS" "sha256sum '$NAS_DIR/$name.part'" | cut -d' ' -f1)
if [ "$local_sum" != "$remote_sum" ]; then
    echo "$(date -Is) checksum mismatch on NAS for $name" >&2
    exit 1
fi
ssh -i "$KEY" -o BatchMode=yes "$NAS" "mv '$NAS_DIR/$name.part' '$NAS_DIR/$name'"

# The new snapshot is verified on the NAS, so drop every older one
find "$LOCAL_DIR" -name 'environment-*.db*' ! -name "$name" -delete
ssh -i "$KEY" -o BatchMode=yes "$NAS" \
    "find '$NAS_DIR' -name 'environment-*.db.gz*' ! -name '$name' -delete"

echo "$(date -Is) backed up $name ($local_sum)"
