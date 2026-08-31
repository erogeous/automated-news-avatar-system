import { synthesizeCantoneseSpeech } from "../../../lib/openiapi";

const ALLOWED_VOICES = new Set(["male-qn-qingse", "female-shaonv"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: unknown; voiceId?: unknown; speed?: unknown };
    if (typeof body.text !== "string" || body.text.trim().length < 100) {
      return Response.json({ error: "完整配音稿不能少于 100 个字" }, { status: 400 });
    }
    if (typeof body.voiceId !== "string" || !ALLOWED_VOICES.has(body.voiceId)) {
      return Response.json({ error: "不支持所选音色" }, { status: 400 });
    }

    const result = await synthesizeCantoneseSpeech({
      text: body.text,
      voiceId: body.voiceId,
      speed: typeof body.speed === "number" ? body.speed : 1,
    });
    return new Response(result.audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(result.audio.byteLength),
        "Cache-Control": "no-store",
        "X-Audio-Duration-Ms": String(result.durationMs),
        "X-Usage-Characters": String(result.characters),
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "完整粤语配音生成失败" },
      { status: 502 },
    );
  }
}
