import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

async function scenario({ stage, delayedSeconds, networkError = false }) {
  const timers = new Map();
  let time = 0, seq = 0, calls = 0;
  const schedule = (fn, ms) => { const id = ++seq; timers.set(id, { at: time + ms, fn }); return id; };
  const wait = (signal) => new Promise((resolve, reject) => {
    const id = schedule(resolve, delayedSeconds * 1000);
    signal.addEventListener("abort", () => {
      timers.delete(id);
      reject(new Error("The operation was aborted"));
    }, { once: true });
  });
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
      AbortController, setTimeout: schedule, clearTimeout: (id) => timers.delete(id),
      fetch: async (_url, options) => {
        calls++;
        if (networkError) throw new Error("network failure");
        if (stage === "headers") await wait(options.signal);
        return { ok: true, json: async () => {
          if (stage === "body") await wait(options.signal);
          return { choices: [{ message: { content: "各位好，這是測試稿。" } }] };
        } };
      },
    });
    cache.set(file, module.exports);
    return module.exports;
  }
  const provider = load(path.resolve("app/lib/openiapi.ts"));
  let settled = false, result, error;
  provider.convertApprovedScriptToCantonese({
    script: "各位好，這是已確認稿件。".repeat(20), anchorName: "林嘉晴", airDate: "2026年9月3日", farewell: "明天再見",
  }).then((v) => { result = v; settled = true; }, (e) => { error = e; settled = true; });
  for (let turn = 0; turn < 20 && !settled; turn++) {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    if (settled) break;
    const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (next) { timers.delete(next[0]); time = next[1].at; next[1].fn(); }
  }
  assert.ok(settled);
  assert.equal(calls, 1, "No automatic paid retries");
  assert.equal(timers.size, 0, "Timers cleaned up on success and failure");
  return { result, error, time };
}
for (const stage of ["headers", "body"]) {
  const success = await scenario({ stage, delayedSeconds: 120 });
  assert.equal(success.error, undefined);
  assert.ok(success.result.content.startsWith("各位好"));
  const timeout = await scenario({ stage, delayedSeconds: 200 });
  assert.equal(timeout.time, 180000);
  assert.match(timeout.error.message, /粤语转写.*180秒.*尚未开始配音/);
}
const failure = await scenario({ networkError: true });
assert.equal(failure.error.message, "network failure");
console.log("PASS: 120s header/body responses succeed; 180s deadlines have stage-specific errors; cleanup and no retries verified (mock only).");
