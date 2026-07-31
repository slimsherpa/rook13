#!/bin/zsh
# Sweep 2: ride the K gradient (16->32 was +11pp). 40 pairs per arm.
set -e
cd "$(dirname "$0")/.."
PY="$HOME/torch-env/bin/python"
run() {
  echo "=== ARM: $1 ==="
  shift
  caffeinate -i "$PY" -m alpharook.bidoracle --pairs 40 --workers 6 "$@"
}
run "E K48 listen w1.0 m.02 os8" --worlds 48 --margin 0.02 --widen 1.0 --oversample 8
run "F K64 listen w1.0 m.02 os8" --worlds 64 --margin 0.02 --widen 1.0 --oversample 8
echo "SWEEP2 DONE"
