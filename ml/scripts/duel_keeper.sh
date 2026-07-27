#!/bin/bash
# DUEL KEEPER — keeps the teacher matchups saturated and moves cores to
# whichever arm is furthest behind. Installed as /root/duel_keeper.sh on
# every box; fired by the */5 cron.
#
# Arms (all marathon 2000/-1000, duplicate decks, seats swapped):
#   t1m         t1 teacher vs t3 teacher   — which gate is better
#   g21_vs_t3   t3 stack vs bare gen21     — rung the CURRENT teacher offers
#   g21_vs_t1   t1 stack vs bare gen21     — rung a trick-1 teacher offers
#   g21_vs_t0   t0 stack vs bare gen21     — rung a teacher that searches
#                                            the OPENING LEAD offers
#
# t0 is Riley's thesis arm: min_trick 0 is the ONLY gate that searches the
# very first card. t1 still plays the whole first trick on reflex (it
# starts once 1 trick is COMPLETE), so t1 does not test "the first card
# matters most" at all — it only covers cards 5-8.
#
# t0 is also the slowest config on the fleet (search on all 9 tricks of a
# ~68-hand game), so it is best-effort: take as many games as the clock
# allows rather than blocking on a fixed target.
B=__BOX__
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
TARGET=1000
STREAMS=4                     # 4 streams x 2 workers = 8 cores
HUB=5.78.115.122

count() {                     # fleet-wide game count for one arm
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

running() { pgrep -f "[-]-dump runs/$1_box${B}$2.jsonl" > /dev/null; }

launch() {                    # arm, min_trick, stream_tag
  running "$1" "$3" && return
  nohup nice -n 5 $PY -m alpharook.duel \
    --a models/gen21-cand1.pt --b models/gen21-cand1.pt \
    --worlds-a 24 --search-a play --prior-a 2.0 --min-trick-a $2 \
    --belief-a runs/gen15/best_duel.pt --belief-temp-a 0.5 \
    --worlds-b 0 --win-score 2000 --lose-score -1000 \
    --pairs 400 --workers 2 --seed $(( (RANDOM + B * 7919) % 900000 + 1000 )) \
    --dump runs/$1_box${B}$3.jsonl \
    >> runs/$1_box${B}$3.log 2>&1 &
}

NT=$(count t1m)
N3=$(count g21_vs_t3)
N1=$(count g21_vs_t1)
N0=$(count g21_vs_t0)

# t1-vs-t3 reached its read: stop feeding it and release its cores
if [ "$NT" -ge "$TARGET" ]; then
  pkill -f "[-]-dump runs/t1m_box${B}"
else
  running t1m "" && STREAMS=$(( STREAMS - 1 ))   # it still holds a stream
fi

# one base stream per unfinished arm, in priority order, then hand any
# leftover streams to the arm furthest from target
declare -a ARMS=()
[ "$N3" -lt "$TARGET" ] && ARMS+=("g21_vs_t3 3 $N3")
[ "$N1" -lt "$TARGET" ] && ARMS+=("g21_vs_t1 1 $N1")
[ "$N0" -lt "$TARGET" ] && ARMS+=("g21_vs_t0 0 $N0")

used=0
for a in "${ARMS[@]}"; do
  [ "$used" -ge "$STREAMS" ] && break
  set -- $a; launch "$1" "$2" ""
  used=$(( used + 1 ))
done

while [ "$used" -lt "$STREAMS" ] && [ "${#ARMS[@]}" -gt 0 ]; do
  lag=""; low=999999
  for a in "${ARMS[@]}"; do
    set -- $a
    if [ "$3" -lt "$low" ]; then low=$3; lag="$1 $2"; fi
  done
  [ -z "$lag" ] && break
  set -- $lag; launch "$1" "$2" "x$used"
  used=$(( used + 1 ))
  break                       # one spare stream per tick is plenty
done

# everything done: stand down so the boxes are free for the corpus
if [ "$NT" -ge "$TARGET" ] && [ "$N3" -ge "$TARGET" ] \
   && [ "$N1" -ge "$TARGET" ] && [ "$N0" -ge "$TARGET" ]; then
  pkill -f "[a]lpharook.duel"
fi
