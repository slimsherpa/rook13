#!/bin/bash
# P2 twin-game corpus soak under the frozen core, winprob25 labels.
#   BOX=N bash p2_twins.sh
B=${BOX:?set BOX=1..5}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/p2/twins
pgrep -f "alpharook.bidtwins" > /dev/null && { echo "already running"; exit 1; }
nohup nice -n 5 $PY -m alpharook.bidtwins \
  --minutes 720 --workers 14 --core anytime \
  --belief models/gen15.pt --winprob models/winprob25.json \
  --twin-p 0.25 --seed-base $(( 21000000000 + B * 100000000 )) \
  --out runs/p2/twins --run-tag box${B} \
  >> runs/p2/twins_box${B}.log 2>&1 &
echo "box $B bid twins launched (pid $!)"
