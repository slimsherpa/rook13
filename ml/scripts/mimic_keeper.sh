#!/bin/bash
# MIMIC era keeper (2026-07-25, Claude): keep 7 gen_mimic teacher-data
# workers running; fired by the existing */10 cron. Resume-safe: each
# worker skips already-written games in its shard on relaunch.
# Box index B keeps seed spaces disjoint: worker w seeds start at
# (B*10+w)*10,000,000.
B=__BOX__
cd /root/rook13/ml
mkdir -p runs/mimic1/shards
for w in 0 1 2 3 4 5 6; do
  pgrep -f "[c]ity${B}_w${w}.jsonl" > /dev/null && continue
  nohup /root/torch-env/bin/python -m alpharook.gen_mimic \
    --out runs/mimic1/shards/city${B}_w${w}.jsonl \
    --seed-base $(( (B*10 + w) * 10000000 )) --games 2000000 \
    >> runs/mimic1/city${B}_w${w}.log 2>&1 &
done
