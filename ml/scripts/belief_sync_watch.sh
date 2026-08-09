#!/bin/bash
# FINAL-WEEK Phase 0: babysit the belief soak's last hours from the MBP.
# Rsync runs/belief/ from all five boxes every 15 min until no box has a
# live alpharook.duel, then final-sync and exit. Detached via nohup; log
# is runs/belief/sync_watch.log. See ml/FINAL-WEEK-PLAN.md §13.
BOXES="5.78.115.122 5.78.130.139 5.78.135.83 5.78.128.203 5.78.145.180"
cd /Users/rileyadamson/Documents/GitHub/rook13/ml || exit 1
LOG=runs/belief/sync_watch.log
for i in $(seq 1 40); do  # hard stop after ~10h no matter what
  alive=0
  for ip in $BOXES; do
    rsync -az --timeout=30 --exclude '__pycache__' \
      "root@$ip:/root/rook13/ml/runs/belief/" runs/belief/ >> "$LOG" 2>&1
    if ssh -o BatchMode=yes -o ConnectTimeout=8 "root@$ip" \
        'pgrep -f "[a]lpharook.duel" > /dev/null' 2>/dev/null; then
      alive=$((alive+1))
    fi
  done
  echo "$(date '+%F %T') cycle $i: $alive/5 boxes still soaking" >> "$LOG"
  [ "$alive" -eq 0 ] && break
  sleep 900
done
for ip in $BOXES; do
  rsync -az --timeout=30 --exclude '__pycache__' \
    "root@$ip:/root/rook13/ml/runs/belief/" runs/belief/ >> "$LOG" 2>&1
done
tot=$(cat runs/belief/soak_box*.jsonl 2>/dev/null | wc -l | tr -d ' ')
echo "$(date '+%F %T') SOAK COMPLETE — $tot games synced; fleet idle" >> "$LOG"
