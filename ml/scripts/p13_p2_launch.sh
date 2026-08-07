#!/bin/bash
# POST-P1.2 fleet split (launch ONLY after the core freezes):
#   boxes 1-2: P1.3 twin-contract widow gate under the anytime core
#   boxes 3-5: P2 winprob-regen hand soak (anytime self-play)
#   BOX=N ROLE=widow|hands bash p13_p2_launch.sh
B=${BOX:?set BOX=1..5}
ROLE=${ROLE:?set ROLE=widow|hands}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1

if [ "$ROLE" = "widow" ]; then
  mkdir -p runs/p13
  pgrep -f "alpharook.widowtwin" > /dev/null && { echo "already running"; exit 1; }
  nohup nice -n 5 $PY -m alpharook.widowtwin \
    --minutes 600 --workers 14 --core anytime \
    --belief models/gen15.pt --widow-budget 60 \
    --seed-base $(( 13000000000 + B * 100000000 )) \
    --out runs/p13/twins --run-tag box${B} \
    >> runs/p13/twins_box${B}.log 2>&1 &
  echo "box $B widow twins launched (pid $!)"
else
  mkdir -p runs/p2/hands
  pgrep -f "alpharook.handsoak" > /dev/null && { echo "already running"; exit 1; }
  nohup nice -n 5 $PY -m alpharook.handsoak \
    --minutes 600 --workers 14 --core anytime \
    --seed-base $(( 25000000000 + B * 100000000 )) \
    --out runs/p2/hands --run-tag b${B}_ \
    >> runs/p2/hands_box${B}.log 2>&1 &
  echo "box $B hand soak launched (pid $!)"
fi
