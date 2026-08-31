import { randomUUID } from "node:crypto";

const HEYGEN_API_BASE = process.env.HEYGEN_API_BASE_URL || "https://api.heygen.com";

function apiKey() {
  const value = process.env.HEYGEN_API_KEY?.trim();
  if (!value) throw new Error("HeyGen API Key 尚未配置");
  return value;
}

function providerHeaders() {
  const direct = new URL(HEYGEN_API_BASE).hostname === "api.heygen.com";
  return direct ? { "X-Api-Key": apiKey() } : { Authorization: `Bearer ${apiKey()}` };
}

function publicUrl(value: string, kind: "app" | "media") {
  if (/^https:\/\//i.test(value)) return value;
  const base = kind === "app" ? process.env.PUBLIC_APP_BASE_URL : process.env.PUBLIC_MEDIA_BASE_URL;
  if (!base) throw new Error(`${kind === "app" ? "主播图片" : "音频"}目前只有本机地址，请先配置公网 HTTPS 地址`);
  const source = new URL(value, kind === "app" ? "http://localhost" : "http://127.0.0.1:3101");
  return new URL(`${source.pathname}${source.search}`, `${base.replace(/\/+$/, "")}/`).toString();
}

type HeyGenCreateResponse = { data?: { video_id?: string; status?: string }; error?: { code?: string; message?: string } | string; message?: string };

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const imageValue = form.get("image_url");
    const audioValue = form.get("audio_url");
    const layout = form.get("layout") === "portrait" ? "9:16" : "16:9";
    if (typeof imageValue !== "string" || typeof audioValue !== "string") return Response.json({ error: "缺少主播图片或驱动音频地址" }, { status: 400 });

    const response = await fetch(`${HEYGEN_API_BASE}/v3/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...providerHeaders(), "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        type: "image",
        image: { type: "url", url: publicUrl(imageValue, "app") },
        audio_url: publicUrl(audioValue, "media"),
        title: `香港新闻主播-${new Date().toISOString()}`,
        resolution: process.env.HEYGEN_RESOLUTION || "1080p",
        aspect_ratio: layout,
        output_format: "mp4",
        expressiveness: "low",
        motion_prompt: "Professional Hong Kong news anchor, facing camera, calm expression, restrained natural gestures, accurate lip sync.",
      }),
    });
    const text = await response.text();
    let payload: HeyGenCreateResponse = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`HeyGen 返回异常（HTTP ${response.status}）`); }
    const errorMessage = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok || !payload.data?.video_id) throw new Error(errorMessage || payload.message || `HeyGen 提交失败（HTTP ${response.status}）`);
    return Response.json({ id: `heygen_${payload.data.video_id}`, provider: "heygen", status: "queued", progress: 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "HeyGen 数字人任务提交失败" }, { status: 502 });
  }
}
