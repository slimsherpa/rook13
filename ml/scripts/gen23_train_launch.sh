#!/bin/bash
# GEN23 MIMIC TRAINING — hub (box 1), all 8 cores.
# The recipe is gen21 draft-2 VERBATIM except the corpus: warm-start from
# the incumbent (law 7: imitation only moves the delta), lr 5e-5 (1e-4 is
# twice-proven fatal to champion inits), override rows x4 (verified
# disagreements only — the needle law), banking by match_ovr GATED on
# >=95% bid fidelity (mimic1-a's feral-auction lesson).
#
# Shards: fleet corpus pulled to runs/t0shards/ + MBP shards pushed there.
# The miller reads duel-format rows natively (side filter, dedup,
# win/lose stamps) — train_mimic.py itself is untouched.
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
pgrep -f "[a]lpharook.train_mimic" > /dev/null && exit 0

nohup nice -n 5 $PY -m alpharook.train_mimic \
  --run gen23-mimic1 \
  --shards "runs/t0shards/t0corpus_*.jsonl" \
  --hidden 512,512,256 \
  --init-from models/gen21-cand1.pt \
  --lr 5e-5 \
  --ovr-weight 4.0 \
  --reflex-keep 0.25 \
  --batch-rows 512 \
  --eval-every 2000 \
  --val-games 400 \
  --workers 6 \
  --steps 120000 \
  >> runs/gen23-mimic1_console.log 2>&1 &
echo "gen23-mimic1 launched"
