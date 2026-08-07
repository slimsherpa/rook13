#!/bin/bash
# THE WIDOW MARGINAL — paired: assembled (anytime + MortalWidow 60s +
# WidowProp) vs BARE anytime, duplicate decks. The only difference is
# the burial, so deal luck cancels and the widow's real-game value
# resolves at per-hand precision. Charter P1.3 is null-OK: a wash means
# the widow stays home and the launch is the bare core.
#   BOX=N bash p3_widowmarg.sh
B=${BOX:?set BOX=1..5}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/p3
pgrep -f "p3wmarg_box${B}" > /dev/null && { echo "already running"; exit 1; }
nohup nice -n 5 $PY -m alpharook.duel \
  --a models/gen21-cand1.pt --b models/gen21-cand1.pt \
  --script-a none --script-b none \
  --anytime-a 1.0 --mwidow-a 60 --proposer-a models/widowprop-v0.pt \
  --belief-a models/gen15.pt --belief-temp-a 0.5 \
  --anytime-b 1.0 \
  --belief-b models/gen15.pt --belief-temp-b 0.5 \
  --pairs 200 --workers 14 \
  --seed $(( B * 71993000 + 55501 )) \
  --dump runs/p3/p3wmarg_box${B}.jsonl \
  >> runs/p3/p3wmarg_box${B}.log 2>&1 &
echo "box $B widow-marginal launched (pid $!)"
