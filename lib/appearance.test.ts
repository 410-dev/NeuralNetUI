import assert from "node:assert/strict";
import test from "node:test";
import { ACCENT_PALETTES, accentColorOf, accentVariables, normalizeAppearance, normalizeHexColor, revealStep } from "./appearance.ts";

test("hex normalization accepts short forms and rejects anything else", () => {
  assert.equal(normalizeHexColor("#ABCDEF"), "#abcdef");
  assert.equal(normalizeHexColor("abc"), "#aabbcc");
  assert.equal(normalizeHexColor("not a colour"), "#4d7fd8");
  assert.equal(normalizeHexColor(undefined, "#101010"), "#101010");
});

test("named palettes win over the stored custom colour and custom uses it", () => {
  assert.equal(accentColorOf({ accentPalette: "teal", accentColor: "#ff0000" }), ACCENT_PALETTES.find((p) => p.id === "teal")!.hex);
  assert.equal(accentColorOf({ accentPalette: "custom", accentColor: "#ff0000" }), "#ff0000");
  assert.equal(accentColorOf(undefined), "#4d7fd8");
});

test("accent variables expose channel triples and a brighter companion", () => {
  const variables = accentVariables("#4d7fd8");
  assert.equal(variables["--accent"], "#4d7fd8");
  assert.equal(variables["--accent-rgb"], "77 127 216");
  assert.match(variables["--accent-bright"], /^rgb\(\d+ \d+ \d+\)$/);
  const [, ...bright] = variables["--accent-bright"].match(/(\d+) (\d+) (\d+)/)!;
  assert.ok(bright.map(Number).reduce((sum, channel) => sum + channel, 0) > 77 + 127 + 216, "bright accent is lighter");
  // Greys have no hue to shift, so they must stay grey rather than picking up a cast.
  const grey = accentVariables("#808080");
  const [r, g, b] = grey["--accent-bright-rgb"].split(" ").map(Number);
  assert.equal(r, g); assert.equal(g, b);
});

test("chunked reveal advances by the chunk size and resynchronises on rewrites", () => {
  assert.equal(revealStep("", "hello world", 4), "hell");
  assert.equal(revealStep("hell", "hello world", 4), "hello wo");
  assert.equal(revealStep("hello world", "hello world", 4), "hello world");
  assert.equal(revealStep("", "abc", 0), "a");
  // A regenerated response no longer extends the shown prefix, so it replaces it outright.
  assert.equal(revealStep("old text", "brand new", 3), "brand new");
});

test("appearance preferences fall back to defaults and clamp the chunk size", () => {
  assert.deepEqual(normalizeAppearance(undefined), { accentPalette: "blue", accentColor: "#4d7fd8", streamReveal: "instant", streamPacing: "immediate", streamChunkSize: 3 });
  const normalized = normalizeAppearance({ accentPalette: "nope" as never, streamReveal: "fade", streamPacing: "chunked", streamChunkSize: 999 });
  assert.equal(normalized.accentPalette, "blue");
  assert.equal(normalized.streamChunkSize, 24);
  assert.equal(normalizeAppearance({ streamChunkSize: 0 } as never).streamChunkSize, 3);
});
