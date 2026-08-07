#!/bin/bash
# P3 CROWN MATCH — the assembled candidate vs Cosmo, the campaign's
# biggest compute line item. Duplicate decks, family format, fresh
# seeds, per-hand currency first (resolves ~10x faster than win%).
#
# A = ASSEMBLED: anytime card core (frozen P1.2 config) + MortalWidow
#     burial (budget from WIDOW_BUDGET, WidowProp-v0 shortlist, k_min 16)
# B = COSMO exactly as production plays: gen21 reflex bids + reflex
#     burial + gen21 x belief x t0 K24 card play
# Both sides script "none": every decision is the agent's own.
#
#   BOX=N WIDOW_BUDGET=SS bash p3_crown.sh
B=${BOX:?set BOX=1..5}
W=${WIDOW_BUDGET:?set WIDOW_BUDGET (seconds, from the gate verdict)}
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/p3

pgrep -f "p3crown_box${B}" > /dev/null && { echo "already running"; exit 1; }

ROOK_THINK_LOG=runs/p3/think_box${B}.jsonl \
nohup nice -n 5 $PY -m alpharook.duel \
  --a models/gen21-cand1.pt --b models/gen21-cand1.pt \
  --script-a none --script-b none \
  --anytime-a 1.0 --mwidow-a $W --proposer-a models/widowprop-v0.pt \
  --belief-a models/gen15.pt --belief-temp-a 0.5 \
  --worlds-b 24 --search-b play --prior-b 2.0 --min-trick-b 0 \
  --belief-b models/gen15.pt --belief-temp-b 0.5 \
  --pairs 200 --workers 14 \
  --seed $(( B * 31337000 + 90001 )) \
  --dump runs/p3/p3crown_box${B}.jsonl \
  >> runs/p3/p3crown_box${B}.log 2>&1 &
echo "box $B crown match launched (widow ${W}s, pid $!)"
