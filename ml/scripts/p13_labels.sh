#!/bin/bash
# WidowProposer label generation — the AlphaZero loop's teacher stream.
# MortalWidow at the GATED 60s config, --label-rows on: every contract
# ships the full-view encoder state + the valued burial menu.
#   BOX=N bash p13_labels.sh
B=${BOX:?set BOX=1..5}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/p13/labeled
pgrep -f "alpharook.widowtwin" > /dev/null && { echo "already running"; exit 1; }
nohup nice -n 5 $PY -m alpharook.widowtwin \
  --minutes 720 --workers 14 --core anytime \
  --belief models/gen15.pt --widow-budget 60 --label-rows \
  --seed-base $(( 15000000000 + B * 100000000 )) \
  --out runs/p13/labeled --run-tag box${B} \
  >> runs/p13/labeled_box${B}.log 2>&1 &
echo "box $B label stream launched (pid $!)"
