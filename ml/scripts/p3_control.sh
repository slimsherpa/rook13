#!/bin/bash
# P3 AUTOPSY CONTROL — isolate the card edge in the crown context.
# A = bare anytime core (reflex burial, NO MortalWidow) vs B = Cosmo
# (reflex burial), script none both. If this reads ~+2 the card edge
# stands and the widow assembly is the suspect; if ~0, the P1.2 edge
# was partly conditional on the old heuristic burials.
#   BOX=N bash p3_control.sh
B=${BOX:?set BOX=1..5}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/p3
pgrep -f "p3control_box${B}" > /dev/null && { echo "already running"; exit 1; }
nohup nice -n 5 $PY -m alpharook.duel \
  --a models/gen21-cand1.pt --b models/gen21-cand1.pt \
  --script-a none --script-b none \
  --anytime-a 1.0 \
  --belief-a models/gen15.pt --belief-temp-a 0.5 \
  --worlds-b 24 --search-b play --prior-b 2.0 --min-trick-b 0 \
  --belief-b models/gen15.pt --belief-temp-b 0.5 \
  --pairs 200 --workers 14 \
  --seed $(( B * 52711000 + 33301 )) \
  --dump runs/p3/p3control_box${B}.jsonl \
  >> runs/p3/p3control_box${B}.log 2>&1 &
echo "box $B control launched (pid $!)"
