#!/bin/bash
# P1.2 HOUSE BATTERY — the gate that freezes the new card core.
# AnytimeRook (charter clock) vs COSMO (gen21 x gen15-belief x t0 K24,
# production), duplicate decks, family format, fresh seeds, per-hand
# currency. 1,000+ pairs total: 200 pairs/box x 5 boxes; resume-safe
# relaunches (pgrep guard) — run again after reboots.
#
# LAUNCH ONLY AFTER the P1.1 smoke gate passes (R2+).
#   scp to each box, then: BOX=N bash p12_battery.sh
B=${BOX:?set BOX=1..5}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/p12

pgrep -f "p12battery_box${B}" > /dev/null && { echo "already running"; exit 1; }

ROOK_THINK_LOG=runs/p12/think_box${B}.jsonl \
nohup nice -n 5 $PY -m alpharook.duel \
  --a models/gen21-cand1.pt --b models/gen21-cand1.pt \
  --anytime-a 1.0 --belief-a models/gen15.pt --belief-temp-a 0.5 \
  --worlds-b 24 --search-b play --prior-b 2.0 --min-trick-b 0 \
  --belief-b models/gen15.pt --belief-temp-b 0.5 \
  --pairs 200 --workers 14 \
  --seed $(( B * 104729000 + 77003 )) \
  --dump runs/p12/p12battery_box${B}.jsonl \
  >> runs/p12/p12battery_box${B}.log 2>&1 &
echo "box $B P1.2 battery launched (pid $!)"
