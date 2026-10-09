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
const context = {airDate:"今天是2026年9月9日星期三",anchorName:"梁正言",farewell:"明天再見"};
const opening = "各位好，今天是2026年9月9日星期三，歡迎收看由國泰航空特約呈現的《點觀香港》，我是數字人主播梁正言。今天我們先來關注本期新聞。";
const closing = "以上就是今天《點觀香港》的全部內容，本節目由國泰航空特約呈現，更多新聞請關注點新聞網和點新聞APP，我們明天再見！";
const manuscript = opening + "\n\n本期新聞正文。\n\n" + closing;
const run = (ctx=context) => provider.generateCantoneseNewsScript("已核實的新聞材料。".repeat(20),ctx);
function respond(content){payload={choices:[{message:{content},finish_reason:"stop"}]};}
respond("《點觀香港》2026年9月9日最終稿\n"+manuscript);
assert.equal((await run()).content,manuscript,"Remove file title; preserve exact manuscript paragraphs");
for(const changed of [manuscript.replace("數字人主播","主播"),manuscript.replace("國泰航空特約呈現","贊助"),manuscript.replace("9月9日","9月10日"),manuscript.replace("梁正言","林嘉晴"),manuscript.replace("今天我們先來關注","接下來")]){
 respond(changed);await assert.rejects(run,/固定开场格式/);
}
respond(manuscript.replace("明天再見","下周再見"));await assert.rejects(run,/固定结尾格式/);
const friday={airDate:"今天是2026年9月11日星期五",anchorName:"林嘉晴",farewell:"下周再見"};
const updated=manuscript.replace("9月9日星期三","9月11日星期五").replace("梁正言","林嘉晴").replace("明天再見","下周再見");
respond(updated);assert.equal((await run(friday)).content,updated);
assert.ok(requests.at(-1).messages[0].content.includes("我是數字人主播林嘉晴。"));
console.log("PASS: reference format, title excluded, full opening/closing validation, scheduled date/anchor/farewell.");
