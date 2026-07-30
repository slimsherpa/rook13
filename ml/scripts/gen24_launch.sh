#!/bin/zsh
# gen24 bid gym — launch all four cities on this Mac.
#   ml/scripts/gen24_launch.sh          start (resumes from state.json)
#   pkill -f alpharook.bidcity          stop
# Each city is one nice'd process; caffeinate keeps the MBP awake while
# any of them runs. Logs: ml/runs/gen24/<city>.console.log

set -e
cd "$(dirname "$0")/.."
PY="$HOME/torch-env/bin/python"
mkdir -p runs/gen24

if pgrep -f alpharook.bidcity > /dev/null; then
    echo "bid gym already running:"
    pgrep -fl alpharook.bidcity
    exit 1
fi

for city in provo orem logan moab; do
    nohup nice -n 10 caffeinate -i "$PY" -m alpharook.bidcity \
        --city "$city" --seasons 100000 --pairs 4 \
        >> "runs/gen24/$city.console.log" 2>&1 &
    echo "  $city started (pid $!)"
done
echo "status: $PY scripts/gen24_status.py"
