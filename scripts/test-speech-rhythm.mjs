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
const rhythm = load(path.join(root, "app/lib/speech-rhythm.ts"));
for (const [source, expected] of [
 ["各位好，<#0.15#>今日新聞。", "各位好，今日新聞。"],
 ["介紹。<#0.3#><#0.15#>下一題", "介紹。下一題"],
 ["佢話：「今日公布。」<#0.15#>下一題", "佢話：「今日公布。」下一題"],
 ["第一段。\n\n<#0.15#>第二段。", "第一段。\n\n第二段。"],
 ["各位好<#0.15#>，今日新聞。", "各位好，今日新聞。"],
 ["原因係<#0.3#><#0.15#>資料未齊", "原因係資料未齊"],
 ["<#0.15#>各位好。<#0.15#>", "各位好。"],
]) assert.equal(rhythm.normalizeSpeechPauses(source), expected);
const provider = load(path.join(root, "app/lib/openiapi.ts"));
payload = {base_resp:{status_code:0}, data:{audio:"00ff"},extra_info:{audio_length:100}};
await provider.synthesizeCantoneseSpeech({text:"各位好，<#0.15#>今日新聞。",voiceId:"male-qn-qingse"});
assert.equal(requests[0].voice_setting.speed,1.08);
assert.equal(requests[0].voice_setting.vol,2);
assert.equal(requests[0].text,"各位好，今日新聞。");
await provider.synthesizeCantoneseSpeech({text:"各位好",voiceId:"male-qn-qingse",speed:1.05});
assert.equal(requests[1].voice_setting.speed,1.05);
console.log("PASS: punctuation/newlines preserved, artificial pauses removed, TTS default speed 1.08, volume 2 and explicit speed respected.");

const original = '各位好，今日係2026 年<#0.3#>9 月\n11 日 星期 五，歡迎收看《點觀香港》。佢話：「今日公布！」';
const expected = '各位好，今日係2026年9月11日星期五，歡迎收看點觀香港。佢話：今日公布！';
assert.equal(rhythm.prepareSpeechText(original), expected);
assert.equal(rhythm.prepareSpeechText('二〇二六年 九月 十一日 星期五'), '二〇二六年九月十一日星期五');
assert.equal(rhythm.prepareSpeechText('9月11日，星期五。\n下一段？'), '9月11日星期五。\n下一段？');
assert.equal(rhythm.prepareSpeechText('《<#0.15#>點觀香港<#0.15#>》與“新聞”及「消息」。'), '點觀香港與新聞及消息。');
assert.equal(rhythm.prepareSpeechText("don't stop。"), "don't stop。");
await provider.synthesizeCantoneseSpeech({text:original,voiceId:'male-qn-qingse'});
assert.equal(requests[2].text, expected);
assert.equal(requests[2].voice_setting.speed, 1.08);
assert.equal(requests[2].voice_setting.vol, 2);
assert.ok(original.includes('《點觀香港》'));
assert.equal(rhythm.prepareSpeechText(expected), expected);
assert.equal(rhythm.prepareSpeechText('2026年9月22號，星期二，歡迎收睇。'), '2026年9月22號星期二，歡迎收睇。');
console.log('PASS: TTS request joins dates, removes editorial marks, preserves semantic punctuation and source text.');

assert.equal(rhythm.prepareSpeechText('閱讀《香港公共交通政策與城市發展研究》。'), '閱讀香港公共交通政策與城市發展研究。');
assert.equal(rhythm.prepareSpeechText('佢話：「唔好走！」然後離開。'), '佢話：唔好走！然後離開。');
assert.equal(rhythm.prepareSpeechText('《短書名》與《未知名稱》'), '短書名與未知名稱');
const conversion = load(path.join(root, 'app/lib/cantonese-conversion-sop.ts'));
assert.ok(conversion.CANTONESE_CONVERSION_PROMPT.includes(rhythm.SPEECH_CONTINUITY_RULES));
console.log('PASS: semantic rules reach conversion model; editorial marks do not create extra TTS pauses.');
