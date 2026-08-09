#!/bin/bash
# P2 GATE, overnight keeper: wait for the r3 twin soak to self-terminate,
# then flip the box straight to gate duty. Two roles:
#   marginal : A = ASSEMBLED + BidBot vs B = ASSEMBLED (same core, same
#              widow) — the auction's isolated marginal, the P2 verdict.
#   crown    : A = ASSEMBLED + BidBot vs B = Cosmo-as-production — the
#              launch-facing number, extends the banked p3crown battery.
# Duplicate decks, family format, fresh seeds, per-hand currency first.
#   BOX=N ROLE=marginal|crown TAU=0.08 bash p2_gate_keeper.sh
set -u
B=${BOX:?set BOX=1..5}
ROLE=${ROLE:?set ROLE=marginal|crown}
TAU=${TAU:-0.05}  # pinned 2026-08-08 Phase 0: one τ everywhere (FINAL-WEEK-PLAN §5)
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/p2gate

# stand down until the soak's own clock runs out
while pgrep -f "[b]idtwins" > /dev/null; do sleep 60; done

A_ARGS="--a models/gen21-cand1.pt --script-a none \
  --anytime-a 1.0 --mwidow-a 60 --proposer-a models/widowprop-v0.pt \
  --bidbot-a models/bidbot-v0.pt --bidbot-tau-a $TAU \
  --belief-a models/gen15.pt --belief-temp-a 0.5"

if [ "$ROLE" = "marginal" ]; then
  B_ARGS="--b models/gen21-cand1.pt --script-b none \
    --anytime-b 1.0 --mwidow-b 60 --proposer-b models/widowprop-v0.pt \
    --belief-b models/gen15.pt --belief-temp-b 0.5"
else
  B_ARGS="--b models/gen21-cand1.pt --script-b none \
    --worlds-b 24 --search-b play --prior-b 2.0 --min-trick-b 0 \
    --belief-b models/gen15.pt --belief-temp-b 0.5"
fi

nohup nice -n 5 $PY -m alpharook.duel $A_ARGS $B_ARGS \
  --pairs 200 --workers 14 \
  --seed $(( B * 41077000 + 20801 )) \
  --dump runs/p2gate/${ROLE}_box${B}.jsonl \
  >> runs/p2gate/${ROLE}_box${B}.log 2>&1 &
echo "box $B armed: $ROLE gate after soak (tau $TAU, pid $!)"
