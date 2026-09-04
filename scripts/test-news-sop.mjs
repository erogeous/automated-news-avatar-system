import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const requests = [];
const cache = new Map();
function load(file) {
  if (file.endsWith(".json")) return JSON.parse(fs.readFileSync(file, "utf8"));
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (name) => load(path.resolve(path.dirname(file), name.endsWith(".json") ? name : name + ".ts")),
    process: { env: { OPENIAPI_BASE_URL: "https://test.invalid/v1", OPENIAPI_API_KEY: "test-only" } },
    AbortController, setTimeout, clearTimeout,
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: "各位好，這是測試稿。" } }] }) };
    },
  }, { filename: file });
  cache.set(file, module.exports);
  return module.exports;
}
const sop = load(path.join(root, "app/lib/news-script-sop.ts"));
const original = load(path.join(root, "app/lib/news-script-sop-v4-3.json"));
assert.equal(sop.NEWS_SCRIPT_SOP.version, "V4.3");
assert.ok(sop.NEWS_SCRIPT_SOP_PROMPT.includes(original.text));
assert.ok(original.text.includes("十、交稿前20問"));
assert.ok(original.text.includes("十二、文件命名規則"));
const provider = load(path.join(root, "app/lib/openiapi.ts"));
for (let i = 0; i < 2; i++) {
  const result = await provider.generateCantoneseNewsScript("這是本期核實後的新聞材料。".repeat(20), {
    anchorName: "林嘉晴", writingRequirements: "本期主稿優先，副題簡短。",
  });
  assert.equal(result.sop.version, "V4.3");
  const system = requests[i].messages[0].content;
  assert.ok(system.includes(original.text), "Every request must contain the complete SOP");
  assert.ok(system.indexOf("本期主稿優先") < system.indexOf("【SOP V4.3 完整原文】"));
  assert.ok(system.includes("不是本期新聞事實"));
  assert.ok(!system.includes("外部知识、推测、评价"));
}
await provider.convertApprovedScriptToCantonese({
  script: "各位好，今天的新聞內容已由編輯確認。".repeat(10),
  anchorName: "林嘉晴", airDate: "2026年9月3日星期四", farewell: "明天再見",
});
assert.ok(requests[2].messages[0].content.includes("不得新增、刪減、重排"));
const custom={id:"test",name:"测试规则",version:"V9.1",text:"规则全文：每条新闻都要核对来源，不可使用示例作为事实。"};
const customResult=await provider.generateCantoneseNewsScript("已核实的新闻资料。".repeat(20),{sopDocument:custom});
assert.ok(requests[3].messages[0].content.includes(custom.text));
assert.ok(!requests[3].messages[0].content.includes(original.text));
assert.equal(customResult.sop.version,"V9.1");
assert.equal(customResult.sopSnapshot.text,custom.text);
console.log("PASS: full V4.3 per request, human priority, example isolation, unchanged approval/conversion boundary. No external model calls.");
