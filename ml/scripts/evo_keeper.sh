#!/bin/bash
# DARWIN GYM keeper (2026-07-25, gen22 era). Installed as /root/keeper.sh
# with __BOX__ replaced by the box index (1-4); fired by the existing
# */10 cron. Self-assembling: builds the contested-deal library first
# (~1h, one 24k-deal pass with dithered gen21), then keeps the city
# evolving. evo runs with --max-hours 12 for clean-exit hygiene; the next
# cron tick resumes it with full state (Elo, banks, pedigree, curve).
B=__BOX__
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
mkdir -p runs/decks

LIB=runs/decks/lib.jsonl
LINES=$({ wc -l < "$LIB"; } 2>/dev/null || echo 0)
if [ "$LINES" -lt 24000 ]; then
  pgrep -f "alpharook.[c]ontested" > /dev/null && exit 0
  nohup $PY -m alpharook.contested --net models/gen21-cand1.pt \
    --out "$LIB" --deals 24000 --k 8 --temp 0.2 \
    --seed-base $(( B * 10000000 )) --workers 7 \
    >> runs/decks/build.log 2>&1 &
  exit 0
fi

pgrep -f "alpharook.[e]vo " > /dev/null && exit 0
case $B in
  1) ARGS="--run evo-provo --city provo --tier-weights 0.15,0.35,0.50" ;;
  2) ARGS="--run evo-orem  --city orem  --tier-weights 0.02,0.18,0.80" ;;
  3) ARGS="--run evo-logan --city logan --tier-weights 0.15,0.35,0.50 \
     --lr 1e-4 --eps 0.12 --sugar-hand 0.40 --sugar-game 0.35" ;;
  4) ARGS="--run evo-moab  --city moab  --random-decks" ;;
esac
nohup $PY -m alpharook.evo $ARGS --deck-lib "$LIB" \
  --workers 7 --max-hours 12 --resume \
  >> runs/evo_console.log 2>&1 &
