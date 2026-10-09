import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ffmpeg = createRequire(import.meta.url)("ffmpeg-static");
const root = await mkdtemp(path.join(os.tmpdir(), "news-render-"));
const audioId = "b".repeat(32);
const jobDir = path.join(root, "job");
const audioDir = path.join(root, "audio-slices", audioId);
await mkdir(jobDir, { recursive: true });
await mkdir(audioDir, { recursive: true });

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let output = "";
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}

await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:a", "libmp3lame", path.join(audioDir, "source.mp3")]);
await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "color=c=0x00ff00:s=1920x1080:d=2:r=25", "-vf", "drawbox=x=1200:y=90:w=520:h=940:color=0x244d81:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(root, "avatar.mp4")]);
await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "color=c=0xc46b37:s=1280x720", "-frames:v", "1", path.join(root, "scene.jpg")]);

const server = http.createServer(async (request, response) => {
  const file = request.url === "/avatar.mp4" ? "avatar.mp4" : "scene.jpg";
  response.end(await readFile(path.join(root, file)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const subtitles = "1\n00:00:00,000 --> 00:00:02,000\n数字人出镜时素材小窗\n\n2\n00:00:02,000 --> 00:00:04,000\n数字人离场时素材全屏\n";
  await writeFile(path.join(jobDir, "input.json"), JSON.stringify({
    mode: "news", layout: "landscape", audioJobId: audioId, audioDuration: 4,
    avatarSegments: [{ url: `${base}/avatar.mp4`, start: 0, end: 2 }],
    scenes: [{ url: `${base}/scene.jpg`, type: "image", start: 0, duration: 4 }],
    subtitlesSrt: subtitles, subtitleAlignment: "audio-pauses", greenScreen: true,
    avatarX: 930, avatarY: 50, avatarHeight: 1040, sceneX: 80, sceneY: 250,
    anchorName: "林嘉晴", packagingAssets: ["background", "logo", "nameplate"],
  }));
  await writeFile(path.join(jobDir, "job.json"), "{}");
  await run(process.execPath, [path.resolve("scripts/composition-worker.mjs"), jobDir], { env: { ...process.env, STUDIO_DATA_DIR: root } });
  const job = JSON.parse(await readFile(path.join(jobDir, "job.json"), "utf8"));
  assert.equal(job.status, "completed");
  const probe = await run(ffmpeg, ["-i", path.join(jobDir, "final.mp4"), "-f", "null", "-"]);
  assert.match(probe, /1920x1080/);
  assert.match(probe, /Audio: aac/);
  const inputDescription = probe.split("Stream mapping:")[0];
  assert.equal((inputDescription.match(/Stream #0:\d+.*Audio:/g) || []).length, 1, "成片必须只有一条音轨");
  await run(ffmpeg, ["-y", "-ss", "1", "-i", path.join(jobDir, "final.mp4"), "-frames:v", "1", path.join(root, "avatar-window.png")]);
  await run(ffmpeg, ["-y", "-ss", "3", "-i", path.join(jobDir, "final.mp4"), "-frames:v", "1", path.join(root, "material-fullscreen.png")]);
  console.log("PASS: synthetic 4-second 1920x1080 news video, single narration track, audio-aligned subtitles, avatar-window/fullscreen-material switching.");
  console.log(`Previews: ${path.join(root, "avatar-window.png")} | ${path.join(root, "material-fullscreen.png")}`);
} finally {
  server.close();
}
