#!/usr/bin/env bash
# gen18 — the scale rung: Net2Wider x2 of gen13 (2.15M params, function-
# identical at birth, verified by a 12-pair duel: 50.0%, all pairs split)
# trained with the proven champion-ladder recipe on the Hetzner CCX33.
#
# Day-one bake-off: fine-tuning a CONVERGED champion is the documented
# failure zone (gen13 run 1 declined at lr 3e-4; four-strike law), and
# 5e-5 is the only lr that has ever climbed from a champion init. So two
# arms race for ~a day, then the winner gets the whole box via --resume
# with --workers 7 after the loser is killed.
#
#   arm a: lr 5e-5  (the gen13 stage-2 rate — the proven one)
#   arm b: lr 1e-4  (2x — the widened twins may need the push to diverge)
#
# Recipe notes (why each flag):
#   --opponent-mix 0.5      half self-play = the anti-pacifism anchor
#                           (gen17x1 at mix 1.0 went bid-passive and lost)
#   --opponent-ckpt gen13   frozen champion as the other half (gen8/9/10 recipe)
#   --script none           fully neural, both sides
#   --duel-every 250        bank best_duel.pt vs gen13 on every new high;
#                           20-30-pair duels are a NOISY compass, never a
#                           verdict — promotion needs 150 sprint pairs +
#                           70 marathon pairs, fresh seeds, vs the gen16
#                           STACK (search K24 t>=3 + gen15 belief @0.5)
#
# Run from anywhere:  bash /root/rook13/ml/scripts/gen18_launch.sh
set -euo pipefail

ML=/root/rook13/ml
PY=/root/torch-env/bin/python
cd "$ML"

COMMON="--init-from runs/gen18/init.pt --script none \
  --opponent-mix 0.5 --opponent-ckpt models/gen13.pt --opponent-script none \
  --bid-eps 0.15 --eps-start 0.15 --eps-end 0.03 --eps-decay-iters 2000 \
  --samples-per-iter 16384 --envs 32 --workers 3 \
  --duel-every 250 --duel-pairs 30 --eval-every 200 --iters 100000"

# absolute redirect paths: `cd X && nohup A & nohup B &` runs B in the
# ORIGINAL cwd, so relative redirects land in the wrong place (learned
# the hard way, 2026-07-15)
nohup $PY -m alpharook.train --run gen18a --lr 5e-5 --seed 181 $COMMON \
  > "$ML/runs/gen18a_console.log" 2>&1 &
echo "gen18a (lr 5e-5) pid $!"
sleep 2
nohup $PY -m alpharook.train --run gen18b --lr 1e-4 --seed 182 $COMMON \
  > "$ML/runs/gen18b_console.log" 2>&1 &
echo "gen18b (lr 1e-4) pid $!"

echo "watch:  tail -f $ML/runs/gen18a/log.jsonl"
echo "kill:   pkill -f '[g]en18a'   (bracket trick: pkill -f matches its own cmdline)"
