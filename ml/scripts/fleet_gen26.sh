#!/bin/bash
# GEN26 FLEET SPIN-UP (2026-08-12): provision a Hetzner box and launch
# the Gardner-v2 corpus miner. Idempotent-ish; safe to rerun.
#   bash scripts/fleet_gen26.sh <ip> <box_index> [pairs]
set -u
IP=$1; BOX=$2; PAIRS=${3:-900}
SEED=$((30000000000 + BOX * 1000000000))
ML=/Users/rileyadamson/Documents/GitHub/rook13/ml
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 root@$IP"

echo "[$IP box$BOX] deps..."
$SSH 'which gcc >/dev/null || (apt-get -qq update && apt-get -qq -y install build-essential python3-venv rsync > /dev/null)' || exit 1
$SSH '[ -x /root/torch-env/bin/python ] || (python3 -m venv /root/torch-env && /root/torch-env/bin/pip -q install --index-url https://download.pytorch.org/whl/cpu torch && /root/torch-env/bin/pip -q install numpy)' || exit 1

echo "[$IP box$BOX] sync code+models..."
$SSH 'mkdir -p /root/rook13/ml/models /root/rook13/ml/scripts'
rsync -az --timeout=60 \
  --exclude '__pycache__' --exclude '_csolver.so' --exclude 'runs' \
  --exclude 'history' --exclude 'tests' \
  "$ML/rook" "$ML/alpharook" "$ML/scripts/gen26_mine.sh" \
  root@$IP:/root/rook13/ml/ || exit 1
rsync -az --timeout=120 \
  "$ML/models/gen21-cand1.pt" "$ML/models/gen15.pt" \
  root@$IP:/root/rook13/ml/models/ || exit 1
$SSH 'mkdir -p /root/rook13/ml/scripts && mv -f /root/rook13/ml/gen26_mine.sh /root/rook13/ml/scripts/ 2>/dev/null; true'

echo "[$IP box$BOX] build csolver + sanity..."
$SSH 'cd /root/rook13/ml && cc -O3 -shared -fPIC rook/csolver.c -o rook/_csolver.so && /root/torch-env/bin/python -c "
import sys; sys.path.insert(0,\".\")
from alpharook.model import load_qnet
from alpharook.gardner import GardnerAgent
import rook.csolver
n=load_qnet(\"models/gen21-cand1.pt\")
print(\"sanity ok\")"' || exit 1

echo "[$IP box$BOX] launch miner (seed $SEED, $PAIRS pairs)..."
$SSH "cd /root/rook13/ml && mkdir -p runs/gen26 && PY=/root/torch-env/bin/python && \
  sed -i 's|PY=~/torch-env/bin/python|PY=/root/torch-env/bin/python|' scripts/gen26_mine.sh && \
  TAG=box$BOX MINE_SEED=$SEED PAIRS=$PAIRS WORKERS=14 \
  nohup bash scripts/gen26_mine.sh > runs/gen26/launch_box$BOX.log 2>&1 & \
  sleep 5; pgrep -f alpharook.duel | head -1"
echo "[$IP box$BOX] LAUNCHED"
