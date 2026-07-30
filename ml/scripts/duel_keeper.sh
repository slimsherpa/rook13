#!/bin/bash
# T0 KEEPER — every core on gen21 vs the trick-0 teacher, and every game
# recorded so the run is BOTH a measurement and a teacher corpus.
#
# Settled already (marathon, duplicate decks, seats swapped):
#   t1 beats t3 53.9% (p=0.007) — real but ~4pp, and t1 costs 1.47x per
#     needle, so the bulk teacher stays t3. Question closed.
#   t3 stack beats bare gen21 74.7% (n=810), t1 stack 74.9% (n=466) —
#     indistinguishable, so t1 buys nothing where it counts.
#   t0 stack 79.3% (n=140) — highest, but +4.6pp over t3 at p=0.11.
#     NOT yet significant. This keeper exists to settle it.
#
# --dump-actions makes each game double-duty: the full action sequence is
# written in mimic format (replay-verified before it is trusted), with
# side A's searched decisions carrying the reflex choice so the needles
# are millable later. A measurement run that also builds corpus.
B=__BOX__
PY=/root/torch-env/bin/python
cd /root/rook13/ml || exit 1
STREAMS=4                     # 4 streams x 2 workers = 8 cores

# the other arms are done deciding — release their cores
pkill -f "[-]-dump runs/t1m_box${B}"
pkill -f "[-]-dump runs/g21_vs_t3_box${B}"
pkill -f "[-]-dump runs/g21_vs_t1_box${B}"

for k in $(seq 0 $(( STREAMS - 1 ))); do
  tag=""; [ "$k" -gt 0 ] && tag="x$k"
  pgrep -f "[-]-dump runs/g21_vs_t0_box${B}${tag}.jsonl" > /dev/null && continue
  nohup nice -n 5 $PY -m alpharook.duel \
    --a models/gen21-cand1.pt --b models/gen21-cand1.pt \
    --worlds-a 24 --search-a play --prior-a 2.0 --min-trick-a 0 \
    --belief-a runs/gen15/best_duel.pt --belief-temp-a 0.5 \
    --worlds-b 0 --win-score 2000 --lose-score -1000 \
    --pairs 2000 --workers 2 \
    --seed $(( (B * 100 + k) * 7919 + 101 )) \
    --dump runs/g21_vs_t0_box${B}${tag}.jsonl \
    --dump-actions runs/t0corpus_box${B}${tag}.jsonl \
    >> runs/g21_vs_t0_box${B}${tag}.log 2>&1 &
done
