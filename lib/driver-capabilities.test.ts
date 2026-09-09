import assert from "node:assert/strict";
import test from "node:test";
import { capabilityStateWord, capabilitySummary, driverCapabilities } from "./driver-capabilities.ts";
import type { ConnectionDriver, Locale } from "./types.ts";

test("every capability is answered for both drivers in both languages", () => {
  for (const driver of ["openai", "lmstudio"] as ConnectionDriver[]) {
    for (const locale of ["en", "ko"] as Locale[]) {
      const rows = driverCapabilities(driver, locale);
      assert.equal(rows.length, 5, `${driver}/${locale}`);
      assert.equal(new Set(rows.map((row) => row.id)).size, 5);
      for (const row of rows) {
        assert.ok(row.label.trim(), `${row.id} has a label`);
        assert.ok(["yes", "partial", "no"].includes(row.state));
      }
    }
  }
  assert.notDeepEqual(driverCapabilities("openai", "en").map((r) => r.label), driverCapabilities("openai", "ko").map((r) => r.label));
});

test("LM Studio manages models natively while OpenAI-compatible connections are limited", () => {
  const native = driverCapabilities("lmstudio", "en");
  const compatible = driverCapabilities("openai", "en");
  assert.equal(native.find((row) => row.id === "management")!.state, "yes");
  assert.equal(compatible.find((row) => row.id === "management")!.state, "partial");
});

test("progress for OpenAI-compatible connections depends on the experimental switch", () => {
  assert.equal(driverCapabilities("openai", "en").find((row) => row.id === "progress")!.state, "no");
  assert.equal(driverCapabilities("openai", "en", { openAIProgress: true }).find((row) => row.id === "progress")!.state, "partial");
  // The native driver reports progress on its own, and the switch does not change that.
  for (const openAIProgress of [false, true]) {
    assert.equal(driverCapabilities("lmstudio", "en", { openAIProgress }).find((row) => row.id === "progress")!.state, "partial");
  }
});

test("the caveat behind a limited answer is spelled out", () => {
  const progress = driverCapabilities("lmstudio", "ko").find((row) => row.id === "progress")!;
  assert.match(progress.detail || "", /추론 강도/);
  assert.equal(capabilityStateWord("no", "ko"), "미지원");
  assert.equal(capabilityStateWord("yes", "en"), "Supported");
});

test("the summary states every capability for readers who cannot hover", () => {
  const rows = driverCapabilities("openai", "en");
  const summary = capabilitySummary(rows, "en");
  for (const row of rows) assert.ok(summary.includes(row.label), `${row.id} appears in the summary`);
  assert.ok(summary.includes("Not supported"));
});
