#!/bin/bash
# P1.1 SMOKE DUEL — AnytimeRook (charter clock, budget_scale 1.0) vs
# flat-K48 MortalRook (the confirmed +1.68 config), duplicate decks,
# family format. ~100 pairs total across the 5-box fleet = 20 pairs/box,
# distinct seed streams. Gate: anytime at least matches flat-K48.
#
#   scp this to each box, then:  BOX=N bash p11_smoke.sh
#
# Ops scars honored: setsid + </dev/null for remote nohup; workers
# rebuild Sides from ctor args; ROOK_THINK_LOG shards by pid.
# R2 (2026-08-06): round 1 FAILED at -5.6 pts/hand — the prior-blend
# discipline under-overrode 2.4x (0.62/hand vs MortalRook's 1.5). R2
# runs the fixed two-phase agent (anytime select + split-sample confirm,
# the MortalRook law restored). FRESH seed stream — replication law.
R=${ROUND:-2}
B=${BOX:?set BOX=1..5}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/p11

pgrep -f "p11smoke_r${R}_box${B}" > /dev/null && { echo "already running"; exit 1; }

ROOK_THINK_LOG=runs/p11/think_r${R}_box${B}.jsonl \
nohup nice -n 5 $PY -m alpharook.duel \
  --a models/gen21-cand1.pt --b models/gen21-cand1.pt \
  --anytime-a 1.0 --belief-a models/gen15.pt --belief-temp-a 0.5 \
  --mrook-b 48 --belief-b models/gen15.pt --belief-temp-b 0.5 \
  --pairs 20 --workers 14 \
  --seed $(( (R * 31 + B) * 7919000 + 500011 )) \
  --dump runs/p11/p11smoke_r${R}_box${B}.jsonl \
  >> runs/p11/p11smoke_r${R}_box${B}.log 2>&1 &
echo "box $B round $R launched (pid $!)"
