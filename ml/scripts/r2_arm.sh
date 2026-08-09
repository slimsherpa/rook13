#!/bin/bash
# R2 defense-ladder shard on this box (FINAL-WEEK-PLAN §6 R2).
#   BOX=N ARM=god|highk bash r2_arm.sh
# Counterfactual hand replays from the box's own soak shard; defenders
# upgraded, declarer live. Self-terminates (bounded by --hands); no keeper.
set -u
B=${BOX:?set BOX=1..5}
ARM=${ARM:?set ARM=god|highk}
HANDS=${HANDS:-40}
K=${K:-96}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/r2
exec 9>"runs/r2/arm_${ARM}.lock"
flock -n 9 || { echo "another r2_arm ($ARM) holds the lock, exiting"; exit 0; }
for i in $(seq 1 1440); do
  pgrep -f "[a]lpharook.duel|[b]idtwins|[r]1_shortlist" > /dev/null || break
  sleep 30
done
nohup nice -n 5 $PY -m alpharook.r2_ladder \
  --corpus "runs/belief/soak_box${B}_acts.jsonl" \
  --arm "$ARM" --k "$K" --hands "$HANDS" --workers 14 \
  --out runs/r2/r2_${ARM}_box${B}.jsonl \
  >> runs/r2/r2_${ARM}_box${B}.log 2>&1 &
echo "box $B R2 $ARM shard launched (pid $!, $HANDS hands/worker)"
