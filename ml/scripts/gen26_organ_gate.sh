#!/bin/bash
# GEN26 ORGAN-SWAP GATE (battery §2, 2026-08-13) — the flywheel test that
# caught gen23. Candidate stack: Gen26 reflex + anytime searcher at the
# RC1 serving clock (0.25), NO Gardner wrapper (hypothesis: the style
# lives in the organ now). Incumbent: the current ship stack.
#
# REQUIRES the QCAL-fitted prior_scale (alpharook/qcal.py) — running the
# candidate with the gen21-tuned 120 would mis-set the stopping prior and
# the gate would measure a miscalibration, not the organ.
#
#   PS26=<fitted> bash scripts/gen26_organ_gate.sh          # vs ship stack
#   PS26=<fitted> ARM=plain bash scripts/gen26_organ_gate.sh # vs bare gen21+anytime
#
# Paired decks by construction (duel harness), ~300 pairs overnight on
# the laptop. Read the verdict off the duel's own paired table.
set -u
PY=~/torch-env/bin/python
cd "$(dirname "$0")/.." || exit 1
: "${PS26:?run alpharook.qcal first and pass its fitted prior_scale as PS26=...}"
ARM="${ARM:-ship}"
mkdir -p runs/gen26

if [ "$ARM" = "ship" ]; then
  GARDNER_A="-4.0"      # incumbent = gen21 + anytime + Gardner shape (prod)
else
  GARDNER_A="0.0"       # incumbent = bare gen21 + anytime (organ isolate)
fi

nice -n 5 $PY -m alpharook.duel \
  --a models/gen21-cand1.pt --b runs/gen26v0b/best.pt \
  --script-a none --script-b none \
  --anytime-a 0.25 --anytime-b 0.25 \
  --belief-a models/gen15.pt --belief-b models/gen15.pt \
  --belief-temp-a 0.5 --belief-temp-b 0.5 \
  --gardner-a "$GARDNER_A" \
  --prior-scale-b "$PS26" \
  --pairs "${PAIRS:-300}" --workers "${WORKERS:-8}" \
  --seed "${GATE_SEED:-4050000000}" \
  --dump "runs/gen26/organ_gate_${ARM}.jsonl" \
  2>&1 | tee "runs/gen26/organ_gate_${ARM}.log"
