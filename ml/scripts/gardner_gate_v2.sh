#!/bin/bash
# GARDNER v2 "shape" GATE (2026-08-11, pre-registered in
# GARDNER-FLAVOR.md). Side A = RC1 + GardnerAgent shape-mode tau 4.0
# (--gardner-a -4.0, negative = v2); side B = vanilla RC1. SAME seed
# block as the v1 gate ON PURPOSE: identical deals let the rollup
# compare v1 and v2 divergent-hand costs deal-for-deal.
set -u
PY=~/torch-env/bin/python
cd "$(dirname "$0")/.." || exit 1
mkdir -p runs/gardner
export GARDNER_TELEMETRY=runs/gardner/v2_telemetry.jsonl

nice -n 5 $PY -m alpharook.duel \
  --a models/gen21-cand1.pt --b models/gen21-cand1.pt \
  --script-a none --script-b none \
  --anytime-a 0.25 --anytime-b 0.25 \
  --belief-a models/gen15.pt --belief-b models/gen15.pt \
  --belief-temp-a 0.5 --belief-temp-b 0.5 \
  --gardner-a -4.0 \
  --pairs "${PAIRS:-700}" --workers "${WORKERS:-8}" \
  --seed 3900000000 \
  --dump runs/gardner/gate_v2.jsonl \
  2>&1 | tee -a runs/gardner/gate_v2.log
