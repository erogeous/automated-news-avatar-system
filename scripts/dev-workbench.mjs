import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const children = [
  spawn(process.execPath, [path.join(root, "scripts", "local-media-server.mjs")], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(path.join(root, "node_modules", ".bin", "vinext"), ["dev"], {
    cwd: root,
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
    stdio: "inherit",
  }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping && (code !== 0 || signal)) stop(code || 1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
