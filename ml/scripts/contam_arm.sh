#!/bin/bash
# FINAL-WEEK R-kill-switch: one oracle-contamination arm on this box.
#   BOX=N P=1.0 PAIRS=250 bash contam_arm.sh
# A = RC1 with contam_p (search worlds are the TRUE deal with prob p),
# B = clean RC1. Same assembly otherwise, duplicate decks, DEV seeds.
# Waits (up to 2h) for any running duel to exit first, then runs ONCE and
# self-terminates — no keeper, ≤12h by construction (250 pairs ≈ 10.5h).
# The p=0 control is the banked belief soak (mirror RC1, 50.0% by
# construction) — no box-hours spent re-measuring the null.
set -u
B=${BOX:?set BOX=1..5}
P=${P:?set P=0.25|0.5|1.0}
PAIRS=${PAIRS:-250}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/contam
# single-instance lock: a second copy of this script exits instead of
# racing the first to the launch line when the soak ends
exec 9>runs/contam/arm.lock
flock -n 9 || { echo "another contam_arm holds the lock, exiting"; exit 0; }
for i in $(seq 1 240); do
  pgrep -f "[a]lpharook.duel" > /dev/null || break
  sleep 30
done
pgrep -f "[a]lpharook.duel" > /dev/null && { echo "duel still busy after 2h, aborting"; exit 1; }
TAG=p$(echo "$P" | tr -d '.')_box${B}
RC1_A="--a models/gen21-cand1.pt --script-a none --anytime-a 1.0 --mwidow-a 60 \
  --proposer-a models/widowprop-v0.pt --bidbot-a models/bidbot-v0.pt \
  --bidbot-tau-a 0.05 --belief-a models/gen15.pt --belief-temp-a 0.5"
RC1_B="--b models/gen21-cand1.pt --script-b none --anytime-b 1.0 --mwidow-b 60 \
  --proposer-b models/widowprop-v0.pt --bidbot-b models/bidbot-v0.pt \
  --bidbot-tau-b 0.05 --belief-b models/gen15.pt --belief-temp-b 0.5"
nohup nice -n 5 $PY -m alpharook.duel $RC1_A --contam-a "$P" $RC1_B \
  --pairs "$PAIRS" --workers 14 \
  --seed $(( 3000000000 + B * 10000000 )) \
  --dump runs/contam/${TAG}.jsonl \
  >> runs/contam/${TAG}.log 2>&1 &
echo "box $B contamination arm p=$P launched (pid $!, $PAIRS pairs, DEV seeds)"
