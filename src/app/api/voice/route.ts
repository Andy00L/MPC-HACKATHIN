/**
 * app/api/voice/route.ts
 * POST /api/voice  ->  ElevenLabs text-to-speech proxy. Hides the ElevenLabs key and
 * streams audio back. Body: { text: string }. Returns audio/mpeg.
 * Verified: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}, header
 * xi-api-key, body { text, model_id, voice_settings }. eleven_flash_v2_5 is the
 * low-latency model, which matters for the render-first voice sync.
 */

import { NextRequest, NextResponse } from "next/server";

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const API_KEY = process.env.ELEVENLABS_API_KEY;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const text = body?.text;

    if (typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "Text is required." }, { status: 400 });
    }
    if (!VOICE_ID || !API_KEY) {
      return NextResponse.json({ error: "Voice is not configured." }, { status: 500 });
    }

    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!upstream.ok || !upstream.body) {
      console.error("ElevenLabs request failed", upstream.status);
      return NextResponse.json({ error: "Voice generation failed." }, { status: 502 });
    }

    // Stream the audio straight back to the browser. The key never leaves the server.
    return new Response(upstream.body, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("POST /api/voice failed", err);
    return NextResponse.json({ error: "Voice generation failed." }, { status: 502 });
  }
}
