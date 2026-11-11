#!/bin/bash
# Copy of Aalan's production data outside Cloudflare, run every night by cron (install.sh), after
# the 03:30 UTC backup: the age-encrypted Firestore/Auth backups (prefix backups/ of the private
# bucket; never decrypted here, the key stays offline with the owner) and the public media bucket.
# Read only on R2 (token "Object Read" on the two prod buckets, secrets/r2.env). Backups: copy, never
# deleted by the source, pruned here after 98 days like R2's lifecycle rule (docs/backups.md). Media:
# sync; a file deleted on R2 is kept 30 days in media-deleted/<day>, then erased (deletions reach
# the copy). Never more than MAX_GB on this disk.
set -uo pipefail
umask 077
readonly ROOT=/var/lib/ocarun/aalan
readonly MAX_GB=30
exec 9> "$ROOT/state/mirror.lock"
flock -n 9 || exit 0
log="$ROOT/state/mirror.log"
status() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" > "$ROOT/state/mirror.status"; echo "$(date -u +%FT%TZ) $*" >> "$log"; }
if [[ ! -s "$ROOT/secrets/r2.env" ]]; then status "skipped: no R2 key"; exit 0; fi
# shellcheck disable=SC1091
. "$ROOT/secrets/r2.env"
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_ENV_AUTH=false
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT" RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
unset R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
rclone=("$ROOT/opt/rclone" --config /dev/null --transfers 2 --checkers 4 --buffer-size 8M --use-mmap --low-level-retries 5 --stats 0 --log-level ERROR --log-file "$log")
used_gb="$(du -s --block-size=1G "$ROOT/mirror" | cut -f1)"
if ((used_gb >= MAX_GB)); then status "FAIL: mirror holds ${used_gb} GB (cap ${MAX_GB} GB)"; exit 1; fi
failed=""
"${rclone[@]}" copy "r2:$R2_BUCKET_PRIVATE/backups" "$ROOT/mirror/backups" --max-age 97d || failed+=" backups"
today="$(date -u +%F)"
"${rclone[@]}" sync "r2:$R2_BUCKET_MEDIA" "$ROOT/mirror/media" --backup-dir "$ROOT/mirror/media-deleted/$today" || failed+=" media"
# Retention: backup days older than 98 days, media deletions older than 30 days.
cutoff="$(date -u -d '98 days ago' +%F)"
for dir in "$ROOT"/mirror/backups/*/; do
  day="$(basename "$dir")"
  [[ "$day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ && "$day" < "$cutoff" ]] && rm -rf -- "$dir"
done
find "$ROOT/mirror/media-deleted" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf -- {} +
latest="$(find "$ROOT/mirror/backups" -mindepth 2 -maxdepth 2 -name manifest.json.age -printf '%h\n' 2> /dev/null | xargs -r -n1 basename | sort | tail -1)"
if [[ -n "$failed" ]]; then status "FAIL:$failed (latest backup ${latest:-none})"; exit 1; fi
status "ok latest-backup ${latest:-none}"
tail -n 200 "$log" > "$log.tmp" && mv "$log.tmp" "$log"
