import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SETTINGS = [
  "OPENIAPI_BASE_URL",
  "OPENIAPI_API_KEY",
  "LLM_MODEL",
  "TTS_MODEL",
  "HEYGEN_API_KEY",
  "HEYGEN_API_BASE_URL",
  "HEYGEN_RESOLUTION",
] as const;

type SettingName = (typeof SETTINGS)[number];
const SECRET_NAMES = new Set<SettingName>(["OPENIAPI_API_KEY", "HEYGEN_API_KEY"]);

function isLocalRequest(request: Request) {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function publicSettings() {
  return Object.fromEntries(SETTINGS.map((name) => [name, SECRET_NAMES.has(name)
    ? { configured: Boolean(process.env[name]?.trim()) }
    : { value: process.env[name] || "" }]));
}

function quoteEnv(value: string) {
  return JSON.stringify(value.replace(/[\r\n]+/g, "").trim());
}

function updateEnv(source: string, updates: Partial<Record<SettingName, string>>) {
  let result = source;
  for (const [name, value] of Object.entries(updates) as Array<[SettingName, string]>) {
    const line = `${name}=${quoteEnv(value)}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    result = pattern.test(result) ? result.replace(pattern, line) : `${result.trimEnd()}\n${line}\n`;
  }
  return result;
}

export async function GET(request: Request) {
  if (!isLocalRequest(request)) return Response.json({ error: "线上 API 配置需要管理员登录" }, { status: 403 });
  return Response.json({ localOnly: true, settings: publicSettings() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    if (!isLocalRequest(request)) return Response.json({ error: "线上 API 配置需要管理员登录" }, { status: 403 });
    const incoming = await request.json() as Record<string, unknown>;
    const updates: Partial<Record<SettingName, string>> = {};
    for (const name of SETTINGS) {
      if (typeof incoming[name] !== "string") continue;
      const value = incoming[name].trim();
      // Empty secret fields mean “keep the existing key”; this prevents an
      // accidental save from wiping a credential the UI cannot display.
      if (SECRET_NAMES.has(name) && !value) continue;
      updates[name] = value.slice(0, name.includes("KEY") ? 1000 : 300);
    }
    if (!Object.keys(updates).length) return Response.json({ error: "没有需要保存的配置" }, { status: 400 });

    const envPath = path.join(process.cwd(), ".env.local");
    const source = await readFile(envPath, "utf8").catch(() => "");
    const next = updateEnv(source, updates);
    const temporary = `${envPath}.tmp`;
    await writeFile(temporary, next, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, envPath);
    for (const [name, value] of Object.entries(updates)) process.env[name] = value;
    return Response.json({ saved: true, settings: publicSettings() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "API 配置保存失败" }, { status: 500 });
  }
}
