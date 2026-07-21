#!/usr/bin/env bash
# gen20 — the HOT SEAT gym (Riley's design). One role per run maximizes its
# team's raw points-per-hand; no auction (dealer force-bid = the taker);
# other seats frozen gen13. Hot seat plays search+reflex from trick 0 with
# the prior sliding 12 -> 2 across the tricks (reflex-dominant early,
# search-dominant late). Metric = points/hand; luck-free battery on fixed
# decks every 250 iters; battery highs banked to best_battery.pt.
#
# First run: the PARTNER role — where the family's complaints live.
#
# Run from anywhere:  bash /root/rook13/ml/scripts/gen20_launch.sh [role]
# role = partner (default) | taker | left | right — one box per role, the
# fleet strategy: CPX41s benchmarked FASTER than the CCX33 at half price
set -euo pipefail

ML=/root/rook13/ml
PY=/root/torch-env/bin/python
cd "$ML"

ROLE=${1:-partner}
nohup $PY -m alpharook.hotseat --run "hot-$ROLE" --role "$ROLE" \
  --init-from models/gen13.pt --frozen models/gen13.pt \
  --belief runs/gen15/best_duel.pt --belief-temp 0.5 \
  --worlds 8 --prior-start 12 --prior-end 2 \
  --lr 5e-5 --eps 0.03 --samples-per-iter 8192 --workers 7 \
  --eval-every 100 --eval-hands 240 --iters 100000 --resume \
  > "$ML/runs/hot-${ROLE}_console.log" 2>&1 &
echo "hot-$ROLE pid $!"
echo "watch:  tail -f $ML/runs/hot-$ROLE/log.jsonl   (hot_pts = the Riley metric)"
