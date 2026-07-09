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

import { STATE_DIM, ACTION_DIM } from './encoder';

export type NeuralGen = 'gen7' | 'gen8';

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
    if (layers[0].inDim !== STATE_DIM + ACTION_DIM) {
        throw new Error(`weight file expects input ${layers[0].inDim}, encoder produces ${STATE_DIM + ACTION_DIM}`);
    }
    return { layers };
};

/** q(state, action) — ReLU between layers, linear output. */
export const qForward = (net: QNetWeights, state: Float32Array, action: Float32Array): number => {
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
    return x[0];
};

// ---------------------------------------------------------------------------
// Browser-side weight cache. Tests parse buffers directly via parseWeights;
// the app fetches /models/<gen>.bin once and keeps it for the session.
// ---------------------------------------------------------------------------

const cache = new Map<NeuralGen, Promise<QNetWeights>>();

export const loadQNet = (gen: NeuralGen): Promise<QNetWeights> => {
    let p = cache.get(gen);
    if (!p) {
        p = fetch(`/models/${gen}.bin`).then(async (res) => {
            if (!res.ok) throw new Error(`weights ${gen}: HTTP ${res.status}`);
            return parseWeights(await res.arrayBuffer());
        });
        // a failed fetch must not poison the session — retry on next call
        p.catch(() => cache.delete(gen));
        cache.set(gen, p);
    }
    return p;
};
