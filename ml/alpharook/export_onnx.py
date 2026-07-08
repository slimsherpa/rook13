"""Export a checkpoint to ONNX — the format that runs in the browser via
onnxruntime-web, so a frozen AlphaRook brain can sit at the family table
without a Python server.

Verifies numerical parity between torch and onnxruntime before saving.

    python -m alpharook.export_onnx --ckpt models/gen7.pt --out models/gen7.onnx
"""

from __future__ import annotations

import argparse

import numpy as np
import torch

from .encoder import STATE_DIM, ACTION_DIM
from .model import QNet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    net = QNet()
    ck = torch.load(args.ckpt, map_location="cpu", weights_only=True)
    net.load_state_dict(ck["model"] if "model" in ck else ck)
    net.eval()

    state = torch.randn(3, STATE_DIM)
    action = torch.randn(3, ACTION_DIM)
    torch.onnx.export(
        net, (state, action), args.out,
        input_names=["state", "action"], output_names=["q"],
        dynamic_axes={"state": {0: "batch"}, "action": {0: "batch"},
                      "q": {0: "batch"}},
        opset_version=17, dynamo=False,
    )

    import onnxruntime as ort
    sess = ort.InferenceSession(args.out)
    s = np.random.randn(64, STATE_DIM).astype(np.float32)
    a = np.random.randn(64, ACTION_DIM).astype(np.float32)
    with torch.no_grad():
        want = net(torch.from_numpy(s), torch.from_numpy(a)).numpy()
    got = sess.run(["q"], {"state": s, "action": a})[0]
    err = float(np.abs(want - got).max())
    rel = err / max(1e-9, float(np.abs(want).max()))
    # float32 op-reorder noise; what matters is the argmax ranking
    assert rel < 1e-3, f"onnx/torch mismatch: abs {err}, rel {rel}"
    agree = (want.reshape(8, 8).argmax(1) == got.reshape(8, 8).argmax(1)).all()
    assert agree, "onnx/torch argmax disagreement"
    print(f"exported {args.out} (max err {err:.2e} abs / {rel:.2e} rel, "
          f"argmax identical)")


if __name__ == "__main__":
    main()
