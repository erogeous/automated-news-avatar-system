import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
const slicesRoot = path.join(process.cwd(), ".audio-slices");

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorText = "";
    child.stderr.on("data", (chunk) => { errorText += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(errorText.slice(-1200) || `FFmpeg 退出码 ${code}`)));
  });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let audio: File | null = null;
    let existingJobId = "";
    let requestedSeconds = 28;
    let durationMs = 0;
    if (contentType.includes("application/json")) {
      const body = await request.json() as { audio_job_id?: unknown; segment_seconds?: unknown; duration_ms?: unknown };
      existingJobId = typeof body.audio_job_id === "string" ? body.audio_job_id : "";
      requestedSeconds = Number(body.segment_seconds || 28);
      durationMs = Math.max(0, Number(body.duration_ms || 0));
      if (!/^[a-f0-9]{32}$/.test(existingJobId)) return Response.json({ error: "完整配音任务编号无效，请重新生成配音" }, { status: 400 });
    } else {
      const incoming = await request.formData();
      const candidate = incoming.get("audio");
      audio = candidate instanceof File ? candidate : null;
      requestedSeconds = Number(incoming.get("segment_seconds") || 28);
      durationMs = Math.max(0, Number(incoming.get("duration_ms") || 0));
      if (!audio) return Response.json({ error: "缺少完整配音文件" }, { status: 400 });
      if (audio.size > 40_000_000) return Response.json({ error: "配音文件超过本机切片上限 40MB" }, { status: 413 });
    }
    const segmentSeconds = Math.max(10, Math.min(30, requestedSeconds));
    const id = existingJobId || randomBytes(16).toString("hex");
    const jobDir = path.join(slicesRoot, id);
    await mkdir(jobDir, { recursive: true });
    const inputPath = path.join(jobDir, "source.mp3");
    if (audio) await writeFile(inputPath, Buffer.from(await audio.arrayBuffer()));
    else await readFile(inputPath);
    const ffmpegPath = (await import("ffmpeg-static")).default;
    if (!ffmpegPath) throw new Error("本机 FFmpeg 尚未安装");
    await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", inputPath, "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1", "-c:a", "libmp3lame", "-b:a", "96k", path.join(jobDir, "slice-%03d.mp3")]);
    const files = (await readdir(jobDir)).filter((name) => /^slice-\d{3}\.mp3$/.test(name)).sort();
    if (!files.length) throw new Error("FFmpeg 没有生成音频切片");
    const totalSeconds = durationMs > 0 ? durationMs / 1000 : files.length * segmentSeconds;
    const slices = files.map((file, index) => {
      const start = index * segmentSeconds;
      const end = Math.min(totalSeconds, start + segmentSeconds);
      return { id: file.replace(/\.mp3$/, ""), index, start, end, duration: Math.max(0.1, end - start), url: `/api/audio/slices/${id}/${file}` };
    });
    return Response.json({ id, segment_seconds: segmentSeconds, slices }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "音频切片失败" }, { status: 502 });
  }
}
