#!/bin/bash
# THE RECEIPT DUEL (pre-registered 2026-08-12): Gardner-RC1 at the
# serving budget vs the EXACT production Cosmo.
#
# Side A: gen21-cand1 + anytime(0.25, the serving clock from the
#   latency profile) + Gardner flavor. FLAVOR=v2 (default) uses shape
#   mode (--gardner-a -4.0); FLAVOR=v1 uses card mode (+4.0). The
#   flavor is chosen by the v2 gate's pre-registered verdict.
# Side B: the production 'teacher' agent, replicated flag-for-flag from
#   service/brain/main.py get_agent("teacher"): gen21-cand1 reflex +
#   SearchAgent worlds=24 prior_weight=2.0 min_trick=0, play-only,
#   belief gen15 @0.5 (models/gen15.pt == runs/gen15/best_duel.pt,
#   md5-verified 23ef1a8b).
#
# Banked baseline to beat: RC1 vs Cosmo +0.8 pts/hand ~ 51.2% game-win
# (1,200 games, lab budget). Ship line (pre-registered): the receipt
# must show Gardner-RC1 >= Cosmo (paired delta >= 0 within CI) at the
# serving clock; a clearly negative receipt blocks the launch.
set -u
PY=~/torch-env/bin/python
cd "$(dirname "$0")/.." || exit 1
mkdir -p runs/gardner
FLAVOR="${FLAVOR:-v2}"
if [ "$FLAVOR" = "v1" ]; then GFLAG="4.0"; else GFLAG="-4.0"; fi
export GARDNER_TELEMETRY=runs/gardner/receipt_telemetry.jsonl

nice -n 5 $PY -m alpharook.duel \
  --a models/gen21-cand1.pt --script-a none \
  --anytime-a 0.25 --gardner-a $GFLAG \
  --belief-a models/gen15.pt --belief-temp-a 0.5 \
  --b models/gen21-cand1.pt --script-b none \
  --worlds-b 24 --prior-b 2.0 --min-trick-b 0 --search-b play \
  --belief-b models/gen15.pt --belief-temp-b 0.5 \
  --pairs "${PAIRS:-700}" --workers "${WORKERS:-8}" \
  --seed 5900000000 \
  --dump runs/gardner/receipt_${FLAVOR}.jsonl \
  2>&1 | tee -a runs/gardner/receipt_${FLAVOR}.log
