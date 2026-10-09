import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const gatewayRoot = path.join(root, "vercel-gateway");
const authPath = path.join(os.homedir(), "Library", "Application Support", "com.vercel.cli", "auth.json");
const auth = JSON.parse(await readFile(authPath, "utf8"));
const project = JSON.parse(await readFile(path.join(gatewayRoot, ".vercel", "project.json"), "utf8"));
if (!auth.token) throw new Error("Vercel 登录凭证不存在，请重新登录 Vercel");

const names = ["api/gateway.js", "package.json", "vercel.json"];
const files = await Promise.all(names.map(async (name) => ({
  file: name,
  data: (await readFile(path.join(gatewayRoot, name))).toString("base64"),
  encoding: "base64",
})));

const response = await fetch(`https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(project.orgId)}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: project.projectName, project: project.projectId, target: "production", files }),
});
const payload = await response.json();
if (!response.ok) throw new Error(payload.error?.message || `Vercel 部署失败（HTTP ${response.status}）`);
console.log(JSON.stringify({ id: payload.id, url: payload.url, readyState: payload.readyState }));
