"""Export frozen champions for the browser — no onnxruntime required.

QNet is a plain MLP, so the web app runs it with a ~40-line matmul in
TypeScript (src/lib/alpharook/qnet.ts) reading a compact binary weight dump.
This script writes those dumps plus the parity fixtures that prove the
TS encoder + forward pass reproduce this training stack decision-for-decision:

  1. public/models/<gen>.bin — weights (see format below)
  2. src/lib/alpharook/__fixtures__/qnet.golden.json — random (state, action)
     vectors and their q values, for raw forward-pass parity
  3. src/lib/alpharook/__fixtures__/game.<gen>.json — one full seeded game
     where the net makes every bid/play decision at all four seats (go-down/
     trump scripted by the family heuristic, exactly how the frozen bots run
     in the browser), with per-decision candidates, q values and the choice.

Binary format (little-endian):
  magic b"RKQN" | uint32 version=1 | uint32 n_layers
  per layer: uint32 in_dim | uint32 out_dim
             float32[out_dim*in_dim] weight (torch [out,in] row-major)
             float32[out_dim] bias

    cd ml && ~/torch-env/bin/python -m alpharook.export_web
"""

from __future__ import annotations

import argparse
import json
import random
import struct
from pathlib import Path

import numpy as np
import torch

from rook.bots import next_bot_action, best_trump_suit
from rook.engine import WIDOW as PHASE_WIDOW, DEALING, REDEAL
from rook.observation import observe
from .encoder import (
    STATE_DIM, ACTION_DIM, encode_state, encode_action,
    D_BID, D_DISCARD, D_TRUMP, D_PLAY,
)
from .env import SelfPlayGame
from .model import QNet

# gen9+ champions decide everything neurally (trump intent + go-down too);
# gen7/gen8 were frozen with scripted openings and must replay that way.
FULLY_NEURAL = {"gen9"}
NEURAL_DTYPES = {
    True: (D_BID, D_DISCARD, D_TRUMP, D_PLAY),
    False: (D_BID, D_PLAY),
}

REPO = Path(__file__).resolve().parents[2]
MODELS_DIR = REPO / "ml" / "models"
OUT_BIN = REPO / "public" / "models"
OUT_FIX = REPO / "src" / "lib" / "alpharook" / "__fixtures__"


def load_net(gen: str) -> QNet:
    net = QNet()
    ck = torch.load(MODELS_DIR / f"{gen}.pt", map_location="cpu", weights_only=True)
    net.load_state_dict(ck["model"] if "model" in ck else ck)
    net.eval()
    return net


def write_bin(net: QNet, path: Path) -> None:
    linears = [m for m in net.net if isinstance(m, torch.nn.Linear)]
    buf = bytearray()
    buf += b"RKQN"
    buf += struct.pack("<II", 1, len(linears))
    for lin in linears:
        w = lin.weight.detach().numpy().astype("<f4")   # [out, in]
        b = lin.bias.detach().numpy().astype("<f4")
        out_dim, in_dim = w.shape
        buf += struct.pack("<II", in_dim, out_dim)
        buf += w.tobytes()
        buf += b.tobytes()
    path.write_bytes(bytes(buf))
    print(f"wrote {path} ({len(buf):,} bytes, {len(linears)} layers)")


@torch.no_grad()
def golden_vectors(nets: dict[str, QNet], path: Path, n: int = 8) -> None:
    rng = np.random.default_rng(13)
    s = rng.standard_normal((n, STATE_DIM)).astype(np.float32)
    a = rng.standard_normal((n, ACTION_DIM)).astype(np.float32)
    out = {
        "state_dim": STATE_DIM,
        "action_dim": ACTION_DIM,
        "states": [[float(v) for v in row] for row in s],
        "actions": [[float(v) for v in row] for row in a],
        "q": {},
    }
    for gen, net in nets.items():
        q = net(torch.from_numpy(s), torch.from_numpy(a)).numpy()
        out["q"][gen] = [float(v) for v in q]
    path.write_text(json.dumps(out))
    print(f"wrote {path}")


@torch.no_grad()
def trace_game(gen: str, net: QNet, seed: int, path: Path) -> None:
    """Full game, all four seats driven exactly like the browser bots:
    neural bids and card play, scripted go-down + trump intent."""
    rng = random.Random(seed)
    decks: list[list[int]] = []

    def deck_fn(_i: int) -> list[int]:
        deck = list(range(40))
        rng.shuffle(deck)
        decks.append(list(deck))
        return deck

    dealer = rng.randrange(4)
    env = SelfPlayGame(seed, deck_fn=deck_fn, dealer=dealer)
    bot_rng = random.Random(seed ^ 0x5EED)
    styles = ["basic"] * 4
    pending_gd: list[int] = []
    steps: list[dict] = []

    neural_dtypes = NEURAL_DTYPES[gen in FULLY_NEURAL]
    while not env.done:
        seat, dtype, cands = env.decision()
        if dtype in neural_dtypes:
            s = encode_state(observe(env.g, seat), env.picks, dtype, env.g,
                             env.trump_intent)
            S = torch.from_numpy(np.stack([s] * len(cands)))
            A = torch.from_numpy(np.stack([encode_action(dtype, c) for c in cands]))
            q = net(S, A)
            action = cands[int(torch.argmax(q).item())]
            steps.append({"seat": seat, "dtype": dtype, "cands": list(cands),
                          "q": [float(v) for v in q], "chosen": action,
                          "neural": True})
        elif env.g.phase == PHASE_WIDOW and env.trump_intent is None:
            action = best_trump_suit(env.g.hands[seat])   # scripted intent
            steps.append({"seat": seat, "dtype": dtype, "cands": list(cands),
                          "chosen": action, "neural": False})
        else:  # scripted go-down, fed to the env card by card
            if not pending_gd:
                _, _, cards = next_bot_action(env.g, styles, bot_rng)
                pending_gd = list(cards)
            action = pending_gd.pop(0)
            steps.append({"seat": seat, "dtype": dtype, "cands": list(cands),
                          "chosen": action, "neural": False})
        env.apply(action)

    out = {
        "gen": gen,
        "seed": seed,
        "dealer": dealer,
        "decks": decks,
        "steps": steps,
        "finalScores": list(env.g.scores),
        "handsPlayed": len(env.g.hand_history),
    }
    path.write_text(json.dumps(out))
    print(f"wrote {path} ({len(steps)} decisions, {len(decks)} deals, "
          f"final scores {env.g.scores})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gens", nargs="+", default=["gen7", "gen8", "gen9"])
    args = ap.parse_args()

    OUT_BIN.mkdir(parents=True, exist_ok=True)
    OUT_FIX.mkdir(parents=True, exist_ok=True)

    nets = {gen: load_net(gen) for gen in args.gens}
    for gen, net in nets.items():
        write_bin(net, OUT_BIN / f"{gen}.bin")
    golden_vectors(nets, OUT_FIX / "qnet.golden.json")
    for i, (gen, net) in enumerate(nets.items()):
        trace_game(gen, net, seed=13 + i, path=OUT_FIX / f"game.{gen}.json")


if __name__ == "__main__":
    main()
