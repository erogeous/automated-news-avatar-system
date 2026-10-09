import { mkdir, rm, cp, writeFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const releaseRoot = path.join(root, "release");
const stage = path.join(releaseRoot, "news-avatar-clean");
const archive = path.join(releaseRoot, "news-avatar-clean.tar.gz");
const entries = [
  "app", "build", "db", "deploy", "drizzle", "public", "worker",
  ".openai", ".env.local.example", "package.json", "package-lock.json",
  "pnpm-lock.yaml", "pnpm-workspace.yaml", "drizzle.config.ts", "eslint.config.mjs",
  "next-env.d.ts", "next.config.ts", "postcss.config.mjs", "tsconfig.json", "vite.config.ts",
];

await rm(stage, { recursive: true, force: true });
await rm(archive, { force: true });
await mkdir(stage, { recursive: true });
for (const entry of entries) await cp(path.join(root, entry), path.join(stage, entry), { recursive: true });
await mkdir(path.join(stage, "scripts"), { recursive: true });
for (const script of [
  "composition-worker.mjs", "creator-composition.mjs", "creator-profile.mjs", "hotspots.mjs", "library-download.mjs", "local-media-server.mjs",
  "start-production.mjs", "studio-library-http.mjs", "studio-library.mjs",
]) await cp(path.join(root, "scripts", script), path.join(stage, "scripts", script));
for (const directory of ["data", ".wrangler"]) await mkdir(path.join(stage, directory), { recursive: true });
await writeFile(path.join(stage, "data", ".gitkeep"), "");
await writeFile(path.join(stage, ".wrangler", ".gitkeep"), "");

async function removeJunk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.name === ".DS_Store") await rm(target, { force: true });
    else if (entry.isDirectory()) await removeJunk(target);
  }
}
await removeJunk(stage);

await new Promise((resolve, reject) => {
  const child = spawn("tar", ["-czf", archive, "-C", releaseRoot, "news-avatar-clean"], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)));
});
console.log(archive);
