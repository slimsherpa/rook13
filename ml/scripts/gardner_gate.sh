#!/bin/bash
# GARDNER FLAVOR GATE (2026-08-10, pre-registered in GARDNER-FLAVOR.md).
# Side A = frozen RC1 + GardnerAgent(tau_style 4.0); side B = vanilla
# RC1. Identical nets, beliefs, budgets — the paired diff prices the
# style layer alone. DEV-pool seed block 3.9e9 (outside report streams).
set -u
PY=~/torch-env/bin/python
cd "$(dirname "$0")/.." || exit 1
mkdir -p runs/gardner

nice -n 5 $PY -m alpharook.duel \
  --a models/gen21-cand1.pt --b models/gen21-cand1.pt \
  --script-a none --script-b none \
  --anytime-a 0.2 --anytime-b 0.2 \
  --belief-a models/gen15.pt --belief-b models/gen15.pt \
  --belief-temp-a 0.5 --belief-temp-b 0.5 \
  --gardner-a 4.0 \
  --pairs "${PAIRS:-800}" --workers "${WORKERS:-5}" \
  --seed 3900000000 \
  --dump runs/gardner/gate_tau4.jsonl \
  2>&1 | tee -a runs/gardner/gate_tau4.log
