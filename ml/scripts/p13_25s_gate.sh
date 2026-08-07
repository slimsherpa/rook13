#!/bin/bash
# THE 10-SECOND WIDOWMAKER GATE (pre-registered 2026-08-06, before any
# result): MortalWidow with WidowProp-v0 shortlist (top-4 + incumbent)
# at a 10s selection budget, twin-gated vs production burial, fresh
# seeds, anytime core.
#   PASS    = per-contract gain CI-clear of zero
#   STRETCH = retains >= +0.6 of the 60s config's +0.91/contract
#   BOX=N bash p13_10s_gate.sh
B=${BOX:?set BOX=1..5}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/p13/gate25
pgrep -f "alpharook.widowtwin" > /dev/null && { echo "already running"; exit 1; }
nohup nice -n 5 $PY -m alpharook.widowtwin \
  --minutes 600 --workers 14 --core anytime \
  --belief models/gen15.pt --widow-budget 25 --k-min 16 \
  --proposer models/widowprop-v0.pt --label-rows \
  --seed-base $(( 17000000000 + B * 100000000 )) \
  --out runs/p13/gate25 --run-tag box${B} \
  >> runs/p13/gate25_box${B}.log 2>&1 &
echo "box $B 10s gate launched (pid $!)"
