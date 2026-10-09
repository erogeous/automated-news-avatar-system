import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
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
    require: (name) => name === "node:dns"
      ? { setDefaultResultOrder: () => {} }
      : load(path.resolve(path.dirname(file), name.endsWith(".json") ? name : name + ".ts")),
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
const sop = load(path.join(root, "app/lib/cantonese-conversion-sop.ts"));
const document = JSON.parse(fs.readFileSync("app/lib/cantonese-conversion-sop-v1-1.json", "utf8"));
const source = "各位好，今天是2026年9月8日，AI計劃持續8日，涉及98%和100萬元。" + "這是已確認的新聞事實，信源和專業名詞必須保留。".repeat(5);
const converted = source.replace("今天", "今日").replace("9月8日", "9月8號");
const run = () => provider.convertApprovedScriptToCantonese({script:source,anchorName:"梁正言",airDate:"2026年9月9日",farewell:"明天再見"});
function respond(content) { payload = {choices:[{message:{content},finish_reason:"stop"}]}; }
respond(converted);
const result = await run();
assert.equal(result.content, converted, "Do not mechanically add pauses to long text");
assert.equal(result.conversionSop.version, "V1.1");
assert.ok(requests[0].messages[0].content.includes(document.text), "Complete SOP including tables in each conversion");
assert.ok(!requests[0].messages[1].content.includes("指定結尾"), "Do not override an approved broadcast date/farewell");
assert.ok(sop.CANTONESE_CONVERSION_PROMPT.includes("不可杜撰音標"));
assert.ok(document.text.includes("十六、參考資料"));
assert.ok(document.text.includes("https://www.ccli.gov.hk/tc/download/canton_pronun_list.html"));
assert.ok(document.text.includes("0.30–0.45 秒"), "Retain source recommendations verbatim");
assert.ok(sop.CANTONESE_CONVERSION_PROMPT.includes("不使用人工秒數停頓"));
assert.ok(sop.CANTONESE_CONVERSION_PROMPT.includes("不得輸出 <#0.15#>"));
assert.ok(sop.CANTONESE_CONVERSION_PROMPT.includes("整篇語速固定 1.08、音量 2"));
assert.ok(sop.CANTONESE_CONVERSION_PROMPT.includes("不得聲稱已查閱外部網站"));
assert.equal(result.conversionSop.sha256, document.sha256);
respond(converted.replace("98%", "99%"));
assert.equal(JSON.stringify((await run()).validation), JSON.stringify({ factsPreserved: false, missingFacts: ["98%"] }));
respond(converted.replace("持續8日", "持續8號"));
assert.equal((await run()).validation.factsPreserved, false);
respond(converted.replace("AI", "APP"));
assert.equal(JSON.stringify((await run()).validation), JSON.stringify({ factsPreserved: false, missingFacts: ["AI"] }));
respond(converted.replace("各位好，", "各位好，<#0.3#><#0.15#>"));
assert.equal((await run()).content, converted, "Remove pauses stacked after punctuation");
respond("各位好，這是母稿。");
await provider.generateCantoneseNewsScript(source);
assert.ok(!requests.at(-1).messages[0].content.includes(document.text), "Conversion SOP must never enter manuscript writing");
assert.equal(requests.length, 6, "No automatic model retries");
console.log("PASS: full conversion-only SOP, date equivalence, changed facts reported for review, semantic pauses, version metadata.");

const dateSource = '各位好，李家超在17日出席會議，計劃持續17日。' + '這是已確認的新聞資料。'.repeat(12);
const runDate = () => provider.convertApprovedScriptToCantonese({script:dateSource,anchorName:'梁正言',airDate:'2026年9月22日',farewell:'明天再見'});
respond(dateSource.replace('在17日', '喺17號'));
await runDate();
respond(dateSource.replace('在17日', '喺18號'));
assert.equal((await runDate()).validation.factsPreserved, false);
respond(dateSource.replace('持續17日', '持續17號'));
assert.equal((await runDate()).validation.factsPreserved, false);
respond(dateSource.replace('在17日', ''));
assert.equal((await runDate()).validation.factsPreserved, false);
console.log('PASS: contextual abbreviated dates accepted; changed dates, omitted dates and corrupted durations reported.');

const rangeSource = '各位好，高鐵香港段於9月23日至27日加強服務，活動開放至9月27日，工程持續27日。' + '這是已確認的新聞資料。'.repeat(10);
const runRange = () => provider.convertApprovedScriptToCantonese({script:rangeSource,anchorName:'梁正言',airDate:'2026年9月22日',farewell:'明天再見'});
respond(rangeSource.replace('9月23日至27日', '9月23號至27號').replace('9月27日', '9月27號'));
await runRange();
respond(rangeSource.replace('9月23日至27日', '9月23號至28號').replace('9月27日', '9月27號'));
assert.equal((await runRange()).validation.factsPreserved, false);
respond(rangeSource.replace('工程持續27日', '工程持續27號'));
assert.equal((await runRange()).validation.factsPreserved, false);
console.log('PASS: same-month Cantonese date ranges accepted; changed range dates and corrupted durations reported.');
