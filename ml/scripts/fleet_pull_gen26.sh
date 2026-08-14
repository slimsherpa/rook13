#!/bin/bash
# Pull all v2.1 corpus shards from the fleet to runs/gen26/.
set -u
cd "$(dirname "$0")/.." || exit 1
for e in "1:62.238.2.180" "2:62.238.0.121" "3:62.238.7.174" "4:167.233.247.232" "5:178.105.226.61"; do
  BOX="${e%%:*}"; IP="${e##*:}"
  rsync -az --timeout=120 root@$IP:/root/rook13/ml/runs/gen26/mine_box${BOX}_v21.jsonl runs/gen26/ &
done
wait
wc -l runs/gen26/mine_box*_v21.jsonl
