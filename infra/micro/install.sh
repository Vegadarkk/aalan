#!/bin/bash
# Installs this folder on spare-micro-1 for the ocarun user (OCI Run Command's account, the only
# way in: no SSH key, no ingress rule, no sudo). Called by `node scripts/micro-vm.ts sync` with the
# extracted folder as $1. Idempotent. rclone is a pinned upstream release checked by SHA-256.
set -euo pipefail
umask 077
readonly SRC="$1"
readonly ROOT=/var/lib/ocarun/aalan
readonly RCLONE_VERSION=v1.75.2
readonly RCLONE_SHA256=349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702
[[ "$(id -un)" == ocarun ]] || { echo "run as ocarun"; exit 1; }
install -d -m 0700 "$ROOT" "$ROOT"/{bin,etc,opt,secrets,state,data,data/probe,mirror,mirror/backups,mirror/media,mirror/media-deleted}
for file in probe.sh mirror.sh report.sh; do install -m 0700 "$SRC/$file" "$ROOT/bin/$file"; done
install -m 0600 "$SRC/targets.tsv" "$ROOT/etc/targets.tsv"
if [[ "$("$ROOT/opt/rclone" version 2> /dev/null | head -1)" != "rclone $RCLONE_VERSION" ]]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  zip="rclone-$RCLONE_VERSION-linux-amd64.zip"
  curl -fsSL --retry 3 -o "$work/$zip" "https://downloads.rclone.org/$RCLONE_VERSION/$zip"
  echo "$RCLONE_SHA256  $work/$zip" | sha256sum -c --quiet
  python3 -I -c 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); open(sys.argv[2], "wb").write(z.read(sys.argv[3]))' "$work/$zip" "$work/rclone" "rclone-$RCLONE_VERSION-linux-amd64/rclone"
  install -m 0700 "$work/rclone" "$ROOT/opt/rclone"
fi
# The whole crontab of ocarun is ours: probe every minute, mirror at 05:15 UTC.
crontab - << CRON
SHELL=/bin/bash
PATH=/usr/bin:/bin
* * * * * $ROOT/bin/probe.sh
15 5 * * * $ROOT/bin/mirror.sh
CRON
echo "installed: $("$ROOT/opt/rclone" version | head -1), cron $(crontab -l | grep -c aalan/bin) jobs, r2 key $([[ -s "$ROOT/secrets/r2.env" ]] && echo present || echo absent)"
