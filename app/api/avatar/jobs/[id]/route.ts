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

type HeyGenVideoResponse = {
  data?: { id?: string; video_id?: string; status?: string; video_url?: string; url?: string; duration?: number; error?: { message?: string } | string; failure_message?: string; failure_reason?: string };
  error?: { message?: string } | string;
  message?: string;
};

async function queryTask(videoId: string) {
  const response = await fetch(`${HEYGEN_API_BASE}/v3/videos/${encodeURIComponent(videoId)}`, { headers: providerHeaders(), cache: "no-store" });
  const text = await response.text();
  let payload: HeyGenVideoResponse = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`HeyGen 查询返回异常（HTTP ${response.status}）`); }
  const topError = typeof payload.error === "string" ? payload.error : payload.error?.message;
  if (!response.ok || !payload.data) throw new Error(topError || payload.message || `HeyGen 查询失败（HTTP ${response.status}）`);
  const data = payload.data;
  const raw = String(data.status || "").toLowerCase();
  const status = ["completed", "success", "succeeded", "done"].includes(raw) ? "completed" : ["failed", "error"].includes(raw) ? "failed" : ["processing", "running", "rendering"].includes(raw) ? "running" : "queued";
  const dataError = typeof data.error === "string" ? data.error : data.error?.message;
  return { id: `heygen_${videoId}`, provider: "heygen", status, progress: status === "completed" ? 100 : status === "running" ? 50 : 0,
    video_url: data.video_url || data.url || "", duration: data.duration || 0,
    error: status === "failed" ? (dataError || data.failure_message || data.failure_reason || "HeyGen 生成失败") : "" };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id.startsWith("heygen_")) return Response.json({ error: "不支持的旧版数字人任务" }, { status: 400 });
    const videoId = id.slice(7);
    if (!/^[A-Za-z0-9_-]{6,160}$/.test(videoId)) return Response.json({ error: "HeyGen 任务编号无效" }, { status: 400 });
    return Response.json(await queryTask(videoId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "HeyGen 任务查询失败" }, { status: 502 });
  }
}
