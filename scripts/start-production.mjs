import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import path from "node:path";

const root = process.cwd();
try { loadEnvFile(path.join(root, ".env.local")); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const children = [];
let stopping = false;

function launch(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping && (code !== 0 || signal)) stop(code || 1);
  });
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

launch(process.execPath, [path.join(root, "scripts", "local-media-server.mjs")]);
launch(path.join(root, "node_modules", ".bin", "vinext"), ["start", "--hostname", "0.0.0.0", "--port", process.env.PORT || "3000"], {
  WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
});

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
