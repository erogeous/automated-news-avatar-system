import {mediaPath} from './project-paths.mjs';
import { creatorAss, newsAss, validateCreatorComposition } from "./creator-composition.mjs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");
const jobDir = process.argv[2];
const jobFile = path.join(jobDir, "job.json");
const inputFile = path.join(jobDir, "input.json");
const dataRoot = path.resolve(process.env.STUDIO_DATA_DIR || process.cwd());

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

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], ...options });
    let stderr = "";
    process.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
    process.on("error", reject);
    process.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `${command} 退出码 ${code}`)));
  });
}

async function subtitleFont() {
  const choices = [
    [process.env.SUBTITLE_FONTS_DIR, process.env.SUBTITLE_FONT_NAME || "Noto Sans CJK TC"],
    ["/usr/share/fonts/opentype/noto", "Noto Sans CJK TC"],
    ["/usr/share/fonts/truetype/noto", "Noto Sans CJK TC"],
    ["/System/Library/Fonts", "Heiti SC"],
  ];
  for (const [dir, name] of choices) {
    if (!dir) continue;
    try { await access(dir); return { dir, name }; } catch {}
  }
  return { dir: "", name: "sans-serif" };
}

async function main() {
  if (!ffmpegPath) throw new Error("FFmpeg 二进制不可用");
  await setJob({ status: "downloading", progress: 8, workerPid: process.pid });
  const input = JSON.parse(await readFile(inputFile, "utf8"));
  validateCreatorComposition(input);
  const mediaDir = path.join(jobDir, "media");
  await mkdir(mediaDir, { recursive: true });
  const audioPath = path.join(mediaPath(dataRoot, "audio-slices"), input.audioJobId, "source.mp3");
  await readFile(audioPath);
  const localAvatarSegments = [];
  for (let index = 0; index < input.avatarSegments.length; index += 1) {
    const segment = input.avatarSegments[index];
    const target = path.join(mediaDir, `avatar-${index + 1}.mp4`);
    try { await access(target); } catch { await download(segment.url, target); }
    localAvatarSegments.push({ ...segment, path: target });
    await setJob({ progress: Math.round(8 + ((index + 1) / input.avatarSegments.length) * 12) });
  }
  const localScenes = [];
  for (let index = 0; index < input.scenes.length; index += 1) {
    const scene = input.scenes[index];
    const extension = scene.type === "image" ? ".jpg" : ".mp4";
    const target = path.join(mediaDir, `scene-${index + 1}${extension}`);
    const isHls = scene.type === "video" && /\.m3u8(?:\?|$)/i.test(scene.url);
    if (!isHls) {
      try { await access(target); } catch { await download(scene.url, target); }
    }
    localScenes.push({ ...scene, path: isHls ? scene.url : target });
    await setJob({ progress: Math.round(20 + ((index + 1) / input.scenes.length) * 16) });
  }

  const landscape = input.layout === "landscape";
  const portraitWidth = input.mode === "creator" ? 1080 : 720;
  const portraitHeight = input.mode === "creator" ? 1920 : 1280;
  const packaging = new Set(Array.isArray(input.packagingAssets) ? input.packagingAssets : ["intro", "background", "logo", "nameplate"]);
  const duration = Math.max(1, Number(input.audioDuration) || 240);
  const args = ["-y", "-i", audioPath];
  if (landscape && packaging.has("background")) args.push("-stream_loop", "-1", "-t", String(duration), "-i", path.join(process.cwd(), "public", "programme-loop-background.mp4"));
  else args.push("-f", "lavfi", "-t", String(duration), "-i", `color=c=${landscape ? "0x0b1828" : "black"}:s=${landscape ? "1920x1080" : `${portraitWidth}x${portraitHeight}`}:r=25`);
  let nextInputIndex = 2;
  let logoInputIndex = -1;
  let nameplateInputIndex = -1;
  if (landscape && packaging.has("logo")) {
    logoInputIndex = nextInputIndex++;
    args.push("-loop", "1", "-t", String(duration), "-i", path.join(process.cwd(), "public", "programme-logo.png"));
  }
  if (landscape && packaging.has("nameplate")) {
    nameplateInputIndex = nextInputIndex++;
    const nameplateFile = String(input.anchorName || "").includes("林嘉晴") ? "female.png" : "male.png";
    args.push("-loop", "1", "-t", String(duration), "-i", path.join(process.cwd(), "public", "nameplates", nameplateFile));
  }
  const avatarInputIndices = localAvatarSegments.map((segment) => {
    args.push("-i", segment.path);
    return nextInputIndex++;
  });
  const sceneInputIndices = [];
  for (const scene of localScenes) {
    if (scene.type === "image") args.push("-loop", "1", "-t", String(scene.duration), "-i", scene.path);
    else args.push("-stream_loop", "-1", "-t", String(scene.duration), "-i", scene.path);
    sceneInputIndices.push(nextInputIndex++);
  }
  const filters = [];
  let previous = "base0";
  if (landscape) {
    filters.push("[1:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=25[base0]");
  } else {
    filters.push(`[1:v]scale=${portraitWidth}:${portraitHeight},setsar=1[base0]`);
  }
  localAvatarSegments.forEach((segment, index) => {
    const inputIndex = avatarInputIndices[index];
    const avatarLabel = `avatar${index}`;
    const outputLabel = `avatarMix${index}`;
    if (landscape) {
      const requestedChromaSimilarity = Number(input.chromaSimilarity) || 0.10;
      const safeChromaSimilarity = requestedChromaSimilarity > 0.12 ? 0.10 : Math.max(0.06, requestedChromaSimilarity);
      const safeChromaBlend = Math.max(0.03, Math.min(0.06, Number(input.chromaBlend) || 0.05));
      const keyFilter = input.greenScreen
        ? `crop=iw/2:ih:iw/2:0,chromakey=0x00FF00:${safeChromaSimilarity}:${safeChromaBlend},despill=type=green,`
        : "";
      const requestedAvatarHeight = Number(input.avatarHeight ?? 1040);
      const safeAvatarHeight = requestedAvatarHeight === 1100 ? 1040 : Math.max(600, Math.min(1400, requestedAvatarHeight));
      filters.push(`[${inputIndex}:v]${keyFilter}eq=brightness=0:contrast=1.02:saturation=1.02,scale=-1:${safeAvatarHeight}:flags=lanczos,unsharp=5:5:0.30:5:5:0,setsar=1,setpts=PTS-STARTPTS+${segment.start}/TB[${avatarLabel}]`);
      const requestedAvatarX = Number(input.avatarX ?? 930);
      const safeAvatarX = requestedAvatarX === 1280 ? 930 : Math.max(600, Math.min(1400, requestedAvatarX));
      const requestedAvatarY = Number(input.avatarY ?? 50);
      const safeAvatarY = requestedAvatarY === -40 ? 50 : Math.max(-300, Math.min(300, requestedAvatarY));
      filters.push(`[${previous}][${avatarLabel}]overlay=x=${safeAvatarX}:y=${safeAvatarY}:eof_action=pass:shortest=0:enable='between(t,${segment.start},${segment.end})'[${outputLabel}]`);
    } else {
      filters.push(`[${inputIndex}:v]scale=${portraitWidth}:${portraitHeight}:force_original_aspect_ratio=decrease,pad=${portraitWidth}:${portraitHeight}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,setpts=PTS-STARTPTS+${segment.start}/TB[${avatarLabel}]`);
      filters.push(`[${previous}][${avatarLabel}]overlay=eof_action=pass:shortest=0:enable='between(t,${segment.start},${segment.end})'[${outputLabel}]`);
    }
    previous = outputLabel;
  });
  const avatarActiveExpression = localAvatarSegments.length
    ? localAvatarSegments.map((segment) => `between(t,${segment.start},${segment.end})`).join("+")
    : "0";
  localScenes.forEach((scene, index) => {
    const inputIndex = sceneInputIndices[index];
    const sceneLabel = `scene${index}`;
    const outputLabel = `mix${index}`;
    if (landscape) {
      const sceneWidth = input.sceneWidth || 820;
      const sceneHeight = Math.round(sceneWidth * 9 / 16);
      const fullSourceLabel = `${sceneLabel}FullSource`;
      const windowSourceLabel = `${sceneLabel}WindowSource`;
      const fullLabel = `${sceneLabel}Full`;
      const windowLabel = `${sceneLabel}Window`;
      const fullMixLabel = `${outputLabel}Full`;
      const sceneInterval = `between(t,${scene.start},${scene.start + scene.duration})`;
      filters.push(`[${inputIndex}:v]setsar=1,split=2[${fullSourceLabel}][${windowSourceLabel}]`);
      filters.push(`[${fullSourceLabel}]scale=1920:1080:force_original_aspect_ratio=increase:force_divisible_by=2,crop=1920:1080,setsar=1,setpts=PTS-STARTPTS+${scene.start}/TB[${fullLabel}]`);
      filters.push(`[${windowSourceLabel}]scale=${sceneWidth}:${sceneHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${sceneWidth}:${sceneHeight}:(ow-iw)/2:(oh-ih)/2:0x101923,setsar=1,setpts=PTS-STARTPTS+${scene.start}/TB[${windowLabel}]`);
      filters.push(`[${previous}][${fullLabel}]overlay=eof_action=pass:shortest=0:enable='${sceneInterval}*lte(${avatarActiveExpression},0)'[${fullMixLabel}]`);
      filters.push(`[${fullMixLabel}][${windowLabel}]overlay=x=${input.sceneX ?? 80}:y=${input.sceneY ?? 250}:eof_action=pass:shortest=0:enable='${sceneInterval}*gt(${avatarActiveExpression},0)'[${outputLabel}]`);
    } else {
      if (input.mode === "creator") {
        filters.push(`[${inputIndex}:v]setsar=1,split=2[${sceneLabel}BgSource][${sceneLabel}FgSource]`);
        filters.push(`[${sceneLabel}BgSource]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=30,eq=brightness=-0.12[${sceneLabel}Bg]`);
        filters.push(`[${sceneLabel}FgSource]scale=1080:1500:force_original_aspect_ratio=decrease:force_divisible_by=2[${sceneLabel}Fg]`);
        filters.push(`[${sceneLabel}Bg][${sceneLabel}Fg]overlay=(W-w)/2:(H-h)/2,setsar=1,setpts=PTS-STARTPTS+${scene.start}/TB[${sceneLabel}]`);
      } else {
        filters.push(`[${inputIndex}:v]setsar=1,scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,setsar=1,setpts=PTS-STARTPTS+${scene.start}/TB[${sceneLabel}]`);
      }
      filters.push(`[${previous}][${sceneLabel}]overlay=eof_action=pass:shortest=0:enable='between(t,${scene.start},${scene.start + scene.duration})'[${outputLabel}]`);
    }
    previous = outputLabel;
  });
  if (landscape && logoInputIndex >= 0) {
    filters.push(`[${logoInputIndex}:v]scale=190:-1:flags=lanczos,format=rgba[logo]`);
    filters.push(`[${previous}][logo]overlay=x=42:y=32:eof_action=pass:shortest=0[withlogo]`);
    previous = "withlogo";
  }
  if (landscape && nameplateInputIndex >= 0) {
    const nameplateEnable = avatarActiveExpression;
    filters.push(`[${nameplateInputIndex}:v]format=rgba[nameplate]`);
    filters.push(`[${previous}][nameplate]overlay=x=1395:y=900:eof_action=pass:shortest=0:enable='${nameplateEnable}'[packaged]`);
    previous = "packaged";
  }
  if (input.mode === "creator" && (input.subtitles || input.title)) {
    const assFile = path.join(jobDir, "captions.ass");
    await writeFile(assFile, creatorAss(input));
    // A fixed relative filename avoids filter escaping of the workspace path.
    filters.push(`[${previous}]ass=filename=captions.ass[captioned]`);
    previous = "captioned";
  }
  if (landscape && input.subtitlesSrt) {
    const font = await subtitleFont();
    const assFile = path.join(jobDir, "news-captions.ass");
    await writeFile(assFile, newsAss(input, font.name));
    filters.push(`[${previous}]ass=filename=news-captions.ass${font.dir ? `:fontsdir='${font.dir}'` : ""}[captioned]`);
    previous = "captioned";
  }
  const includeIntro = landscape && packaging.has("intro");
  const output = path.join(jobDir, "final.mp4");
  const mainOutput = includeIntro ? path.join(jobDir, "main.mp4") : output;
  args.push("-filter_complex", filters.join(";"), "-map", `[${previous}]`, "-map", "0:a:0", "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "128k", "-pix_fmt", "yuv420p", "-r", "25", "-movflags", "+faststart", "-shortest", mainOutput);
  await setJob({ status: "rendering", progress: 35 });
  await new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args, { cwd: jobDir, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    process.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
    process.on("error", reject);
    process.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.split("\n").slice(-40).join("\n") || `FFmpeg 退出码 ${code}`)));
  });
  if (includeIntro) {
    await setJob({ status: "rendering", progress: 88 });
    const introPath = path.join(process.cwd(), "public", "programme-intro.mp4");
    const concatFilters = [
      "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=25,format=yuv420p,setpts=PTS-STARTPTS[introv]",
      "[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[introa]",
      "[1:v]fps=25,format=yuv420p,setpts=PTS-STARTPTS[mainv]",
      "[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[maina]",
      "[introv][introa][mainv][maina]concat=n=2:v=1:a=1[outv][outa]",
    ].join(";");
    const concatArgs = ["-y", "-i", introPath, "-i", mainOutput, "-filter_complex", concatFilters,
      "-map", "[outv]", "-map", "[outa]", "-c:v", "libx264", "-preset", "fast", "-crf", "19",
      "-c:a", "aac", "-b:a", "160k", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output];
    await new Promise((resolve, reject) => {
      const process = spawn(ffmpegPath, concatArgs, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      process.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
      process.on("error", reject);
      process.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.split("\n").slice(-8).join("\n") || `片头合并失败，FFmpeg 退出码 ${code}`)));
    });
  }
  const editAssetsDir = path.join(jobDir, "edit-assets");
  await mkdir(editAssetsDir, { recursive: true });
  await copyFile(audioPath, path.join(editAssetsDir, "source.mp3"));
  const packagingFiles = [
    ["programme-intro.mp4", "programme-intro.mp4"],
    ["programme-loop-background.mp4", "programme-loop-background.mp4"],
    ["programme-logo.png", "programme-logo.png"],
  ];
  for (const [sourceName, targetName] of packagingFiles) {
    try { await copyFile(path.join(process.cwd(), "public", sourceName), path.join(editAssetsDir, targetName)); } catch {}
  }
  const nameplateFile = String(input.anchorName || "").includes("林嘉晴") ? "female.png" : "male.png";
  try { await copyFile(path.join(process.cwd(), "public", "nameplates", nameplateFile), path.join(editAssetsDir, "nameplate.png")); } catch {}
  await writeFile(path.join(jobDir, "subtitles.srt"), String(input.subtitlesSrt || ""), "utf8");
  await writeFile(path.join(jobDir, "timeline.json"), JSON.stringify({
    version: 1, projectName: input.projectName, layout: input.layout, duration,
    audio: "edit-assets/source.mp3",
    avatarSegments: localAvatarSegments.map((segment, index) => ({ start: segment.start, end: segment.end, file: `media/avatar-${index + 1}.mp4` })),
    scenes: localScenes.map((scene, index) => ({ start: scene.start, duration: scene.duration, type: scene.type, cue: scene.cue || "", file: `media/scene-${index + 1}${scene.type === "image" ? ".jpg" : ".mp4"}` })),
    rule: "数字人出镜时新闻素材使用左侧小窗；数字人未出镜时新闻素材全屏；完整配音始终为唯一主音轨。",
  }, null, 2), "utf8");
  await writeFile(path.join(jobDir, "本地剪辑说明.txt"), [
    "《點觀香港》本地剪辑包", "", "final.mp4：服务器自动生成的参考成片", "edit-assets/source.mp3：完整粤语配音主轨",
    "media/avatar-*.mp4：数字人原始片段", "media/scene-*：新闻图片与视频素材", "subtitles.srt：已与最终音频停顿对齐的粤语字幕",
    "timeline.json：素材开始时间、时长与画面规则", "edit-assets：片头、循环背景、Logo 与主播名牌", "",
    "导入本地剪辑软件时，请保持 source.mp3 为唯一主音轨，并将新闻视频原声静音。",
  ].join("\n"), "utf8");
  await run("tar", ["-czf", "local-edit-package.tar.gz", "final.mp4", "input.json", "timeline.json", "subtitles.srt", "本地剪辑说明.txt", "edit-assets", "media"], { cwd: jobDir });
  await setJob({ status: "completed", progress: 100, output: "final.mp4", editPackage: "local-edit-package.tar.gz", error: "", workerPid: 0 });
}

main().catch(async (error) => {
  await setJob({ status: "failed", progress: 0, error: error instanceof Error ? error.message : "合片失败", workerPid: 0 });
  process.exitCode = 1;
});
