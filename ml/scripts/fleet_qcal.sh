#!/bin/bash
# QCAL FLEET FAN-OUT (2026-08-13): run the Q-calibration instrument on
# all five Hetzner boxes, each replaying ITS OWN gen26 mining shard
# (already on disk there from the corpus run). Laptop keeps its run too;
# shards are disjoint games so every row pools.
#
#   bash scripts/fleet_qcal.sh            # launch on all 5
#   bash scripts/fleet_qcal.sh pull       # collect rows -> runs/qcal/
#
# After pull, the combined report:
#   ~/torch-env/bin/python -m alpharook.qcal --report-only \
#       --out runs/qcal/qcal.jsonl        # globs qcal_*.jsonl siblings
set -u
cd "$(dirname "$0")/.." || exit 1
BOXES=("1:62.238.2.180" "2:62.238.0.121" "3:62.238.7.174"
       "4:167.233.247.232" "5:178.105.226.61")

if [ "${1:-}" = "pull" ]; then
  for e in "${BOXES[@]}"; do
    BOX="${e%%:*}"; IP="${e##*:}"
    rsync -az --timeout=120 \
      "root@$IP:/root/rook13/ml/runs/qcal/qcal_box${BOX}_w*.jsonl" \
      runs/qcal/ &
  done
  wait
  wc -l runs/qcal/qcal_box*_w*.jsonl | tail -1
  exit 0
fi

for e in "${BOXES[@]}"; do
  BOX="${e%%:*}"; IP="${e##*:}"
  SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 root@$IP"
  (
    echo "[$IP box$BOX] sync code + gen26 checkpoint..."
    rsync -az --timeout=60 --exclude '__pycache__' --exclude '_csolver.so' \
      alpharook "root@$IP:/root/rook13/ml/" || exit 1
    $SSH 'mkdir -p /root/rook13/ml/runs/gen26v0b /root/rook13/ml/runs/qcal'
    rsync -az --timeout=120 runs/gen26v0b/best.pt \
      "root@$IP:/root/rook13/ml/runs/gen26v0b/" || exit 1
    BUSY=$($SSH 'pgrep -cf "alpharook\." 2>/dev/null || true')
    echo "[$IP box$BOX] alpharook procs already running: ${BUSY:-0}"
    $SSH "cd /root/rook13/ml && \
      nohup /root/torch-env/bin/python -m alpharook.qcal \
        --corpus runs/gen26/mine_box${BOX}_v21.jsonl \
        --net-b runs/gen26v0b/best.pt \
        --games 8 --workers 14 --k 48 --max-trick 4 --sample-p 0.4 \
        --out runs/qcal/qcal_box${BOX}.jsonl \
        > runs/qcal/qcal_box${BOX}.log 2>&1 & \
      sleep 3; pgrep -cf alpharook.qcal"
    echo "[$IP box$BOX] LAUNCHED"
  ) &
done
wait
echo "fleet qcal launched — pull with: bash scripts/fleet_qcal.sh pull"
