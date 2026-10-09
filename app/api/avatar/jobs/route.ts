import { createHash, randomUUID } from "node:crypto";

const HEYGEN_API_BASE = process.env.HEYGEN_API_BASE_URL || "https://api.heygen.com";
const HEYGEN_UPLOAD_BASE = process.env.HEYGEN_UPLOAD_BASE_URL || "https://upload.heygen.com";
const MAX_ASSET_BYTES = 50 * 1024 * 1024;

function apiKey() {
  const value = process.env.HEYGEN_API_KEY?.trim();
  if (!value) throw new Error("HeyGen API Key 尚未配置");
  return value;
}

function providerHeaders(): Record<string, string> {
  const direct = new URL(HEYGEN_API_BASE).hostname === "api.heygen.com";
  return direct ? { "X-Api-Key": apiKey() } : { Authorization: `Bearer ${apiKey()}` };
}

async function localizeVideo(videoId: string, sliceIndex: string, sourceUrl: string) {
  const service = `http://127.0.0.1:${process.env.MEDIA_SERVICE_PORT || 3101}`;
  const response = await fetch(`${service}/avatar-outputs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: videoId, slice_id: `slice-${sliceIndex}`, source_url: sourceUrl }),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await response.json() as { url?: string; error?: string };
  if (!response.ok || !payload.url) throw new Error(payload.error || "HeyGen 历史视频保存到本地失败");
  return `/api/media${payload.url}`;
}

async function formAsset(value: FormDataEntryValue | null, kind: "image" | "audio") {
  if (!(value instanceof File)) throw new Error(`缺少${kind === "image" ? "主播图片" : "驱动音频"}文件`);
  const bytes = await value.arrayBuffer();
  if (!bytes.byteLength) throw new Error(`${kind === "image" ? "主播图片" : "音频"}文件为空`);
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error(`${kind === "image" ? "主播图片" : "音频"}超过 50MB 上传上限`);
  return { bytes, contentType: value.type || (kind === "image" ? "image/jpeg" : "audio/mpeg") };
}

async function uploadAsset(asset: { bytes: ArrayBuffer; contentType: string }, label: string) {
  const direct = new URL(HEYGEN_UPLOAD_BASE).hostname === "upload.heygen.com";
  const authHeaders: Record<string, string> = direct ? { "X-Api-Key": apiKey() } : { Authorization: `Bearer ${apiKey()}` };
  const response = await fetch(`${HEYGEN_UPLOAD_BASE.replace(/\/+$/, "")}/v1/asset`, { method: "POST", headers: { ...authHeaders, "Content-Type": asset.contentType }, body: asset.bytes, signal: AbortSignal.timeout(120_000) });
  const text = await response.text();
  let payload: { data?: { url?: string }; error?: { message?: string } | string; message?: string } = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`${label}上传服务返回异常（HTTP ${response.status}）`); }
  const errorMessage = typeof payload.error === "string" ? payload.error : payload.error?.message;
  if (!response.ok || !payload.data?.url) throw new Error(errorMessage || payload.message || `${label}上传 HeyGen 失败（HTTP ${response.status}）`);
  return payload.data.url;
}

async function stage<T>(label: string, operation: () => Promise<T>) {
  try { return await operation(); }
  catch (error) { throw new Error(`${label}阶段失败：${error instanceof Error ? error.message : "未知错误"}`); }
}

type HeyGenCreateResponse = { data?: { video_id?: string; status?: string }; error?: { code?: string; message?: string } | string; message?: string };

type HeyGenListResponse = { data?: { videos?: Array<{ id?: string; video_id?: string; title?: string; video_title?: string; status?: string }> }; error?: { message?: string } | string; message?: string };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const anchor = params.get("anchor")?.slice(0, 30) || "";
    const project = params.get("project") || "";
    if (project && !/^[a-f0-9]{32}$/.test(project)) return Response.json({ error: "音频项目编号无效" }, { status: 400 });
    const projectTag = project.slice(0, 12);
    const response = await fetch(`${HEYGEN_API_BASE}/v3/videos`, { headers: providerHeaders(), cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const payload = await response.json() as HeyGenListResponse;
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || payload.message || `HeyGen 列表查询失败（HTTP ${response.status}）`);
    const recent = (payload.data?.videos || []).filter((item) => {
      const title = item.title || item.video_title || "";
      return item.status === "completed" && /slice-\d{3}/i.test(title) && (!anchor || title.includes(anchor))
        && (!projectTag || title.includes(`-${projectTag}-slice-`));
    }).slice(0, 30);
    const jobs = await Promise.all(recent.map(async (item) => {
      const id = item.id || item.video_id || "";
      const detailResponse = await fetch(`${HEYGEN_API_BASE}/v3/videos/${encodeURIComponent(id)}`, { headers: providerHeaders(), cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const detail = await detailResponse.json() as { data?: { video_url?: string; url?: string } };
      const title = item.title || item.video_title || "";
      const sliceIndex = title.match(/slice-(\d{3})/i)?.[1] || "000";
      const remoteUrl = detail.data?.video_url || detail.data?.url || "";
      const videoUrl = remoteUrl ? await localizeVideo(id, sliceIndex, remoteUrl) : "";
      return { id: `heygen_${id}__slice-${sliceIndex}`, title, status: item.status, video_url: videoUrl };
    }));
    return Response.json({ jobs: jobs.filter((item) => item.id && item.video_url) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "HeyGen 已完成任务读取失败" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    let form: FormData;
    let idempotencyKey: string = randomUUID();
    if (request.headers.get("content-type")?.includes("application/json")) {
      const input = await request.json() as Record<string, unknown>;
      if (!["male", "female"].includes(String(input.anchor_id)) || !["portrait", "landscape"].includes(String(input.layout))
        || typeof input.audio_job_id !== "string" || !/^[a-f0-9]{32}$/.test(input.audio_job_id)
        || typeof input.slice_id !== "string" || !/^slice-\d{3}$/.test(input.slice_id)) {
        return Response.json({ error: "主播或音频切片编号无效" }, { status: 400 });
      }
      const service = `http://127.0.0.1:${process.env.MEDIA_SERVICE_PORT || 3101}`;
      const imageName = `hk-${input.anchor_id}-anchor-${input.layout === "landscape" ? "greenscreen-16x9-v2.png" : "render.jpg"}`;
      const assets = await stage("读取本地素材", () => Promise.all([
        fetch(`${service}/anchors/${imageName}`),
        fetch(`${service}/audio/${input.audio_job_id}/${input.slice_id}.mp3`),
      ]));
      if (assets.some((response) => !response.ok)) throw new Error("本地主播图片或切片不存在，请检查素材服务并重新切片");
      if (assets.some((response) => Number(response.headers.get("content-length")) > MAX_ASSET_BYTES)) throw new Error("本地素材超过 50MB 上传上限");
      const [image, audio] = await Promise.all(assets.map((response) => response.blob()));
      form = new FormData();
      form.set("image_file", new File([image], imageName, { type: image.type }));
      form.set("audio_file", new File([audio], `${input.slice_id}.mp3`, { type: "audio/mpeg" }));
      form.set("slice_index", input.slice_id.slice(6));
      form.set("anchor_name", input.anchor_id === "male" ? "梁正言" : "林嘉晴");
      form.set("layout", String(input.layout));
      form.set("motion_prompt", typeof input.motion_prompt === "string" ? input.motion_prompt : "");
      form.set("project_ref", String(input.audio_job_id));
      const attempt = Number.isInteger(input.attempt) && Number(input.attempt) >= 0 && Number(input.attempt) <= 20 ? Number(input.attempt) : 0;
      idempotencyKey = `news-${createHash("sha256").update(JSON.stringify({
        audio: input.audio_job_id, slice: input.slice_id, anchor: input.anchor_id,
        layout: input.layout, motion: typeof input.motion_prompt === "string" ? input.motion_prompt : "", attempt,
      })).digest("hex").slice(0, 48)}`;
    } else {
      form = await request.formData();
    }
    const imageFile = form.get("image_file");
    const audioFile = form.get("audio_file");
    const layout = form.get("layout") === "portrait" ? "9:16" : "16:9";
    const anchorName = typeof form.get("anchor_name") === "string" ? String(form.get("anchor_name")).slice(0, 30) : "香港新闻主播";
    const sliceIndex = typeof form.get("slice_index") === "string" ? String(form.get("slice_index")).replace(/\D/g, "").slice(0, 3) : "000";
    const requestedMotion = typeof form.get("motion_prompt") === "string" ? String(form.get("motion_prompt")).trim().slice(0, 800) : "";
    const projectRefValue = typeof form.get("project_ref") === "string" ? String(form.get("project_ref")) : "";
    const projectTag = /^[a-f0-9]{32}$/.test(projectRefValue) ? projectRefValue.slice(0, 12) : "";
    const [imageAsset, audioAsset] = await stage("读取本地素材", () => Promise.all([formAsset(imageFile, "image"), formAsset(audioFile, "audio")]));
    const [imageUrl, audioUrl] = await stage("上传 HeyGen 素材", () => Promise.all([uploadAsset(imageAsset, "主播图片"), uploadAsset(audioAsset, "驱动音频")]));

    const response = await stage("提交 HeyGen 视频任务", () => fetch(`${HEYGEN_API_BASE}/v3/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...providerHeaders(), "Idempotency-Key": idempotencyKey },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        type: "image",
        image: { type: "url", url: imageUrl },
        audio_url: audioUrl,
        title: `${anchorName}${projectTag ? `-${projectTag}` : ""}-slice-${sliceIndex}-${new Date().toISOString()}`,
        resolution: process.env.HEYGEN_RESOLUTION || "1080p",
        aspect_ratio: layout,
        output_format: "mp4",
        expressiveness: "low",
        motion_prompt: requestedMotion || "Professional Hong Kong news anchor facing the camera. Calm, confident and composed expression. Use restrained, natural hand gestures at occasional emphasis points, with hands remaining mostly below chest level. Maintain steady posture, minimal head movement, direct eye contact, and accurate lip sync. No exaggerated gestures, no body turning, no camera movement.",
      }),
    }));
    const text = await response.text();
    let payload: HeyGenCreateResponse = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`HeyGen 返回异常（HTTP ${response.status}）`); }
    const errorMessage = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok || !payload.data?.video_id) throw new Error(errorMessage || payload.message || `HeyGen 提交失败（HTTP ${response.status}）`);
    console.info(`[avatar/jobs] submitted video=${payload.data.video_id} elapsed_ms=${Date.now() - startedAt}`);
    return Response.json({ id: `heygen_${payload.data.video_id}__slice-${sliceIndex.padStart(3, "0")}`, provider: "heygen", status: "queued", progress: 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HeyGen 数字人任务提交失败";
    console.error(`[avatar/jobs] failed elapsed_ms=${Date.now() - startedAt} error=${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
