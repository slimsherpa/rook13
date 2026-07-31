#!/bin/zsh
# AlphaBid ablation sweep: which knobs matter, 40 pairs per arm (weather-
# grade — the surviving arm gets a 120+ pair gate). Runs arms sequentially.
set -e
cd "$(dirname "$0")/.."
PY="$HOME/torch-env/bin/python"
mkdir -p runs/gen24/oracle
run() {
  echo "=== ARM: $1 ==="
  shift
  caffeinate -i "$PY" -m alpharook.bidoracle --pairs 40 --workers 6 "$@"
}
run "A K16 listen w1.5 m.02"  --worlds 16 --margin 0.02 --widen 1.5
run "B K16 DEAF m.02"         --worlds 16 --margin 0.02 --deaf
run "C K32 listen w1.0 m.03"  --worlds 32 --margin 0.03 --widen 1.0
run "D K32 listen w1.0 m.01"  --worlds 32 --margin 0.01 --widen 1.0
echo "SWEEP DONE"
