import {listProjectFiles,projectFilesPage,startProjectIndex} from './project-files.mjs';
import {mediaPath} from './project-paths.mjs';
import http from "node:http";
import { parseSrt, validateCreatorComposition } from "./creator-composition.mjs";
import { createAudioAlignedSrt, parseSilenceDetect, SUBTITLE_RULES } from "./subtitle-timeline.mjs";
import { getCreatorProfile, saveCreatorProfile } from "./creator-profile.mjs";
import { getHotspots } from "./hotspots.mjs";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { handleLibrary, serveFile } from "./studio-library-http.mjs";
import { safeBytes } from "./library-download.mjs";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");
const root = process.cwd();
try { loadEnvFile(path.join(root, ".env.local")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
const dataRoot = path.resolve(process.env.STUDIO_DATA_DIR || root);
const audioRoot = mediaPath(dataRoot, "audio-slices");
const compositionRoot = mediaPath(dataRoot, "composition-jobs");
const avatarOutputRoot = mediaPath(dataRoot, "avatar-outputs");
const port = Number(process.env.MEDIA_SERVICE_PORT || 3101);
const apiSettingNames = ["OPENIAPI_BASE_URL", "OPENIAPI_API_KEY", "LLM_MODEL", "MINIMAX_API_BASE_URL", "MINIMAX_API_KEY", "TTS_MODEL", "HEYGEN_API_KEY", "HEYGEN_API_BASE_URL", "HEYGEN_RESOLUTION"];
const secretSettingNames = new Set(["OPENIAPI_API_KEY", "MINIMAX_API_KEY", "HEYGEN_API_KEY"]);

function publicApiSettings() {
  return Object.fromEntries(apiSettingNames.map((name) => [name, secretSettingNames.has(name)
    ? { configured: Boolean(process.env[name]?.trim()) }
    : { value: process.env[name] || "" }]));
}

function updateEnvFile(source, updates) {
  let result = source;
  for (const [name, value] of Object.entries(updates)) {
    const line = `${name}=${JSON.stringify(value.replace(/[\r\n]+/g, "").trim())}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    result = pattern.test(result) ? result.replace(pattern, line) : `${result.trimEnd()}\n${line}\n`;
  }
  return result;
}

function cors(headers = {}) {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,X-File-Name,Range", ...headers };
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

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `进程退出码 ${code}`)));
  });
}

function validUrl(value) {
  if (typeof value !== "string") return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function compositionMediaUrl(value) {
  if (typeof value !== "string") return "";
  const local = value.match(/^\/api\/media\/(library\/downloads\/[a-f0-9]{32}\/file)$/);
  return local ? `http://127.0.0.1:${port}/${local[1]}` : value;
}

async function handle(request, response) {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  // Local-only service: refuse writes from unrelated web origins.
  if (request.headers.origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.origin)) { json(response,403,{error:"不允许此来源访问本地素材服务"}); return; }
  if (request.method === "OPTIONS") { response.writeHead(204, cors()); response.end(); return; }
  if (request.method === "GET" && ["/project-files","/project-files.json"].includes(url.pathname)) {
    const host=url.hostname,origin=request.headers.origin;
    const local=["127.0.0.1","localhost","[::1]"].includes(host)&&(!origin||["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname));
    if(!local){response.writeHead(403);response.end("仅允许本机访问项目索引");return;}
    const index=await listProjectFiles(root);
    response.writeHead(200,{"Content-Type":url.pathname.endsWith('.json')?"application/json; charset=utf-8":"text/html; charset=utf-8","Cache-Control":"no-store",...(origin?{"Access-Control-Allow-Origin":origin,"Vary":"Origin"}:{})});
    response.end(url.pathname.endsWith('.json')?JSON.stringify(index):projectFilesPage(index));return;
  }
  if (request.method === "GET" && url.pathname === "/health") { json(response, 200, { ready: true, ffmpeg: Boolean(ffmpegPath) }); return; }
  if (request.method === "POST" && url.pathname === "/news/fetch") {
    const body = await jsonBody(request);
    if (!validUrl(body.url)) { json(response, 400, { error: "新闻链接无效" }); return; }
    const fetched = await safeBytes(body.url, { left: 3_000_000 });
    response.writeHead(200, cors({
      "Content-Type": fetched.type || "application/octet-stream",
      "Content-Length": String(fetched.bytes.length),
      "X-Final-Url": encodeURIComponent(fetched.url),
      "Cache-Control": "no-store",
    }));
    response.end(fetched.bytes); return;
  }
  if (request.method === "POST" && url.pathname === "/avatar-outputs") {
    const body = await jsonBody(request);
    if (!validUrl(body.source_url) || typeof body.job_id !== "string" || !/^[A-Za-z0-9_-]{6,160}$/.test(body.job_id)
      || typeof body.slice_id !== "string" || !/^slice-\d{3}$/.test(body.slice_id)) {
      json(response, 400, { error: "HeyGen 回传视频参数无效" }); return;
    }
    await mkdir(avatarOutputRoot, { recursive: true });
    const token = createHash("sha256").update(body.job_id).digest("hex").slice(0, 32);
    const file = `${body.slice_id}-${token}.mp4`;
    const target = path.join(avatarOutputRoot, file);
    try { await access(target); }
    catch {
      const fetched = await safeBytes(body.source_url, { left: 250_000_000 });
      if (fetched.type.includes("text/") || fetched.type.includes("html")) throw new Error("HeyGen 回传地址不是视频文件");
      const temporary = `${target}.tmp-${process.pid}`;
      await writeFile(temporary, fetched.bytes);
      await rename(temporary, target);
    }
    json(response, 200, { stored: true, file, url: `/avatar-outputs/${file}` }); return;
  }
  const anchorAsset = url.pathname.match(/^\/anchors\/(hk-(?:male|female)-anchor-(?:render\.jpg|greenscreen-16x9-v2\.png))$/);
  if (["GET", "HEAD"].includes(request.method) && anchorAsset) {
    await serveFile(request, response, path.join(root, "public", "anchors", anchorAsset[1]), anchorAsset[1].endsWith("png") ? "image/png" : "image/jpeg", cors()); return;
  }
  if (request.method === "GET" && url.pathname === "/settings/apis") {
    json(response, 200, { localOnly: true, settings: publicApiSettings() }); return;
  }
  if (request.method === "POST" && url.pathname === "/settings/apis") {
    const incoming = await jsonBody(request);
    const updates = {};
    for (const name of apiSettingNames) {
      if (typeof incoming[name] !== "string") continue;
      const value = incoming[name].trim();
      if (secretSettingNames.has(name) && !value) continue;
      if (name === "MINIMAX_API_KEY" && value.startsWith("sk-cp")) {
        json(response, 400, { error: "MiniMax 音频套餐须使用 Access 页面创建的 sk-api 密钥，不能填写 Token Plan 的 sk-cp 订阅密钥" }); return;
      }
      updates[name] = value.slice(0, name.includes("KEY") ? 1000 : 300);
    }
    if (!Object.keys(updates).length) { json(response, 400, { error: "没有需要保存的配置" }); return; }
    const envPath = path.join(root, ".env.local");
    const source = await readFile(envPath, "utf8").catch(() => "");
    const temporary = `${envPath}.tmp`;
    await writeFile(temporary, updateEnvFile(source, updates), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, envPath);
    for (const [name, value] of Object.entries(updates)) process.env[name] = value;
    json(response, 200, { saved: true, settings: publicApiSettings() }); return;
  }
  if (url.pathname === "/creator/profile" && request.method === "GET") { json(response, 200, await getCreatorProfile()); return; }
  if (url.pathname === "/creator/profile" && request.method === "POST") { json(response, 200, await saveCreatorProfile(await jsonBody(request))); return; }
  if (url.pathname === "/news/hotspots" && request.method === "GET") { json(response, 200, await getHotspots()); return; }
  if (await handleLibrary(request,response,url,{json,jsonBody,bodyBuffer,cors})) return;

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
    const sourceId = typeof body.audio_job_id === "string" ? body.audio_job_id : "";
    if (!/^[a-f0-9]{32}$/.test(sourceId)) { json(response, 400, { error: "完整配音任务编号无效" }); return; }
    const durationMs = Math.max(0, Number(body.duration_ms || 0));
    const segmentSeconds = Math.max(10, Math.min(120, Number(body.segment_seconds || 120)));
    const id = randomBytes(16).toString("hex");
    const dir = path.join(audioRoot, id);
    await mkdir(dir, { recursive: true });
    await copyFile(path.join(audioRoot, sourceId, "source.mp3"), path.join(dir, "source.mp3"));
    const source = path.join(dir, "source.mp3");
    await access(source);
    await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", source, "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1", "-c:a", "libmp3lame", "-b:a", "96k", path.join(dir, "slice-%03d.mp3")]);
    const files = (await readdir(dir)).filter((name) => /^slice-\d{3}\.mp3$/.test(name)).sort();
    const totalSeconds = durationMs > 0 ? durationMs / 1000 : files.length * segmentSeconds;
    const slices = files.map((file, index) => { const start = index * segmentSeconds; const end = Math.min(totalSeconds, start + segmentSeconds); return { id: file.replace(/\.mp3$/, ""), index, start, end, duration: Math.max(.1, end - start), url: `http://127.0.0.1:${port}/audio/${id}/${file}` }; });
    json(response, 201, { id, segment_seconds: segmentSeconds, slices }); return;
  }

  if (request.method === "POST" && url.pathname === "/audio/subtitles") {
    const body = await jsonBody(request);
    const sourceId = typeof body.audio_job_id === "string" ? body.audio_job_id : "";
    const script = typeof body.script === "string" ? body.script.trim() : "";
    if (!/^[a-f0-9]{32}$/.test(sourceId)) { json(response, 400, { error: "完整配音任务编号无效" }); return; }
    if (script.length < 10) { json(response, 400, { error: "粤语配音稿过短，无法生成字幕" }); return; }
    const source = path.join(audioRoot, sourceId, "source.mp3");
    await access(source);
    const durationMs = Math.max(0, Number(body.duration_ms || 0));
    let duration = durationMs / 1000;
    if (!(duration > 0)) {
      const probed = await capture(ffmpegPath, ["-hide_banner", "-i", source, "-f", "null", "-"]).catch((error) => ({ stderr: String(error?.message || error), stdout: "" }));
      const match = probed.stderr.match(/Duration:\s*(\d+):(\d+):([0-9.]+)/);
      if (match) duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    }
    if (!(duration > 0)) { json(response, 422, { error: "无法读取最终配音时长" }); return; }
    const detected = await capture(ffmpegPath, ["-hide_banner", "-i", source, "-af", "silencedetect=noise=-38dB:d=0.12", "-f", "null", "-"]);
    const aligned = createAudioAlignedSrt(script, duration, parseSilenceDetect(detected.stderr));
    json(response, 201, { ...aligned, rules: SUBTITLE_RULES }); return;
  }

  const audioMatch = url.pathname.match(/^\/audio\/([a-f0-9]{32})\/(source\.mp3|slice-\d{3}\.mp3)$/);
  if (["GET","HEAD"].includes(request.method) && audioMatch) {
    await serveFile(request,response,path.join(audioRoot,audioMatch[1],audioMatch[2]),"audio/mpeg",cors());return;
  }

  const avatarOutputMatch = url.pathname.match(/^\/avatar-outputs\/(slice-\d{3}-[a-f0-9]{32}\.mp4)$/);
  if ((request.method === "GET" || request.method === "HEAD") && avatarOutputMatch) {
    const video = await readFile(path.join(avatarOutputRoot, avatarOutputMatch[1]));
    response.writeHead(200, cors({ "Content-Type": "video/mp4", "Content-Length": String(video.length), "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" }));
    response.end(request.method === "HEAD" ? undefined : video); return;
  }

  if (request.method === "POST" && url.pathname === "/compositions") {
    const body = await jsonBody(request);
    const audioJobId = typeof body.audioJobId === "string" ? body.audioJobId : "";
    if (!/^[a-f0-9]{32}$/.test(audioJobId)) { json(response, 400, { error: "完整配音任务编号无效" }); return; }
    await access(path.join(audioRoot, audioJobId, "source.mp3"));
    if (!Array.isArray(body.avatarSegments) || !body.avatarSegments.length || body.avatarSegments.some((item) => !validUrl(item?.url))) { json(response, 400, { error: "数字人片段无效" }); return; }
    if (!Array.isArray(body.scenes)) { json(response, 400, { error: "新闻分镜无效" }); return; }
    try { validateCreatorComposition(body); } catch (error) { json(response, 400, {error:error.message}); return; }
    if (body.layout === "landscape") {
      if (body.subtitleAlignment !== "audio-pauses") { json(response, 400, { error: "字幕尚未与最终音频完成时码校验" }); return; }
      try { parseSrt(String(body.subtitlesSrt || ""), Number(body.audioDuration || 0)); }
      catch (error) { json(response, 400, { error: error.message }); return; }
    }
    body.scenes = body.scenes.map((item) => ({ ...item, url: compositionMediaUrl(item?.url) }));
    if (body.scenes.some((item) => !validUrl(item?.url))) { json(response, 400, { error: "新闻分镜无效" }); return; }
    const id = randomBytes(16).toString("hex");
    const jobDir = path.join(compositionRoot, id);
    await mkdir(jobDir, { recursive: true });
    await writeFile(path.join(jobDir, "input.json"), JSON.stringify(body, null, 2));
    await writeFile(path.join(jobDir, "job.json"), JSON.stringify({ id, status: "queued", progress: 0, createdAt: Date.now(), updatedAt: Date.now() }, null, 2));
    const child = spawn(process.execPath, [path.join(root, "scripts", "composition-worker.mjs"), jobDir], { cwd: root, detached: true, stdio: "ignore" }); child.unref();
    json(response, 202, { id, status: "queued", progress: 0 }); return;
  }

  const jobMatch = url.pathname.match(/^\/compositions\/([a-f0-9]{32})(\/(?:download|edit-package))?$/);
  if (["GET", "HEAD"].includes(request.method) && jobMatch) {
    const dir = path.join(compositionRoot, jobMatch[1]);
    let job = JSON.parse(await readFile(path.join(dir, "job.json"), "utf8"));
    if (["downloading", "rendering"].includes(job.status) && job.workerPid && !processIsAlive(Number(job.workerPid))) {
      job = { ...job, status: "failed", progress: 0, workerPid: 0, updatedAt: Date.now(), error: "合片进程已中断（可能是服务器重启），请重新提交合片。" };
      await writeFile(path.join(dir, "job.json"), JSON.stringify(job, null, 2));
    }
    if (jobMatch[2] === "/download") {
      if (job.status !== "completed") { json(response, 409, { error: "成片尚未完成" }); return; }
      await serveFile(request, response, path.join(dir, "final.mp4"), "video/mp4", cors({ "Content-Disposition": `attachment; filename=news-avatar-${jobMatch[1].slice(0, 8)}.mp4` })); return;
    }
    if (jobMatch[2] === "/edit-package") {
      if (job.status !== "completed") { json(response, 409, { error: "本地剪辑包尚未完成" }); return; }
      await serveFile(request, response, path.join(dir, "local-edit-package.tar.gz"), "application/gzip", cors({ "Content-Disposition": `attachment; filename=news-avatar-edit-${jobMatch[1].slice(0, 8)}.tar.gz` })); return;
    }
    if (request.method === "HEAD") { response.writeHead(405, cors({ Allow: "GET" })); response.end(); return; }
    json(response, 200, { ...job,
      download_url: job.status === "completed" ? `http://127.0.0.1:${port}/compositions/${jobMatch[1]}/download` : "",
      edit_package_url: job.status === "completed" ? `http://127.0.0.1:${port}/compositions/${jobMatch[1]}/edit-package` : "" }); return;
  }
  json(response, 404, { error: "本地媒体接口不存在" });
}

const stopProjectIndex=startProjectIndex(root);
const server = http.createServer((request, response) => handle(request, response).catch((error) => json(response, Number(error?.status) || 500, { error: error instanceof Error ? error.message : "本地媒体服务失败" })));
server.on("close",stopProjectIndex);
server.listen(port, "127.0.0.1", () => console.log(`Local media service: http://127.0.0.1:${port}`));
