// First Card Player pick sink — LOCAL ONLY. Same pattern as the widow
// sink: one JSONL row per graded lead under ml/runs/lab/, consumed by the
// replay scorer (human leads trick 1, frozen bot plays the rest).

import { NextRequest, NextResponse } from 'next/server';
import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

export async function POST(req: NextRequest) {
    try {
        const row = await req.json();
        if (row?.game !== 'firstcard' || typeof row?.seed !== 'number') {
            return NextResponse.json({ ok: false, error: 'bad payload' }, { status: 400 });
        }
        const dir = path.join(process.cwd(), 'ml', 'runs', 'lab');
        await mkdir(dir, { recursive: true });
        await appendFile(path.join(dir, 'firstcard_picks.jsonl'),
            JSON.stringify(row) + '\n');
        return NextResponse.json({ ok: true });
    } catch (e) {
        return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
}
