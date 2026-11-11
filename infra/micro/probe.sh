#!/bin/bash
# Uptime probe of aalan.ma from spare-micro-1, run every minute by cron (install.sh). One line per
# target in data/probe/<UTC day>.tsv: epoch, name, HTTP code, seconds, ok|fail. No secret, read only.
set -uo pipefail
umask 077
readonly ROOT=/var/lib/ocarun/aalan
exec 9> "$ROOT/state/probe.lock"
flock -n 9 || exit 0
day="$(date -u +%F)"
out="$ROOT/data/probe/$day.tsv"
while IFS=$'\t' read -r name url code needle; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  body="$(mktemp)"
  result="$(curl -sS -o "$body" -m 15 --max-filesize 65536 -A aalan-micro-probe -w '%{http_code} %{time_total}' "$url" 2> /dev/null)" || true
  read -r got seconds <<< "${result:-000 0}"
  status=ok
  [[ "$got" == "$code" ]] || status=fail
  if [[ "$status" == ok && "$needle" != "-" ]] && ! grep -qF -- "$needle" "$body"; then status=fail; fi
  rm -f "$body"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%s)" "$name" "${got:-000}" "${seconds:-0}" "$status" >> "$out"
done < "$ROOT/etc/targets.tsv"
# 35 days of history.
find "$ROOT/data/probe" -name '*.tsv' -mtime +35 -delete
