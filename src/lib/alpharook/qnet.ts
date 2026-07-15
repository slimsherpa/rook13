// The trained AlphaRook brain, in ~40 lines: QNet is a plain MLP
// (Linear+ReLU stack), so instead of shipping onnxruntime-web we read the
// float32 weights straight from a compact dump (public/models/<gen>.bin,
// written by ml/alpharook/export_web.py) and do the matmuls here. One forward
// pass is ~660k multiplies — well under a millisecond, and there are at most
// 13 candidates per decision.
//
// Binary format (little-endian):
//   magic "RKQN" | uint32 version=1 | uint32 n_layers
//   per layer: uint32 in_dim | uint32 out_dim
//              float32[out_dim*in_dim] weight (torch [out,in] row-major)
//              float32[out_dim] bias

import { STATE_DIM, STATE_DIM_V2, ACTION_DIM } from './encoder';

export type NeuralGen = 'gen7' | 'gen8' | 'gen9' | 'gen10' | 'gen13';

interface Layer {
    inDim: number;
    outDim: number;
    w: Float32Array; // [out, in] row-major
    b: Float32Array;
}

export interface QNetWeights {
    layers: Layer[];
}

export const parseWeights = (buf: ArrayBuffer): QNetWeights => {
    const view = new DataView(buf);
    const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
    if (magic !== 'RKQN') throw new Error('not a RKQN weight file');
    const version = view.getUint32(4, true);
    if (version !== 1) throw new Error(`unsupported weight version ${version}`);
    const nLayers = view.getUint32(8, true);
    let off = 12;
    const layers: Layer[] = [];
    for (let i = 0; i < nLayers; i++) {
        const inDim = view.getUint32(off, true);
        const outDim = view.getUint32(off + 4, true);
        off += 8;
        const w = new Float32Array(buf.slice(off, off + outDim * inDim * 4));
        off += outDim * inDim * 4;
        const b = new Float32Array(buf.slice(off, off + outDim * 4));
        off += outDim * 4;
        layers.push({ inDim, outDim, w, b });
    }
    if (off !== buf.byteLength) throw new Error('trailing bytes in weight file');
    const inDim = layers[0].inDim;
    if (inDim !== STATE_DIM + ACTION_DIM && inDim !== STATE_DIM_V2 + ACTION_DIM) {
        throw new Error(`weight file expects input ${inDim}; encoders produce ${STATE_DIM + ACTION_DIM} (v1) or ${STATE_DIM_V2 + ACTION_DIM} (v2)`);
    }
    return { layers };
};

const mlpForward = (net: QNetWeights, state: Float32Array, action: Float32Array): Float32Array => {
    let x = new Float32Array(state.length + action.length);
    x.set(state);
    x.set(action, state.length);
    for (let li = 0; li < net.layers.length; li++) {
        const { inDim, outDim, w, b } = net.layers[li];
        const last = li === net.layers.length - 1;
        const y = new Float32Array(outDim);
        for (let o = 0; o < outDim; o++) {
            let acc = 0;
            const row = o * inDim;
            for (let i = 0; i < inDim; i++) acc += w[row + i] * x[i];
            acc += b[o];
            y[o] = last || acc > 0 ? acc : 0;
        }
        x = y;
    }
    return x;
};

/** q(state, action) — ReLU between layers, linear output. */
export const qForward = (net: QNetWeights, state: Float32Array, action: Float32Array): number =>
    mlpForward(net, state, action)[0];

/**
 * gen15's belief organ (public/models/gen15belief.bin): who holds each of
 * the 40 cards the observer can't see. Same RKQN MLP format, but the last
 * layer is 160 wide — logits[card*4 + cls], cls 0/1/2 = the seats one/two/
 * three to my left in play order, cls 3 = the hidden go-down. Port of
 * QNet.belief_forward (ml/alpharook/model.py).
 */
export const beliefForward = (net: QNetWeights, state: Float32Array, action: Float32Array): Float32Array =>
    mlpForward(net, state, action);

// ---------------------------------------------------------------------------
// Browser-side weight cache. Tests parse buffers directly via parseWeights;
// the app fetches /models/<gen>.bin once and keeps it for the session.
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<QNetWeights>>();

const loadBin = (file: string, label: string): Promise<QNetWeights> => {
    let p = cache.get(file);
    if (!p) {
        p = fetch(`/models/${file}`).then(async (res) => {
            if (!res.ok) throw new Error(`weights ${label}: HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            const net = parseWeights(buf);
            // proof-of-life for anyone watching the console: the trained
            // brain is in memory, not the heuristic fallback
            console.info(`🧠 AlphaRook ${label} loaded (${(buf.byteLength / 1e6).toFixed(1)}MB, ${net.layers.length} layers)`);
            return net;
        });
        // a failed fetch must not poison the session — retry on next call
        p.catch(() => cache.delete(file));
        cache.set(file, p);
    }
    return p;
};

export const loadQNet = (gen: NeuralGen): Promise<QNetWeights> =>
    loadBin(`${gen}.bin`, `${gen} brain`);

/** gen15's belief head — gen16's imagination (Q still runs on gen13.bin). */
export const loadBeliefNet = (): Promise<QNetWeights> =>
    loadBin('gen15belief.bin', 'gen15 belief organ');
