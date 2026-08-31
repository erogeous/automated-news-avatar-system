import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
const jobsRoot = path.join(process.cwd(), ".composition-jobs");

function validPublicUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch { return false; }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { audioJobId?: unknown; audioDuration?: unknown; avatarSegments?: unknown; projectName?: unknown; scenes?: unknown; layout?: unknown;
      greenScreen?: unknown; chromaSimilarity?: unknown; chromaBlend?: unknown; anchorName?: unknown; packagingAssets?: unknown };
    const audioJobId = typeof body.audioJobId === "string" ? body.audioJobId : "";
    if (!/^[a-f0-9]{32}$/.test(audioJobId)) return Response.json({ error: "完整配音任务编号无效" }, { status: 400 });
    await access(path.join(process.cwd(), ".audio-slices", audioJobId, "source.mp3"));
    if (!Array.isArray(body.avatarSegments) || !body.avatarSegments.length) return Response.json({ error: "请至少生成一个数字人片段" }, { status: 400 });
    const avatarSegments = body.avatarSegments.slice(0, 30).map((segment, index) => {
      const item = segment as Record<string, unknown>;
      if (!validPublicUrl(item.url)) throw new Error(`第 ${index + 1} 个数字人片段地址无效`);
      const start = Math.max(0, Math.min(3600, Number(item.start) || 0));
      const end = Math.max(start + 0.1, Math.min(3600, Number(item.end) || start + 28));
      return { url: item.url, start, end, duration: end - start };
    });
    if (!Array.isArray(body.scenes) || !body.scenes.length) return Response.json({ error: "请至少选择一个分镜素材" }, { status: 400 });
    const scenes = body.scenes.slice(0, 30).map((scene, index) => {
      const item = scene as Record<string, unknown>;
      if (!validPublicUrl(item.url) || !["image", "video"].includes(String(item.type))) throw new Error(`第 ${index + 1} 个分镜素材无效`);
      return { url: item.url, type: item.type, start: Math.max(0, Math.min(3600, Number(item.start) || 0)), duration: Math.max(2, Math.min(60, Number(item.duration) || 6)), cue: String(item.cue || "").slice(0, 100) };
    });
    const id = randomBytes(16).toString("hex");
    const jobDir = path.join(jobsRoot, id);
    await mkdir(jobDir, { recursive: true });
    const layout = body.layout === "landscape" ? "landscape" : "portrait";
    const allowedPackagingAssets = new Set(["background", "logo", "nameplate"]);
    const packagingAssets = Array.isArray(body.packagingAssets)
      ? body.packagingAssets.filter((item): item is string => typeof item === "string" && allowedPackagingAssets.has(item))
      : ["background", "logo", "nameplate"];
    await writeFile(path.join(jobDir, "input.json"), JSON.stringify({ audioJobId,
      audioDuration: Math.max(1, Math.min(3600, Number(body.audioDuration) || 240)), avatarSegments,
      projectName: String(body.projectName || "新闻口播").slice(0, 80), scenes, layout,
      anchorName: String(body.anchorName || "主播").slice(0, 30), packagingAssets,
      greenScreen: layout === "landscape" && body.greenScreen === true,
      chromaSimilarity: Math.max(0.05, Math.min(0.35, Number(body.chromaSimilarity) || 0.14)),
      chromaBlend: Math.max(0.01, Math.min(0.2, Number(body.chromaBlend) || 0.055)) }, null, 2));
    await writeFile(path.join(jobDir, "job.json"), JSON.stringify({ id, status: "queued", progress: 0, createdAt: Date.now(), updatedAt: Date.now() }, null, 2));
    const worker = path.join(process.cwd(), "scripts", "composition-worker.mjs");
    const child = spawn(process.execPath, [worker, jobDir], { cwd: process.cwd(), detached: true, stdio: "ignore" });
    child.unref();
    return Response.json({ id, status: "queued", progress: 0 }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "合片任务创建失败" }, { status: 502 });
  }
}
