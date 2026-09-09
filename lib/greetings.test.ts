import assert from "node:assert/strict";
import test from "node:test";
import { greetingFor, greetingsFor, timeBandFor, normalizeGreetings } from "./greetings.ts";
import type { Locale } from "./types.ts";
import type { TimeBand } from "./greetings.ts";

const BANDS: TimeBand[] = ["earlyDawn", "morning", "midday", "afternoon", "evening", "night", "lateNight"];

test("every hour of the day maps to exactly one band, wrapping past midnight", () => {
  const expected: Array<[number, TimeBand]> = [
    [0, "lateNight"], [3, "lateNight"], [4, "earlyDawn"], [5, "earlyDawn"], [6, "morning"], [10, "morning"],
    [11, "midday"], [13, "midday"], [14, "afternoon"], [16, "afternoon"], [17, "evening"], [20, "evening"],
    [21, "night"], [22, "night"], [23, "lateNight"],
  ];
  for (const [hour, band] of expected) assert.equal(timeBandFor(hour), band, `hour ${hour}`);
  for (let hour = 0; hour < 24; hour++) assert.ok(BANDS.includes(timeBandFor(hour)), `hour ${hour} is covered`);
  // Out-of-range hours normalise rather than falling through to a default.
  assert.equal(timeBandFor(24), timeBandFor(0));
  assert.equal(timeBandFor(-1), timeBandFor(23));
});

test("each band offers five distinct greetings in both languages", () => {
  for (const locale of ["ko", "en"] as Locale[]) {
    for (const band of BANDS) {
      const options = greetingsFor(locale, band);
      assert.equal(options.length, 5, `${locale}/${band}`);
      assert.equal(new Set(options).size, 5, `${locale}/${band} duplicates`);
      for (const option of options) assert.ok(option.includes("{name}"), `${locale}/${band} keeps the name slot`);
    }
  }
});

test("visits choose randomly and exclude the previous greeting", () => {
  const at = new Date(2026, 8, 9, 8);
  const first = greetingFor("ko", "호윤", at, { random: () => 0 });
  assert.notEqual(first, greetingFor("ko", "호윤", at, { previous: first, random: () => 0 }));
  assert.equal(new Set([0, .2, .4, .6, .8].map(value => greetingFor("en", "Name", at, { random: () => value }))).size, 5);
});

test("custom greetings replace all name slots and fall back on blanks in the active language", () => {
  const at = new Date(2026, 8, 9, 8);
  const overrides = { ko: { morning: ["{name}님, {name}님!", ""] } };
  assert.equal(greetingFor("ko", "호윤", at, { overrides, random: () => 0 }), "호윤님, 호윤님!");
  assert.equal(greetingFor("ko", "호윤", at, { overrides, random: () => .2 }), greetingsFor("ko", "morning")[1].replaceAll("{name}", "호윤"));
  assert.equal(greetingFor("en", "Name", at, { overrides, random: () => 0 }), "Good morning, Name.");
  assert.equal(greetingFor("ko", "호윤", at, { overrides: { ko: { morning: Array(5).fill("same") } }, previous: "same" }), "same");
});

test("the band changes the greeting at the same time of day", () => {
  const day = 12;
  const bands = new Set([2, 5, 8, 12, 15, 19, 22].map((hour) => greetingFor("ko", "호윤", new Date(2026, 8, day, hour, 0, 0))));
  assert.equal(bands.size, 7, "each band produced its own line");
});

test("stored greeting overrides are bounded and ignore malformed or unknown entries", () => {
  assert.deepEqual(normalizeGreetings(null), {});
  assert.deepEqual(normalizeGreetings({ ko: { morning: ["  hello  ", 42, null, "", "x".repeat(201), "extra"], invalid: ["x"] }, bad: {} }), { ko: { morning: ["hello", "", "", "", "x".repeat(200)] } });
});
