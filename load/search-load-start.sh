#!/bin/bash
# Search-only load test (audit lot 7): starts scripts/load-search.ts detached in the staging worker
# container, 50 searches a second for 3 minutes against web:3000 (Run Command loses the output of a
# command of several minutes). Read the result with load/search-load-read.sh after 4 minutes.
# Run as root on aalan-vm: node scripts/oracle-vm.ts run load/search-load-start.sh [--apply]
set -euo pipefail
id="$(docker ps -q --filter label=com.docker.compose.project=joutiya-staging --filter label=com.docker.compose.service=worker)"
[[ -n "$id" ]] || { echo "staging worker: not running"; exit 1; }
docker exec "$id" rm -f /tmp/load-search.json
docker exec -d "$id" sh -c 'node dist/worker/load-search.mjs --rate=50 --seconds=180 > /tmp/load-search.json 2>&1'
echo "started at $(date -u +%H:%M:%SZ)"
