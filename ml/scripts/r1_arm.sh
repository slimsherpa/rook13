#!/bin/bash
# R1 shortlist_regret shard on this box (FINAL-WEEK-PLAN §6 R1).
#   BOX=N bash r1_arm.sh          # ~40 games/worker x 14 workers
# Reads the box's own soak shard; self-terminates (bounded by --games);
# no keeper. Waits up to 3h for any running duel/twins to exit first.
set -u
B=${BOX:?set BOX=1..5}
GAMES=${GAMES:-15}
KSEL=${KSEL:-48}
KEVAL=${KEVAL:-16}
SAMPLEP=${SAMPLEP:-0.25}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/r1
exec 9>runs/r1/arm.lock
flock -n 9 || { echo "another r1_arm holds the lock, exiting"; exit 0; }
for i in $(seq 1 1440); do   # up to 12h — queues behind contam/twins
  pgrep -f "[a]lpharook.duel|[b]idtwins" > /dev/null || break
  sleep 30
done
nohup nice -n 5 $PY -m alpharook.r1_shortlist \
  --corpus "runs/belief/soak_box${B}_acts.jsonl" \
  --games "$GAMES" --workers 14 --sample-p "$SAMPLEP" \
  --k-sel "$KSEL" --k-eval "$KEVAL" \
  --out runs/r1/r1_box${B}.jsonl \
  >> runs/r1/r1_box${B}.log 2>&1 &
echo "box $B R1 shard launched (pid $!, $GAMES games/worker)"
