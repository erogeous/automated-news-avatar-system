import { creatorVoice } from "../../../lib/creator-provider";
import { synthesizeCantoneseSpeech } from "../../../lib/openiapi";

const ALLOWED_VOICES = new Set(["male-qn-qingse", "female-shaonv"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { mode?: unknown; text?: unknown; voiceId?: unknown; speed?: unknown };
    if (typeof body.text !== "string" || body.text.trim().length < 100) {
      return Response.json({ error: "完整配音稿不能少于 100 个字" }, { status: 400 });
    }
    const profile = body.mode === "creator" ? await creatorVoice(body.voiceId) : null;
    if (!profile && (typeof body.voiceId !== "string" || !ALLOWED_VOICES.has(body.voiceId))) {
      return Response.json({ error: "不支持所选音色" }, { status: 400 });
    }

    const result = await synthesizeCantoneseSpeech({
      text: body.text,
      voiceId: profile?.voiceId || String(body.voiceId),
      language: profile ? "mandarin" : "cantonese",
      speed: profile?.speed ?? (typeof body.speed === "number" ? body.speed : undefined),
    });
    return new Response(result.audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(result.audio.byteLength),
        "Cache-Control": "no-store",
        "X-Audio-Duration-Ms": String(result.durationMs),
        "X-Usage-Characters": String(result.characters),
        "X-TTS-Model": result.model,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "完整粤语配音生成失败" },
      { status: 502 },
    );
  }
}
