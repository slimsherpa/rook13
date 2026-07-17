#!/usr/bin/env bash
# gen19 — expert iteration ("deal mastery"): Riley's "play the hand 100x
# and hone in on the winning line", formalized as AlphaZero's loop. The
# learner's card play runs through the champion search stack (PIMC K12,
# endgame gate t>=3, Q-prior 2, belief-guided worlds from gen15 @ temp
# 0.5) in a slice of self-play games; the improved trajectories train the
# net with ordinary DMC targets — no target surgery, so the four-strike
# law (offline objectives corrupt calibration) doesn't apply.
#
# Student = fresh gen13 (one variable at a time; the widened gen18a sits
# paused, resumable). Opponent = frozen gen13 at mix 0.5, the proven
# anti-pacifism recipe. lr 5e-5, the only rate that has ever climbed
# from a converged champion init.
#
# --search-rows-frac balances round wall-time: the round waits for the
# slowest worker, so if sec_total blows past ~12s, lower the frac (or
# worlds) and relaunch with --resume.
#
# Run from anywhere:  bash /root/rook13/ml/scripts/gen19_launch.sh
set -euo pipefail

ML=/root/rook13/ml
PY=/root/torch-env/bin/python
cd "$ML"

nohup $PY -m alpharook.train --run gen19 --lr 5e-5 --seed 191 \
  --init-from models/gen13.pt --script none \
  --opponent-mix 0.5 --opponent-ckpt models/gen13.pt --opponent-script none \
  --bid-eps 0.15 --eps-start 0.15 --eps-end 0.03 --eps-decay-iters 2000 \
  --samples-per-iter 16384 --envs 32 --workers 7 \
  --search-workers 2 --search-rows-frac 0.15 \
  --search-worlds 12 --search-min-trick 3 --search-prior 2 \
  --search-belief models/gen15.pt --search-belief-temp 0.5 \
  --duel-every 250 --duel-pairs 50 --eval-every 200 --iters 100000 \
  > "$ML/runs/gen19_console.log" 2>&1 &
echo "gen19 pid $!"
echo "watch:  tail -f $ML/runs/gen19/log.jsonl   (search_games field = expert slice)"
