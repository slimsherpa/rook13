#!/bin/bash
# Nightly contested-library refill (cron: daily 08:10 UTC = 2:10am MT).
# Extends the box's library by 12k deals per night up to 120k, niced so
# the gym barely notices. Bigger library = less deal repetition in the
# curriculum. Seed space stays the box's own (B*10M), append-resume by
# line count.
B=__BOX__
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
LIB=runs/decks/lib.jsonl
LINES=$(wc -l < "$LIB" 2>/dev/null || echo 0)
[ "$LINES" -lt 24000 ] && exit 0          # initial build still owns it
[ "$LINES" -ge 120000 ] && exit 0
pgrep -f "alpharook.contested" > /dev/null && exit 0
nohup nice -n 19 $PY -m alpharook.contested --net models/gen21-cand1.pt \
  --out "$LIB" --deals $(( LINES + 12000 )) --k 8 --temp 0.2 \
  --seed-base $(( B * 10000000 )) --workers 4 \
  >> runs/decks/build.log 2>&1 &
