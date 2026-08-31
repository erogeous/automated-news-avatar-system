import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");
const jobDir = process.argv[2];
const jobFile = path.join(jobDir, "job.json");
const inputFile = path.join(jobDir, "input.json");

async function setJob(patch) {
  let current = {};
  try { current = JSON.parse(await readFile(jobFile, "utf8")); } catch {}
  await writeFile(jobFile, JSON.stringify({ ...current, ...patch, updatedAt: Date.now() }, null, 2));
}

async function download(url, target) {
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "NewsAvatarComposition/1.0" } });
  if (!response.ok) throw new Error(`素材下载失败（HTTP ${response.status}）`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 250_000_000) throw new Error("单个媒体文件超过 250MB");
  await writeFile(target, bytes);
}

function drawtextValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’").replace(/%/g, "\\%");
}

async function main() {
  if (!ffmpegPath) throw new Error("FFmpeg 二进制不可用");
  await setJob({ status: "downloading", progress: 8 });
  const input = JSON.parse(await readFile(inputFile, "utf8"));
  const mediaDir = path.join(jobDir, "media");
  await mkdir(mediaDir, { recursive: true });
  const audioPath = path.join(process.cwd(), ".audio-slices", input.audioJobId, "source.mp3");
  await readFile(audioPath);
  const localAvatarSegments = [];
  for (let index = 0; index < input.avatarSegments.length; index += 1) {
    const segment = input.avatarSegments[index];
    const target = path.join(mediaDir, `avatar-${index + 1}.mp4`);
    await download(segment.url, target);
    localAvatarSegments.push({ ...segment, path: target });
    await setJob({ progress: Math.round(8 + ((index + 1) / input.avatarSegments.length) * 12) });
  }
  const localScenes = [];
  for (let index = 0; index < input.scenes.length; index += 1) {
    const scene = input.scenes[index];
    const extension = scene.type === "image" ? ".jpg" : ".mp4";
    const target = path.join(mediaDir, `scene-${index + 1}${extension}`);
    const isHls = scene.type === "video" && /\.m3u8(?:\?|$)/i.test(scene.url);
    if (!isHls) await download(scene.url, target);
    localScenes.push({ ...scene, path: isHls ? scene.url : target });
    await setJob({ progress: Math.round(20 + ((index + 1) / input.scenes.length) * 16) });
  }

  const landscape = input.layout === "landscape";
  const packaging = new Set(Array.isArray(input.packagingAssets) ? input.packagingAssets : ["background", "logo", "nameplate"]);
  const duration = Math.max(1, Number(input.audioDuration) || 240);
  const args = ["-y", "-i", audioPath];
  if (landscape && packaging.has("background")) args.push("-loop", "1", "-t", String(duration), "-i", path.join(process.cwd(), "public", "studio-newsroom-bg-v1.png"));
  else args.push("-f", "lavfi", "-t", String(duration), "-i", `color=c=${landscape ? "0x0b1828" : "black"}:s=${landscape ? "1920x1080" : "720x1280"}:r=25`);
  for (const segment of localAvatarSegments) args.push("-i", segment.path);
  for (const scene of localScenes) {
    if (scene.type === "image") args.push("-loop", "1", "-t", String(scene.duration), "-i", scene.path);
    else args.push("-stream_loop", "-1", "-t", String(scene.duration), "-i", scene.path);
  }
  const filters = [];
  let previous = "base0";
  if (landscape) {
    filters.push("[1:v]scale=2000:1125,crop=1920:1080:x='40+20*sin(t/8)':y='22+10*cos(t/7)',setsar=1[base0]");
  } else {
    filters.push("[1:v]scale=720:1280,setsar=1[base0]");
  }
  localAvatarSegments.forEach((segment, index) => {
    const inputIndex = 2 + index;
    const avatarLabel = `avatar${index}`;
    const outputLabel = `avatarMix${index}`;
    if (landscape) {
      const keyFilter = input.greenScreen
        ? `chromakey=0x00FF00:${input.chromaSimilarity || 0.14}:${input.chromaBlend || 0.055},despill=type=green,`
        : "";
      filters.push(`[${inputIndex}:v]${keyFilter}eq=brightness=0.06:contrast=1.04:saturation=1.03,scale=-1:1080,setsar=1,setpts=PTS-STARTPTS+${segment.start}/TB[${avatarLabel}]`);
      filters.push(`[${previous}][${avatarLabel}]overlay=x=W-w-35:y=-36:eof_action=pass:shortest=0:enable='between(t,${segment.start},${segment.end})'[${outputLabel}]`);
    } else {
      filters.push(`[${inputIndex}:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,setpts=PTS-STARTPTS+${segment.start}/TB[${avatarLabel}]`);
      filters.push(`[${previous}][${avatarLabel}]overlay=eof_action=pass:shortest=0:enable='between(t,${segment.start},${segment.end})'[${outputLabel}]`);
    }
    previous = outputLabel;
  });
  const firstSceneInput = 2 + localAvatarSegments.length;
  localScenes.forEach((scene, index) => {
    const inputIndex = index + firstSceneInput;
    const sceneLabel = `scene${index}`;
    const outputLabel = `mix${index}`;
    if (landscape) {
      filters.push(`[${inputIndex}:v]scale=900:510:force_original_aspect_ratio=decrease,pad=900:510:(ow-iw)/2:(oh-ih)/2:0x101923,setsar=1,setpts=PTS-STARTPTS+${scene.start}/TB[${sceneLabel}]`);
      filters.push(`[${previous}][${sceneLabel}]overlay=x=70:y=285:eof_action=pass:shortest=0:enable='between(t,${scene.start},${scene.start + scene.duration})'[${outputLabel}]`);
    } else {
      filters.push(`[${inputIndex}:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,setsar=1,setpts=PTS-STARTPTS+${scene.start}/TB[${sceneLabel}]`);
      filters.push(`[${previous}][${sceneLabel}]overlay=eof_action=pass:shortest=0:enable='between(t,${scene.start},${scene.start + scene.duration})'[${outputLabel}]`);
    }
    previous = outputLabel;
  });
  if (landscape && packaging.has("logo")) {
    filters.push(`[${previous}]drawbox=x=54:y=48:w=142:h=92:color=0x0b315a@0.88:t=fill,drawbox=x=54:y=48:w=142:h=92:color=0x4cc9ff@0.9:t=3,drawtext=fontfile='/System/Library/Fonts/STHeiti Medium.ttc':text='點觀香港':fontcolor=white:fontsize=28:x=68:y=78[withlogo]`);
    previous = "withlogo";
  }
  if (landscape && packaging.has("nameplate")) {
    const nameplateEnable = localAvatarSegments.map((segment) => `between(t,${segment.start},${segment.end})`).join("+");
    filters.push(`[${previous}]drawbox=x=1395:y=900:w=430:h=105:color=0x07182b@0.82:t=fill:enable='${nameplateEnable}',drawbox=x=1395:y=900:w=8:h=105:color=0x38bdf8@1:t=fill:enable='${nameplateEnable}',drawtext=fontfile='/System/Library/Fonts/STHeiti Medium.ttc':text='${drawtextValue(input.anchorName)}':fontcolor=white:fontsize=38:x=1430:y=920:enable='${nameplateEnable}',drawtext=fontfile='/System/Library/Fonts/STHeiti Medium.ttc':text='數字人主播':fontcolor=0x9fdcff:fontsize=22:x=1430:y=967:enable='${nameplateEnable}'[packaged]`);
    previous = "packaged";
  }
  const output = path.join(jobDir, "final.mp4");
  args.push("-filter_complex", filters.join(";"), "-map", `[${previous}]`, "-map", "0:a:0", "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest", output);
  await setJob({ status: "rendering", progress: 35 });
  await new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    process.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
    process.on("error", reject);
    process.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.split("\n").slice(-8).join("\n") || `FFmpeg 退出码 ${code}`)));
  });
  await setJob({ status: "completed", progress: 100, output: "final.mp4", error: "" });
}

main().catch(async (error) => {
  await setJob({ status: "failed", progress: 0, error: error instanceof Error ? error.message : "合片失败" });
  process.exitCode = 1;
});
