#!/bin/bash
# Search-only load test (audit lot 7): indexes the 50 000 documents of the data set
# (scripts/seed-loadtest.ts --index-only), no Firestore write. Remove them the same day
# (load/seed-index-remove.sh): the 04:20 UTC search reconciliation would read them as gaps.
# Run as root on aalan-vm: node scripts/oracle-vm.ts run load/seed-index.sh [--apply]
set -euo pipefail
id="$(docker ps -q --filter label=com.docker.compose.project=joutiya-staging --filter label=com.docker.compose.service=worker)"
[[ -n "$id" ]] || { echo "staging worker: not running"; exit 1; }
docker exec "$id" node dist/worker/seed-loadtest.mjs --index-only --apply
