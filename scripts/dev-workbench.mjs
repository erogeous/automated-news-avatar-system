import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

const root = process.cwd();
const heygenProxy = process.env.HEYGEN_PROXY_URL || "http://127.0.0.1:7890";
const proxyUrl = new URL(heygenProxy);
const proxyAvailable = await new Promise((resolve) => {
  const socket = net.createConnection({ host: proxyUrl.hostname, port: Number(proxyUrl.port || 80) });
  const finish = (ready) => { socket.destroy(); resolve(ready); };
  socket.setTimeout(500, () => finish(false));
  socket.once("connect", () => finish(true));
  socket.once("error", () => finish(false));
});
const webEnv = { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" };
if (proxyAvailable) {
  Object.assign(webEnv, {
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: heygenProxy,
    NO_PROXY: "127.0.0.1,localhost,::1",
  });
  console.log(`HeyGen upload proxy: ${heygenProxy}`);
}
const children = [
  spawn(process.execPath, [path.join(root, "scripts", "local-media-server.mjs")], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(path.join(root, "node_modules", ".bin", "vinext"), ["dev"], {
    cwd: root,
    env: webEnv,
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
