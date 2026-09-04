import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export const libraryRoot = path.resolve(process.env.STUDIO_LIBRARY_DIR || ".studio-library");
export const validId = (id) => typeof id === "string" && /^[a-f0-9]{32}$/.test(id);
export const newId = () => randomBytes(16).toString("hex");
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + newId() + ".tmp";
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, file);
}
export async function idsAt(dir) {
  try { return (await readdir(dir)).filter(validId); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
let writeQueue = Promise.resolve();
export function exclusive(fn) {
  const result = writeQueue.then(fn);
  writeQueue = result.catch(() => {});
  return result;
}

// Read just document.xml, with bounded ZIP expansion; never execute macros or external relationships.
export function parseSop(bytes, name) {
  let text;
  if (/\.docx$/i.test(name)) {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw fail("DOCX 文件不完整，无法读取");
    const count = bytes.readUInt16LE(end + 10);
    let pos = bytes.readUInt32LE(end + 16), xml = "";
    if (count > 2000) throw fail("DOCX 内部文件过多");
    for (let i = 0; i < count; i++) {
      if (pos + 46 > bytes.length || bytes.readUInt32LE(pos) !== 0x02014b50) throw fail("DOCX 目录损坏");
      const flags = bytes.readUInt16LE(pos + 8), method = bytes.readUInt16LE(pos + 10);
      const packed = bytes.readUInt32LE(pos + 20), unpacked = bytes.readUInt32LE(pos + 24);
      const n = bytes.readUInt16LE(pos + 28), extra = bytes.readUInt16LE(pos + 30), comment = bytes.readUInt16LE(pos + 32);
      const offset = bytes.readUInt32LE(pos + 42);
      const entry = bytes.subarray(pos + 46, pos + 46 + n).toString();
      if (entry === "word/document.xml") {
        if (flags & 1 || unpacked > 2_000_000) throw fail("不支持加密或过大的 DOCX 正文");
        if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw fail("DOCX 正文损坏");
        const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
        if (start + packed > bytes.length) throw fail("DOCX 正文不完整");
        const content = bytes.subarray(start, start + packed);
        const raw = method === 0 ? content : method === 8 ? inflateRawSync(content, { maxOutputLength: 2_000_000 }) : null;
        if (!raw) throw fail("不支持此 DOCX 压缩格式");
        xml = raw.toString("utf8");
      }
      pos += 46 + n + extra + comment;
    }
    if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw fail("DOCX 缺少可读取的安全正文");
    text = [...xml.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, "").matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<\/w:p>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g)]
      .map((m) => m[1] === undefined ? "\n" : m[1]).join("");
    text = text.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (_, num, named) => {
      if (num) { const code = num[0].toLowerCase() === "x" ? parseInt(num.slice(1), 16) : Number(num); return code <= 0x10ffff ? String.fromCodePoint(code) : ""; }
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named.toLowerCase()];
    });
  } else if (/\.(txt|md)$/i.test(name)) {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } else throw fail("仅支持 DOCX、UTF-8 TXT 和 Markdown");
  text = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 30 || text.length > 50_000) throw fail("规则正文需为30至50000字符，请检查解析内容");
  return text;
}

export async function builtinSop() {
  const source = await readJson(path.resolve("app/lib/news-script-sop-v4-3.json"));
  return { id: "builtin-v4-3", name: source.source, version: "V4.3", text: source.text, createdAt: 0 };
}
export async function activeSop() {
  try {
    const active = await readJson(path.join(libraryRoot, "sops", "active.json"));
    if (active.id === "builtin-v4-3") return builtinSop();
    if (!validId(active.id)) throw fail("启用的 SOP 编号无效", 500);
    return readJson(path.join(libraryRoot, "sops", active.id, "record.json"));
  } catch (error) {
    // Only a missing active pointer means first use; a missing selected version is an error.
    if (error.code === "ENOENT" && error.path === path.join(libraryRoot, "sops", "active.json")) return builtinSop();
    throw error;
  }
}

const snapshotKeys = ["step","urls","script","manuscript","projectName","anchorId","writingRequirements","scriptModel","scriptSop","sopSnapshot","newsArticles","newsMedia","selectedMediaIds","sceneSettings","outputLayout","chromaSimilarity","chromaBlend","avatarX","avatarY","avatarHeight","sceneX","sceneY","sceneWidth","voiceDuration","audioSlices","audioSliceJobId","selectedSliceIds","avatarSliceJobs","packagingAssetIds","avatarJobId","avatarStatus","avatarProgress","videoUrl","voiceReady","videoReady","compositionJobId","compositionStatus","compositionProgress","compositionUrl","mediaDownloads"];
export async function saveProject(body) {
  if (!validId(body.id)) throw fail("项目编号无效");
  if (!body.snapshot || typeof body.snapshot !== "object") throw fail("缺少项目内容");
  const snapshot = Object.fromEntries(snapshotKeys.filter((k) => k in body.snapshot).map((k) => [k, body.snapshot[k]]));
  if (typeof snapshot.projectName !== "string" || snapshot.projectName.length > 200) throw fail("项目名称过长或无效");
  if (snapshot.script !== undefined && typeof snapshot.script !== "string") throw fail("稿件格式无效");
  const file = path.join(libraryRoot, "projects", body.id, "record.json");
  return exclusive(async () => {
    let previous;
    try { previous = await readJson(file); } catch (e) { if (e.code !== "ENOENT") throw e; }
    if ((previous?.revision || 0) !== body.expectedRevision) throw fail("此项目已在其他页面更新，请打开历史库重新载入，避免覆盖。", 409);
    const revision = (previous?.revision || 0) + 1;
    const record = { id: body.id, revision, name: snapshot.projectName, anchorId: snapshot.anchorId, createdAt: previous?.createdAt || Date.now(), updatedAt: Date.now(), snapshot };
    await atomicJson(path.join(libraryRoot, "projects", body.id, "versions", String(revision) + ".json"), record);
    await atomicJson(file, record);
    return { id: body.id, revision, updatedAt: record.updatedAt };
  });
}
