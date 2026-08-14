#!/bin/bash
# GEN26 BATTERY FLEET FAN-OUT (2026-08-13, battery §2-§3): while the
# laptop runs the ship-arm organ gate, the five boxes run the rest —
# every arm QCAL-calibrated (prior_scale 48, the pooled fleet fit).
#
#   box1  tier ladder rung 1: bare Gen26  vs  Gen26+anytime@0.10
#   box2  tier ladder rung 2: bare Gen26  vs  Gen26+anytime@0.25
#   box3  tier ladder rung 3: bare Gen26  vs  Gen26+anytime@0.80 (~10s cap)
#   box4  organ gate, plain arm: gen21+anytime  vs  Gen26+anytime (isolate)
#   box5  organ gate, ship arm replica (fresh seed block, doubles laptop n)
#
#   bash scripts/fleet_gen26_battery.sh          # launch all 5
#   bash scripts/fleet_gen26_battery.sh pull     # collect dumps + logs
#
# Ladder read: rung deltas price what each thinking budget buys in
# pts/hand; ladder games also bank think-time telemetry for the "how slow
# is thinking mode really" p50/p95 (dump jsonl).
set -u
cd "$(dirname "$0")/.." || exit 1
PS26=48
G26=runs/gen26v0b/best.pt
G21=models/gen21-cand1.pt
BEL="--belief-temp-a 0.5 --belief-temp-b 0.5"
BOXES=("1:62.238.2.180" "2:62.238.0.121" "3:62.238.7.174"
       "4:167.233.247.232" "5:178.105.226.61")

if [ "${1:-}" = "pull" ]; then
  for e in "${BOXES[@]}"; do
    BOX="${e%%:*}"; IP="${e##*:}"
    rsync -az --timeout=120 \
      "root@$IP:/root/rook13/ml/runs/gen26/battery_*" runs/gen26/ &
  done
  wait
  ls -la runs/gen26/battery_*
  exit 0
fi

for e in "${BOXES[@]}"; do
  BOX="${e%%:*}"; IP="${e##*:}"
  case $BOX in
    1) ARGS="--a $G26 --b $G26 --anytime-b 0.10 --prior-scale-b $PS26 \
        --belief-b models/gen15.pt"; TAG=ladder010 ;;
    2) ARGS="--a $G26 --b $G26 --anytime-b 0.25 --prior-scale-b $PS26 \
        --belief-b models/gen15.pt"; TAG=ladder025 ;;
    3) ARGS="--a $G26 --b $G26 --anytime-b 0.80 --prior-scale-b $PS26 \
        --belief-b models/gen15.pt"; TAG=ladder080 ;;
    4) ARGS="--a $G21 --anytime-a 0.25 --belief-a models/gen15.pt \
        --b $G26 --anytime-b 0.25 --prior-scale-b $PS26 \
        --belief-b models/gen15.pt"; TAG=organ_plain ;;
    5) ARGS="--a $G21 --anytime-a 0.25 --gardner-a -4.0 \
        --belief-a models/gen15.pt \
        --b $G26 --anytime-b 0.25 --prior-scale-b $PS26 \
        --belief-b models/gen15.pt"; TAG=organ_ship2 ;;
  esac
  SEED=$((4100000000 + BOX * 100000000))
  (
    ssh -o BatchMode=yes -o ConnectTimeout=10 root@$IP \
      "cd /root/rook13/ml && mkdir -p runs/gen26 && \
       nohup /root/torch-env/bin/python -m alpharook.duel \
         $ARGS --script-a none --script-b none $BEL \
         --pairs ${PAIRS:-300} --workers 14 --seed $SEED \
         --dump runs/gen26/battery_${TAG}.jsonl \
         > runs/gen26/battery_${TAG}.log 2>&1 & \
       sleep 3; pgrep -cf alpharook.duel" \
      && echo "[$IP box$BOX] LAUNCHED $TAG (seed $SEED)"
  ) &
done
wait
echo "battery fleet launched — pull with: bash scripts/fleet_gen26_battery.sh pull"
