# R1 `shortlist_regret` — is the top-6 menu too small?

**Ran 2026-08-09 morning, 4 box-shards. Verdict: `dead` — pre-registered
kill line hit on every shard. The candidate menu is not the wall.**

Method: replayed 6,134 early-trick (0–2) searched decisions from the belief
soak corpus. Referee = BEST LEGAL MORTAL: same bel15 worlds, same C solver,
same family-points utility, but ALL legal candidates (k_sel=48 shared
worlds, CRN); an outside-the-menu winner must CONFIRM its gain on 16 fresh
worlds past τ=2.0 (Law 2's winner's-curse guard). God referee = one exact
true-deal solve, reported separately.

## Verdict numbers

- Per-shard recoverable edge: **0.26 / 0.28 / 0.31 / 0.34 pts/hand** —
  all under the pre-registered 0.5 kill line. God upper bounds:
  0.33–0.44 pts/hand. Dead both ways.
- Pooled: 2.5% of decisions have a confirmed outside-the-menu winner
  (mean gain ~+19 family pts when they do); god finds 15.5% nominal
  exclusions but at trivial mean cost — reflex's top-6 almost always
  contains a card within noise of optimal.

## Breakdown (exclusion% / mean confirmed gain)

| | trick 0 | trick 1 | trick 2 |
|---|---|---|---|
| declarer | 3.9% / +18 | 1.3% / +15 | 0.6% / +21 |
| defender | **6.6% / +19** | 2.8% / +26 | 1.9% / +22 |

The one honest asterisk: **defensive opening leads** run ~3× the average
exclusion rate — the reviewer's pre-registered prediction ("shortlist small
overall, possibly surprising on opening leads") was correct in direction.
Still far below a build threshold in pts/hand; noted as context for the
defense ladder (R2), not as a Phase-2 path.

Consequence: no adaptive-shortlist build. Search engineering budget goes
elsewhere; the imagination wall (contamination report: ~+30/hand) dwarfs
this by two orders of magnitude.

Files: `runs/r1/r1_box{1,2,4,5}_w*.jsonl` + logs. Harness:
`alpharook/r1_shortlist.py` (kept for reuse — the replay+referee pattern is
R2's starting point).
