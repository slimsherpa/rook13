// Laboratory pick sink — LOCAL ONLY. Appends one JSONL row per graded
// hand under ml/runs/lab/, where the replay-scoring mill
// (ml/alpharook/lab_score.py) picks them up. The page also keeps a full
// localStorage backup, so a failed write never loses work.

import { NextRequest, NextResponse } from 'next/server';
import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

export async function POST(req: NextRequest) {
    try {
        const row = await req.json();
        if (row?.game !== 'widow' || typeof row?.seed !== 'number') {
            return NextResponse.json({ ok: false, error: 'bad payload' }, { status: 400 });
        }
        const dir = path.join(process.cwd(), 'ml', 'runs', 'lab');
        await mkdir(dir, { recursive: true });
        await appendFile(path.join(dir, 'widow_picks.jsonl'),
            JSON.stringify(row) + '\n');
        return NextResponse.json({ ok: true });
    } catch (e) {
        return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
}
