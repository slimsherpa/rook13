#!/bin/bash
# DUEL KEEPER — keeps the three teacher matchups saturated and, as each one
# reaches its target, hands its cores to whichever arm is furthest behind.
# Installed as /root/duel_keeper.sh on every box; fired by the */5 cron.
#
# Each arm needs 1,000 marathon games (2000/-1000, duplicate decks, seats
# swapped). Shard seeds are disjoint by box AND by stream, so any number of
# workers can be added or removed at any time without colliding — the dumps
# are append-only and pooled at read time.
B=__BOX__
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
TARGET=1000
HUB=5.78.115.122

# fleet-wide count for one arm (every box's shards, this one included)
count() {
  local pat=$1 total=0 n
  for spec in "1 $HUB" "2 5.78.130.139" "3 5.78.128.203" "4 5.78.135.83" \
              "5 5.78.145.180"; do
    set -- $spec
    if [ "$1" = "$B" ]; then
      n=$(cat runs/${pat}_box$1*.jsonl 2>/dev/null | wc -l)
    else
      n=$(ssh -o BatchMode=yes -o ConnectTimeout=6 root@$2 \
          "cat /root/rook13/ml/runs/${pat}_box$1*.jsonl 2>/dev/null | wc -l" \
          2>/dev/null || echo 0)
    fi
    total=$(( total + ${n:-0} ))
  done
  echo $total
}

launch() {   # arm, min_trick, worker_count, stream_tag
  local arm=$1 mt=$2 nw=$3 tag=$4
  pgrep -f "[${arm:0:1}]${arm:1}_box${B}${tag}" > /dev/null && return
  nohup nice -n 5 $PY -m alpharook.duel \
    --a models/gen21-cand1.pt --b models/gen21-cand1.pt \
    --worlds-a 24 --search-a play --prior-a 2.0 --min-trick-a $mt \
    --belief-a runs/gen15/best_duel.pt --belief-temp-a 0.5 \
    --worlds-b 0 --win-score 2000 --lose-score -1000 \
    --pairs 400 --workers $nw --seed $(( RANDOM * 977 + B * 13 )) \
    --dump runs/${arm}_box${B}${tag}.jsonl \
    >> runs/${arm}_box${B}${tag}.log 2>&1 &
}

N3=$(count g21_vs_t3)
N1=$(count g21_vs_t1)
NT=$(count t1m)

# t1-vs-t3 is finished (or nearly): stop feeding it and release its cores
if [ "$NT" -ge "$TARGET" ]; then
  pkill -f "[t]1m_box${B}"
fi

# Give the cores to whichever arm is furthest from its target. Both arms
# stay fed; the laggard simply gets the extra stream.
[ "$N3" -lt "$TARGET" ] && launch g21_vs_t3 3 2 ""
[ "$N1" -lt "$TARGET" ] && launch g21_vs_t1 1 2 ""
if [ "$N3" -lt "$TARGET" ] || [ "$N1" -lt "$TARGET" ]; then
  if [ "$N1" -le "$N3" ]; then
    [ "$N1" -lt "$TARGET" ] && launch g21_vs_t1 1 2 "x"
  else
    [ "$N3" -lt "$TARGET" ] && launch g21_vs_t3 3 2 "x"
  fi
fi

# everything done: stand down so the boxes are free for the corpus
if [ "$N3" -ge "$TARGET" ] && [ "$N1" -ge "$TARGET" ] \
   && [ "$NT" -ge "$TARGET" ]; then
  pkill -f "[a]lpharook.duel"
fi
