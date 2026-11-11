#!/bin/bash
# Summary of spare-micro-1 for the agents (`node scripts/micro-vm.ts report`), under Run Command's
# 1 KB of output. Last line: "verdict ok" or "verdict ALERT <reasons>". Read only, prints no secret.
set -uo pipefail
readonly ROOT=/var/lib/ocarun/aalan
alerts=()
now="$(date -u +%s)"
since="$((now - 86400))"
# Probe: last 24 h per target; an alert at 2 failures or more in the last 15 min.
rows="$(cat "$ROOT"/data/probe/*.tsv 2> /dev/null | awk -F'\t' -v since="$since" -v recent="$((now - 900))" '
  $1 > seen { seen = $1 }
  $1 >= since { n[$2]++; if ($5 == "ok") ok[$2]++; else { last[$2] = $1; if ($1 >= recent) bad[$2]++ } }
  END { for (t in n) print t, ok[t] + 0, n[t], last[t] + 0, bad[t] + 0; print "-", seen + 0 }')"
last=0
while read -r target ok total failed_at recent; do
  if [[ "$target" == - ]]; then last="$ok"; continue; fi
  line="probe $target $ok/$total ok"
  ((failed_at > 0)) && line+=" last-fail $(date -u -d "@$failed_at" +%FT%RZ)"
  ((recent >= 2)) && { line+=" RECENT-FAIL"; alerts+=("site-failing:$target"); }
  echo "$line"
done <<< "$rows"
((now - last > 300)) && alerts+=("probe-stopped")
# Mirror.
mirror="$(cat "$ROOT/state/mirror.status" 2> /dev/null || echo "never run")"
echo "mirror $mirror"
case "$mirror" in
  *"no R2 key"*) ;;
  *FAIL*) alerts+=("mirror-failed") ;;
esac
latest="$(echo "$mirror" | sed -n 's/.*latest-backup \([0-9-]*\).*/\1/p')"
if [[ -n "$latest" ]] && (( (now - $(date -u -d "$latest" +%s)) > 2 * 86400 )); then alerts+=("backup-older-than-2d"); fi
echo "mirror-size $(du -sh "$ROOT/mirror/backups" 2> /dev/null | cut -f1) backups, $(du -sh "$ROOT/mirror/media" 2> /dev/null | cut -f1) media, $(find "$ROOT/mirror/backups" -mindepth 1 -maxdepth 1 -type d 2> /dev/null | wc -l) days"
# Edge certificate of aalan.ma (TLS_HOST= skips it, for the unit test).
tls_host="${TLS_HOST-aalan.ma}"
end=""
[[ -n "$tls_host" ]] && end="$(echo | timeout 10 openssl s_client -servername "$tls_host" -connect "$tls_host:443" 2> /dev/null | openssl x509 -noout -enddate 2> /dev/null | cut -d= -f2)"
if [[ -n "$end" ]]; then
  days="$(( ($(date -u -d "$end" +%s) - now) / 86400 ))"
  echo "tls $tls_host ${days} days left"
  ((days < 14)) && alerts+=("tls-expires-${days}d")
fi
# Host.
disk="$(df --output=pcent / | tail -1 | tr -dc 0-9)"
echo "host disk ${disk}% mem-avail $(awk '/MemAvailable/ { print int($2 / 1024) }' /proc/meminfo) MB up $(uptime -p | sed 's/^up //') updates $(apt list --upgradable 2> /dev/null | grep -c upgradable) reboot-required $([[ -e /var/run/reboot-required ]] && echo yes || echo no)"
((disk >= 85)) && alerts+=("disk-${disk}%")
crontab -l 2> /dev/null | grep -q aalan/bin/probe.sh || alerts+=("cron-missing")
if ((${#alerts[@]} == 0)); then echo "verdict ok"; else echo "verdict ALERT ${alerts[*]}"; fi
