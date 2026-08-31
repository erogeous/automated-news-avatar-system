import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");
const root = process.cwd();
const audioRoot = path.join(root, ".audio-slices");
const compositionRoot = path.join(root, ".composition-jobs");
const port = Number(process.env.MEDIA_SERVICE_PORT || 3101);

function cors(headers = {}) {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", ...headers };
}

function json(response, status, value) {
  response.writeHead(status, cors({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }));
  response.end(JSON.stringify(value));
}

async function bodyBuffer(request, limit = 50_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("文件超过本地媒体服务上限"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(request) {
  return JSON.parse((await bodyBuffer(request, 2_000_000)).toString("utf8") || "{}");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorText = "";
    child.stderr.on("data", (chunk) => { errorText = `${errorText}${chunk}`.slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(errorText || `进程退出码 ${code}`)));
  });
}

function validUrl(value) {
  if (typeof value !== "string") return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

async function handle(request, response) {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  if (request.method === "OPTIONS") { response.writeHead(204, cors()); response.end(); return; }
  if (request.method === "GET" && url.pathname === "/health") { json(response, 200, { ready: true, ffmpeg: Boolean(ffmpegPath) }); return; }

  if (request.method === "POST" && url.pathname === "/audio/store") {
    const audio = await bodyBuffer(request);
    if (!audio.length) { json(response, 400, { error: "完整配音文件为空" }); return; }
    const id = randomBytes(16).toString("hex");
    const dir = path.join(audioRoot, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "source.mp3"), audio);
    json(response, 201, { id, size: audio.length }); return;
  }

  if (request.method === "POST" && url.pathname === "/audio/slices") {
    const body = await jsonBody(request);
    const id = typeof body.audio_job_id === "string" ? body.audio_job_id : "";
    if (!/^[a-f0-9]{32}$/.test(id)) { json(response, 400, { error: "完整配音任务编号无效" }); return; }
    const durationMs = Math.max(0, Number(body.duration_ms || 0));
    const segmentSeconds = Math.max(10, Math.min(30, Number(body.segment_seconds || 28)));
    const dir = path.join(audioRoot, id);
    const source = path.join(dir, "source.mp3");
    await access(source);
    await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", source, "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1", "-c:a", "libmp3lame", "-b:a", "96k", path.join(dir, "slice-%03d.mp3")]);
    const files = (await readdir(dir)).filter((name) => /^slice-\d{3}\.mp3$/.test(name)).sort();
    const totalSeconds = durationMs > 0 ? durationMs / 1000 : files.length * segmentSeconds;
    const slices = files.map((file, index) => { const start = index * segmentSeconds; const end = Math.min(totalSeconds, start + segmentSeconds); return { id: file.replace(/\.mp3$/, ""), index, start, end, duration: Math.max(.1, end - start), url: `http://127.0.0.1:${port}/audio/${id}/${file}` }; });
    json(response, 201, { id, segment_seconds: segmentSeconds, slices }); return;
  }

  const audioMatch = url.pathname.match(/^\/audio\/([a-f0-9]{32})\/(slice-\d{3}\.mp3)$/);
  if (request.method === "GET" && audioMatch) {
    const audio = await readFile(path.join(audioRoot, audioMatch[1], audioMatch[2]));
    response.writeHead(200, cors({ "Content-Type": "audio/mpeg", "Content-Length": String(audio.length), "Cache-Control": "private, max-age=3600" })); response.end(audio); return;
  }

  if (request.method === "POST" && url.pathname === "/compositions") {
    const body = await jsonBody(request);
    const audioJobId = typeof body.audioJobId === "string" ? body.audioJobId : "";
    if (!/^[a-f0-9]{32}$/.test(audioJobId)) { json(response, 400, { error: "完整配音任务编号无效" }); return; }
    await access(path.join(audioRoot, audioJobId, "source.mp3"));
    if (!Array.isArray(body.avatarSegments) || !body.avatarSegments.length || body.avatarSegments.some((item) => !validUrl(item?.url))) { json(response, 400, { error: "数字人片段无效" }); return; }
    if (!Array.isArray(body.scenes) || !body.scenes.length || body.scenes.some((item) => !validUrl(item?.url))) { json(response, 400, { error: "新闻分镜无效" }); return; }
    const id = randomBytes(16).toString("hex");
    const jobDir = path.join(compositionRoot, id);
    await mkdir(jobDir, { recursive: true });
    await writeFile(path.join(jobDir, "input.json"), JSON.stringify(body, null, 2));
    await writeFile(path.join(jobDir, "job.json"), JSON.stringify({ id, status: "queued", progress: 0, createdAt: Date.now(), updatedAt: Date.now() }, null, 2));
    const child = spawn(process.execPath, [path.join(root, "scripts", "composition-worker.mjs"), jobDir], { cwd: root, detached: true, stdio: "ignore" }); child.unref();
    json(response, 202, { id, status: "queued", progress: 0 }); return;
  }

  const jobMatch = url.pathname.match(/^\/compositions\/([a-f0-9]{32})(\/download)?$/);
  if (request.method === "GET" && jobMatch) {
    const dir = path.join(compositionRoot, jobMatch[1]);
    const job = JSON.parse(await readFile(path.join(dir, "job.json"), "utf8"));
    if (jobMatch[2]) {
      if (job.status !== "completed") { json(response, 409, { error: "成片尚未完成" }); return; }
      const video = await readFile(path.join(dir, "final.mp4")); response.writeHead(200, cors({ "Content-Type": "video/mp4", "Content-Length": String(video.length), "Content-Disposition": `attachment; filename=news-avatar-${jobMatch[1].slice(0, 8)}.mp4` })); response.end(video); return;
    }
    json(response, 200, { ...job, download_url: job.status === "completed" ? `http://127.0.0.1:${port}/compositions/${jobMatch[1]}/download` : "" }); return;
  }
  json(response, 404, { error: "本地媒体接口不存在" });
}

const server = http.createServer((request, response) => handle(request, response).catch((error) => json(response, Number(error?.status) || 500, { error: error instanceof Error ? error.message : "本地媒体服务失败" })));
server.listen(port, "127.0.0.1", () => console.log(`Local media service: http://127.0.0.1:${port}`));
