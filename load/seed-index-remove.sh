#!/bin/bash
# After the search-only load test (audit lot 7): removes the 50 000 index documents of the data set.
# Run as root on aalan-vm: node scripts/oracle-vm.ts run load/seed-index-remove.sh [--apply]
set -euo pipefail
id="$(docker ps -q --filter label=com.docker.compose.project=joutiya-staging --filter label=com.docker.compose.service=worker)"
[[ -n "$id" ]] || { echo "staging worker: not running"; exit 1; }
docker exec "$id" node dist/worker/seed-loadtest.mjs --index-only --remove --apply
