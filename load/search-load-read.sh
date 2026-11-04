#!/bin/bash
# Search-only load test (audit lot 7): the JSON summary of load/search-load-start.sh (empty while it runs).
# Run as root on aalan-vm: node scripts/oracle-vm.ts run load/search-load-read.sh [--apply]
set -euo pipefail
id="$(docker ps -q --filter label=com.docker.compose.project=joutiya-staging --filter label=com.docker.compose.service=worker)"
[[ -n "$id" ]] || { echo "staging worker: not running"; exit 1; }
docker exec "$id" sh -c 'cat /tmp/load-search.json 2>/dev/null || echo "no result yet"'
