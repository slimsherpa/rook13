#!/bin/bash
# P2 twin-game corpus soak under the frozen core, winprob25 labels.
#   BOX=N ROUND=4 bash p2_twins.sh
# Seed bases by round: r1=21e9, r2=22e9, r3=23e9, r4=24e9... +B*1e8 per box —
# every (round, box) block disjoint, so shards never replay a deal.
# MINUTES default 660 (11h): the final-week fleet law — every run
# self-terminates under 12h, no keepers.
B=${BOX:?set BOX=1..5}
R=${ROUND:?set ROUND=4..}
MINUTES=${MINUTES:-660}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/p2/twins
pgrep -f "alpharook.bidtwins" > /dev/null && { echo "already running"; exit 1; }
nohup nice -n 5 $PY -m alpharook.bidtwins \
  --minutes $MINUTES --workers 14 --core anytime \
  --belief models/gen15.pt --winprob models/winprob25.json \
  --twin-p 0.25 --seed-base $(( (20 + R) * 1000000000 + B * 100000000 )) \
  --out runs/p2/twins --run-tag box${B}r${R} \
  >> runs/p2/twins_box${B}r${R}.log 2>&1 &
echo "box $B bid twins r$R launched (pid $!, ${MINUTES}m)"
