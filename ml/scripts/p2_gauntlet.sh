#!/bin/bash
# P2 OVERNIGHT GAUNTLET v2 (box 5): the full assembly vs EVERY rung of
# the production ladder, weakest to strongest, then the banked
# challenger, then the omniscient ceiling probe LAST (god's exact solves
# are slow — it may run into the morning; its dump is per-game, so
# partial data still counts).
#
# Ladder brains per the shipped browser stacks (src/lib/alpharook):
#   Stomper=gen9  Kitten=gen10  Cub=gen13  (bare reflex)
#   Bobcat = gen10 + uniform PIMC K8 prior2 t>=4
#   Puma   = gen13 + gen15-belief K8 prior2 t>=4 @0.5
#   Cougar = gen13 + gen15-belief K8 prior2 t>=3 @0.5
# Assembly at half budgets (any x0.5, widow 20s) — sanity rungs, not the
# crown; boxes 3-4 run full production budgets tonight.
set -u
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/p2gate

A_ARGS="--a models/gen21-cand1.pt --script-a none \
  --anytime-a 0.5 --mwidow-a 20 --proposer-a models/widowprop-v0.pt \
  --bidbot-a models/bidbot-v0.pt --bidbot-tau-a 0.05 \
  --belief-a models/gen15.pt --belief-temp-a 0.5"

run_duel () {  # $1 tag, $2 pairs, $3... B-side args
  local tag=$1 pairs=$2; shift 2
  echo "=== gauntlet: $tag $(date -u +%H:%M) ===" >> runs/p2gate/gauntlet.log
  nice -n 5 $PY -m alpharook.duel $A_ARGS "$@" \
    --pairs $pairs --workers 14 --seed $(( 555000 + $(date +%s) % 1000 )) \
    --dump runs/p2gate/gauntlet_${tag}.jsonl \
    >> runs/p2gate/gauntlet.log 2>&1
}

BELIEF="--belief-b models/gen15.pt --belief-temp-b 0.5"
run_duel stomper 40 --b models/gen9.pt  --script-b none
run_duel kitten  40 --b models/gen10.pt --script-b none
run_duel bobcat  40 --b models/gen10.pt --script-b none \
  --worlds-b 8 --search-b play --prior-b 2.0 --min-trick-b 4
run_duel cub     40 --b models/gen13.pt --script-b none
run_duel puma    40 --b models/gen13.pt --script-b none \
  --worlds-b 8 --search-b play --prior-b 2.0 --min-trick-b 4 $BELIEF
run_duel cougar  40 --b models/gen13.pt --script-b none \
  --worlds-b 8 --search-b play --prior-b 2.0 --min-trick-b 3 $BELIEF
run_duel gen23   40 --b models/gen23-cand1.pt --script-b none
run_duel godrook 30 --b models/gen21-cand1.pt --script-b none --god-b
echo "GAUNTLET DONE" >> runs/p2gate/gauntlet.log
