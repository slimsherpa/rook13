"""Mini-game mill — "Beat the Bot" situation banks for the app.

Unlike lab_mill (which replays recorded soak games), this generates
FRESH deterministic self-play: Gen26 reflex drives a game from a seed to
a target hand, then the production-grade searchers answer the two
mini-game questions at a pinned world count:

  godown  — the buyer's 13 (dealt 9 + widow 4): MortalWidowAgent prices
            the (burial, trump) shortlist over exactly K shared belief
            worlds and banks the full ranked menu (cand_means).
  lead    — trick 1, after the bot's own burial is applied: the anytime
            searcher prices EVERY legal opening lead over exactly K
            worlds (no CAND_CAP truncation) and banks per-card means, so
            the app can grade any human pick, not just the bot's.

Both banks come from the same seeds (one godown + one lead item per
seed). Item id == seed, so banks can GROW by appending later batches
without invalidating anyone's saved progress. Lead items are balanced
across the four buyer-relative seats, same as the Laboratory.

    ~/torch-env/bin/python -m alpharook.minigame_mill \
        --n 320 --k 200 --workers 10 \
        --out-godown ../public/minigames/godown_items.json \
        --out-lead   ../public/minigames/lead_items.json

Values are family hand-points (hand_value currency), rounded to 0.1.
Everything replays exactly from (seed, k): decision seeds derive from
public state (anytime.decision_seed), worlds are node-budgeted.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time

BASE_SEED = 26_000_000   # gen26-era block; lab banks live in other ranges

# per-process globals (spawn pool initializer)
_NET = None
_AG_LEAD = None
_AG_WIDOW = None
_K = None


def _init_worker(k_widow: int, k_lead: int, net_path: str, belief_path: str,
                 belief_temp: float):
    global _NET, _AG_LEAD, _AG_WIDOW, _K
    import torch
    torch.set_num_threads(1)
    from .anytime import AnytimeRookAgent
    from .beliefs import BeliefOracle
    from .model import load_qnet
    from .mortalwidow import MortalWidowAgent
    _NET = load_qnet(net_path)
    _NET.eval()
    belief = BeliefOracle(belief_path, temp=belief_temp)
    # lead: forced-K replay, so clock params are irrelevant; k_max bounds
    # the attempt budget (k_max*2+16 world discards allowed)
    _AG_LEAD = AnytimeRookAgent(_NET, belief, k_max=k_lead,
                                prior_scale=48.0, seed=0)
    # widow: pin the world count — with k_min == k_max the early-stop
    # check can never fire (it only runs at k >= k_min, and the loop
    # exits at k == k_max), and budget_s=1e9 removes the clock: exactly
    # K shared worlds price every shortlisted burial
    _AG_WIDOW = MortalWidowAgent(_NET, belief, budget_s=1e9,
                                 k_min=k_widow, k_max=k_widow,
                                 world_nodes=16_000_000, seed=0)
    _K = (k_widow, k_lead)


def _mill_seed(seed: int):
    """One seed -> (godown_item | None, lead_item | None, secs)."""
    import torch
    from .arena import model_choose
    from .duel import deck_stream
    from .encoder import D_BID, D_DISCARD, D_PLAY, D_TRUMP
    from .env import SelfPlayGame

    t0 = time.time()
    k_widow, k_lead = _K
    rng = random.Random(seed)
    target_hand = rng.randrange(0, 6)
    env = SelfPlayGame(seed=seed, deck_fn=deck_stream(seed),
                       dealer=seed % 4)
    godown_item = None
    lead_item = None
    widow_before: list[int] | None = None
    with torch.no_grad():
        while not env.done:
            seat, dtype, cands = env.decision()
            g = env.g
            if dtype == D_BID:
                widow_before = sorted(g.widow)

            # --- capture 1: the widow decision on the target hand ------
            if (godown_item is None and dtype == D_TRUMP
                    and env.trump_intent is None and g.bid_winner is not None
                    and g.hand_number >= target_hand
                    and len(g.hands[g.bid_winner]) == 13 and widow_before):
                b = g.bid_winner
                hand13 = sorted(g.hands[b])
                dealt9 = [c for c in hand13 if c not in widow_before]
                t = b % 2
                dealer = g.dealer
                (disc, trump) = _AG_WIDOW._widow_search(env, b)
                lw = _AG_WIDOW.last_widow
                cand_means = [cm for cm in lw["cand_means"]
                              if cm[2] is not None]
                cand_means.sort(key=lambda cm: -cm[2])
                godown_item = dict(
                    id=seed, seed=seed, hand=int(g.hand_number), buyer=int(b),
                    dealt=dealt9, widow=list(widow_before),
                    bid=int(g.high_bid),
                    scores=[int(g.scores[t]), int(g.scores[1 - t])],
                    dealerRel=(dealer - b) % 4,
                    leaderRel=((dealer + 1) - b) % 4,
                    k=int(lw["k"]),
                    bot=dict(trump=int(trump), godown=sorted(disc),
                             overrode=int(lw["overrode"]),
                             incumbent=dict(
                                 godown=sorted(lw["incumbent"][0]),
                                 trump=int(lw["incumbent"][1])),
                             cands=[[sorted(cm[0]), int(cm[1]),
                                     round(cm[2], 1)] for cm in cand_means]))
                # play the searched answer so trick 1 is conditioned on it
                env.apply(int(trump))
                for c in sorted(disc):
                    s2, d2, c2 = env.decision()
                    assert d2 == D_DISCARD
                    env.apply(int(c))
                continue

            # --- capture 2: the opening lead of that same hand ---------
            if (godown_item is not None and lead_item is None
                    and dtype == D_PLAY
                    and g.hand_number == godown_item["hand"]
                    and len(g.completed_tricks) == 0
                    and len(g.trick_plays) == 0 and len(cands) > 1):
                use = sorted(cands)
                _, qmap = _AG_LEAD._reflex_q(env, seat, dtype, use)
                pick, kk, ke, tos, stop, means = _AG_LEAD._think(
                    env, seat, use, qmap, deadline=float("inf"),
                    replay_k=k_lead)
                t = seat % 2
                lead_item = dict(
                    id=seed, seed=seed, hand=int(g.hand_number),
                    seat=int(seat), cards=sorted(g.hands[seat]),
                    trump=int(g.trump), bid=int(g.high_bid),
                    buyerRel=(g.bid_winner - seat) % 4,
                    declarer=int((g.bid_winner % 2) == (seat % 2)),
                    scores=[int(g.scores[t]), int(g.scores[1 - t])],
                    k=int(kk),
                    bot=dict(card=int(pick),
                             values={str(c): round(means[c], 1)
                                     for c in use if c in means}))
                break

            env.apply(cands[0] if len(cands) == 1 else
                      model_choose(_NET, "cpu", env, seat, dtype, cands))
    return godown_item, lead_item, round(time.time() - t0, 1)


def _mill_seed_safe(seed: int):
    try:
        return seed, _mill_seed(seed)
    except Exception as e:  # noqa: BLE001 — a bad seed must not kill the run
        return seed, (None, None, f"error: {e!r}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=320,
                    help="target godown items (lead balances n//4 per seat)")
    ap.add_argument("--k", type=int, default=200)
    ap.add_argument("--k-lead", type=int, default=None,
                    help="override lead K (default: --k)")
    ap.add_argument("--seed0", type=int, default=BASE_SEED,
                    help="first seed; later batches continue where a "
                         "previous run left off (see --append)")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--net", default="models/gen26.pt")
    ap.add_argument("--belief", default="runs/gen15/best_duel.pt")
    ap.add_argument("--belief-temp", type=float, default=0.5)
    ap.add_argument("--out-godown", required=True)
    ap.add_argument("--out-lead", required=True)
    ap.add_argument("--append", action="store_true",
                    help="load existing banks, skip their seeds, extend")
    ap.add_argument("--smoke", action="store_true",
                    help="tiny run: n=2, k=8, workers=2")
    args = ap.parse_args()
    if args.smoke:
        args.n, args.k, args.workers = 2, 8, 2
    k_lead = args.k_lead if args.k_lead is not None else args.k

    def load_bank(path):
        if args.append and os.path.exists(path):
            bank = json.load(open(path))
            return bank if isinstance(bank, dict) else \
                dict(meta={}, items=bank)
        return dict(meta={}, items=[])

    gd_bank = load_bank(args.out_godown)
    ld_bank = load_bank(args.out_lead)
    done_seeds = {it["seed"] for it in gd_bank["items"]}
    done_seeds |= {it["seed"] for it in ld_bank["items"]}
    seed0 = max([args.seed0 - 1, *done_seeds]) + 1

    want_gd = args.n
    want_ld_per_seat = max(1, args.n // 4)
    ld_buckets = {r: sum(1 for it in ld_bank["items"] if it["buyerRel"] == r)
                  for r in range(4)}

    stamp = time.strftime("%Y-%m-%d")

    def write_banks():
        for bank, k, path in ((gd_bank, args.k, args.out_godown),
                              (ld_bank, k_lead, args.out_lead)):
            bank["items"].sort(key=lambda it: it["seed"])
            bank["meta"] = dict(gen="gen26-daydream", k=k, updated=stamp,
                                count=len(bank["items"]))
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(bank, f)
            os.replace(tmp, path)

    import multiprocessing as mp
    t0 = time.time()
    n_new_gd = n_new_ld = 0
    with mp.get_context("spawn").Pool(
            args.workers, initializer=_init_worker,
            initargs=(args.k, k_lead, args.net, args.belief,
                      args.belief_temp)) as pool:
        # stream seeds until quotas fill; imap keeps all workers busy
        def seeds():
            s = seed0
            while True:
                yield s
                s += 1
        for seed, (gd, ld, secs) in pool.imap_unordered(
                _mill_seed_safe, seeds(), chunksize=1):
            if isinstance(secs, str):
                print(f"  seed {seed}: {secs}", flush=True)
                continue
            if gd is not None and len(gd_bank["items"]) < want_gd:
                gd_bank["items"].append(gd)
                n_new_gd += 1
            if ld is not None:
                r = ld["buyerRel"]
                if ld_buckets[r] < want_ld_per_seat:
                    ld_bank["items"].append(ld)
                    ld_buckets[r] += 1
                    n_new_ld += 1
            gd_full = len(gd_bank["items"]) >= want_gd
            ld_full = all(v >= want_ld_per_seat for v in ld_buckets.values())
            n_done = n_new_gd + n_new_ld
            if n_done and n_done % 8 == 0:
                # checkpoint: a killed run keeps everything finished so
                # far, and --append resumes past the banked seeds
                write_banks()
                el = time.time() - t0
                print(f"  godown {len(gd_bank['items'])}/{want_gd} · lead "
                      f"{sum(ld_buckets.values())}/{want_ld_per_seat * 4} · "
                      f"{el / 60:.1f} min · seed {seed} ({secs}s)",
                      flush=True)
            if gd_full and ld_full:
                pool.terminate()
                break

    write_banks()
    print(f"godown {len(gd_bank['items'])} -> {args.out_godown}")
    print(f"lead   {len(ld_bank['items'])} -> {args.out_lead}")
    print(f"total {((time.time() - t0) / 60):.1f} min")


if __name__ == "__main__":
    main()
