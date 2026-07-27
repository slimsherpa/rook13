#!/bin/bash
# GEN23 MIMIC keeper (2026-07-26). The Darwin gym is archived (flat at
# parity, heritability ~0 — see GENERATIONS.md gen22); the fleet goes back
# to the one channel with a track record: action-space cloning of a
# verified-stronger teacher.
#
# Teacher = gen21 reflex + gen15 belief(0.5) + K24 PIMC from trick 3,
# measured at 61.7% vs bare gen21 (the same size edge that produced gen21
# from gen13's stack). Records are RAW (seed + actions, replay-checked)
# so any future encoder can re-mill them without regenerating search.
#
# Installed as /root/keeper.sh with __BOX__ replaced by the box index
# (1-4); fired by the existing */10 cron. Resume-safe: each worker skips
# games already written to its shard, so a restart never loses or
# duplicates work. Seed spaces are disjoint per box AND per worker.
B=__BOX__
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/gen23/shards

# The gym is retired — make sure a stale evo process isn't still holding
# cores. Its state file stays on disk; the run is resumable if we ever
# want it back.
pkill -f "alpharook.evo" 2>/dev/null

for w in 0 1 2 3 4; do   # 5 of 8 cores; the ceiling report has the other 3
  pgrep -f "[c]ity${B}_w${w}.jsonl" > /dev/null && continue
  nohup $PY -m alpharook.gen_mimic \
    --out runs/gen23/shards/city${B}_w${w}.jsonl \
    --net models/gen21-cand1.pt \
    --belief runs/gen15/best_duel.pt --belief-temp 0.5 \
    --worlds 24 --min-trick 3 --prior 2.0 --curriculum 0.4 \
    --seed-base $(( (B*10 + w) * 10000000 )) --games 2000000 \
    >> runs/gen23/city${B}_w${w}.log 2>&1 &
done
