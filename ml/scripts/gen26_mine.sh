#!/bin/bash
# GEN26 CORPUS MINER (2026-08-12): Gardner-v2 self-play WITH the action
# dump — every game banks its full decision sequence (replay-verified,
# reflex choice noted at searched decisions), the teacher corpus for the
# Gardner-style reflex distill (the pink-Trainer net).
#
# All four seats play the ship stack: gen21 + anytime(0.25) + Gardner
# shape tau 4.0. Pure on-policy self-play for v0 (the 70/30 vs-Cosmo
# diversity mix is a fleet-era option). Seeds: fresh DEV block 3.95e9,
# BOX offsets by worker env for fleet use later.
#
#   MINE_SEED=3950000000 PAIRS=4000 WORKERS=8 bash scripts/gen26_mine.sh
#
# Resumable: --dump-actions records pair seeds; relaunching skips banked
# pairs automatically.
set -u
PY=~/torch-env/bin/python
cd "$(dirname "$0")/.." || exit 1
mkdir -p runs/gen26
TAG="${TAG:-box0}"

nice -n 5 $PY -m alpharook.duel \
  --a models/gen21-cand1.pt --b models/gen21-cand1.pt \
  --script-a none --script-b none \
  --anytime-a 0.25 --anytime-b 0.25 \
  --belief-a models/gen15.pt --belief-b models/gen15.pt \
  --belief-temp-a 0.5 --belief-temp-b 0.5 \
  --gardner-a -4.0 --gardner-b -4.0 \
  --pairs "${PAIRS:-4000}" --workers "${WORKERS:-8}" \
  --seed "${MINE_SEED:-3950000000}" \
  --dump-actions runs/gen26/mine_${TAG}.jsonl \
  --dump runs/gen26/mine_${TAG}_games.jsonl \
  2>&1 | tee -a runs/gen26/mine_${TAG}.log
