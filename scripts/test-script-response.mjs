import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const root = process.cwd();
const nativeRequire = createRequire(import.meta.url);
const requests = [];
let payload;
let status = 200;
const cache = new Map();
function load(file) {
  if (file.endsWith(".json")) return JSON.parse(fs.readFileSync(file, "utf8"));
  if (cache.has(file)) return cache.get(file);
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports,
    require: (name) => name.startsWith("node:") ? nativeRequire(name) : load(path.resolve(path.dirname(file), name.endsWith(".json") ? name : name + ".ts")),
    process: { env: { OPENIAPI_BASE_URL: "https://test.invalid/v1", OPENIAPI_API_KEY: "test-only" } },
    AbortController, setTimeout, clearTimeout,
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: status === 200, status, json: async () => payload };
    },
  }, { filename: file });
  cache.set(file, loadedModule.exports);
  return loadedModule.exports;
}
const provider = load(path.join(root, "app/lib/openiapi.ts"));
const run = () => provider.generateCantoneseNewsScript("這是核實新聞材料。".repeat(20));
const setContent = (content, finish_reason = "stop") => {
  payload = { choices: [{ message: { content }, finish_reason }] };
};
setContent("<think>分析</think>各位好，今天新聞。");
assert.equal((await run()).content, "各位好，今天新聞。");
setContent([{type:"text",text:"各位"},{type:"text",text:"好，今天新聞。"}]);
assert.equal((await run()).content, "各位好，今天新聞。");
setContent(null);
await assert.rejects(run, /未返回稿件正文/);
setContent("<think>各位好，這是分析。</think>");
await assert.rejects(run, /未通过正文检查/);
setContent("各位好，截斷稿", "length");
await assert.rejects(run, /长度上限/);
setContent(null, "content_filter");
await assert.rejects(run, /未能处理/);
payload = { error: { message: "模型不可用" } };
await assert.rejects(run, /模型不可用/);
status = 503;
payload = {};
await assert.rejects(run, /HTTP 503/);
status = 200;
for (const opening of ["大家好", "各位觀眾大家好", "各位观众好", "各位聽眾好", "各 位好"]) {
  setContent(`${opening}，今天新聞。`);
  await assert.rejects(run, /没有可识别的主播开场/);
}
setContent("# 本期口播稿\n\n**各位好**，今天新聞。");
assert.equal((await run()).content, "各位好，今天新聞。");
setContent("建議你以「各位好」開始，然後整理材料。");
await assert.rejects(run, /没有可识别的主播开场/);
setContent("<think>各位好，這些是推理內容。");
await assert.rejects(run, /过滤分析标签后没有可用正文/);
const body = "今天是2026年9月10日，歡迎收看由國泰航空特約呈現的《點觀香港》，我是梁正言。" + "新聞正文由材料支持。".repeat(12) + "我們明天再見！";
setContent(body);
await assert.rejects(run, /没有可识别的主播开场/);
setContent("今天是2026年9月10日，資料不足，無法寫稿。".repeat(5));
await assert.rejects(run, /没有可识别的主播开场/);
assert.equal(requests.length, 18, "No automatic retries");
console.log("PASS: fixed greeting accepted, alternate/missing greetings rejected, reasoning/refusal rejection, response errors, no retries.");
