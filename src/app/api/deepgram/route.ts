import { NextResponse } from "next/server";

// Remove dynamic export for static build
// export const dynamic = "force-dynamic";

export async function GET() {
    return NextResponse.json({
      key: process.env.DEEPGRAM_API_KEY ?? "",
    });
}
