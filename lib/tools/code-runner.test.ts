import assert from "node:assert/strict";
import test from "node:test";
import { builtinToolProvider } from "./catalog.ts";
import { MAX_CODE_CHARS, MAX_OUTPUT_CHARS, normalizeCodeRunResult, readCodeRunRequest } from "./code-runner.ts";
import { resolveProviderState, DEFAULT_TOOL_STATE } from "./state.ts";

test("browser reports keep known fields and are bounded before reaching the model", () => {
  const long = "x".repeat(MAX_OUTPUT_CHARS + 50);
  const result = normalizeCodeRunResult({ stdout: long, stderr: 3, result: 42, durationMs: 12.7, extra: "dropped" }, "javascript");
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.match(result.stdout, /Output truncated/);
  assert.equal(result.stderr, "3");
  assert.equal(result.result, "42");
  assert.equal(result.durationMs, 13);
  assert.equal("extra" in result, false);
});

test("errors, timeouts and junk reports are not reported as success", () => {
  assert.deepEqual(normalizeCodeRunResult({ error: "ZeroDivisionError", stdout: "" }, "python"), { language: "python", ok: false, stdout: "", stderr: "", error: "ZeroDivisionError" });
  assert.equal(normalizeCodeRunResult({ timedOut: true, error: "Stopped" }, "javascript").timedOut, true);
  assert.deepEqual(normalizeCodeRunResult("nonsense", "javascript"), { language: "javascript", ok: true, stdout: "", stderr: "" });
});

test("the browser only runs well-formed requests recorded by the server", () => {
  assert.deepEqual(readCodeRunRequest({ language: "python", code: "print(1)", timeoutSeconds: 45 }), { language: "python", code: "print(1)", timeoutSeconds: 45 });
  assert.equal(readCodeRunRequest({ language: "ruby", code: "puts 1" }), undefined);
  assert.equal(readCodeRunRequest({ language: "javascript", code: "   " }), undefined);
  assert.equal(readCodeRunRequest({ language: "javascript", code: "1", timeoutSeconds: 9999 })?.timeoutSeconds, 300);
  assert.equal(readCodeRunRequest({ language: "javascript", code: "x".repeat(MAX_CODE_CHARS + 10) })?.code.length, MAX_CODE_CHARS);
});

test("the code runner is an agent tool that starts switched off with a bounded time limit", () => {
  const manifest = builtinToolProvider("code-runner")!;
  assert.equal(manifest.section, "agent");
  assert.deepEqual(manifest.functions.map(fn => fn.name), ["run_javascript", "run_python"]);
  assert.deepEqual(resolveProviderState(DEFAULT_TOOL_STATE, manifest), { enabled: false, options: { timeoutSeconds: 30 }, functions: undefined });
  // "browser" is the Obscura headless browser now, not the removed Chromium agent tool.
  const browser = builtinToolProvider("browser")!;
  assert.equal(browser.section, "internet");
  assert.deepEqual(browser.requires, { managed: "browser" });
});
