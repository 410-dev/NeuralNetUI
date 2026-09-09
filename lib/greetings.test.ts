import assert from "node:assert/strict";
import test from "node:test";
import { greetingFor, greetingsFor, timeBandFor } from "./greetings.ts";
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

test("a greeting is stable within a day and rotates across days", () => {
  const morning = new Date(2026, 8, 9, 8, 0, 0);
  const later = new Date(2026, 8, 9, 10, 30, 0);
  assert.equal(greetingFor("ko", "호윤", morning), greetingFor("ko", "호윤", later));
  assert.ok(greetingFor("ko", "호윤", morning).includes("호윤"));
  assert.ok(!greetingFor("en", "Hoyoun", morning).includes("{name}"));
  const seen = new Set<string>();
  for (let day = 0; day < 5; day++) seen.add(greetingFor("en", "Hoyoun", new Date(2026, 8, 9 + day, 8, 0, 0)));
  assert.equal(seen.size, 5, "five consecutive days use all five morning greetings");
});

test("the band changes the greeting at the same time of day", () => {
  const day = 12;
  const bands = new Set([2, 5, 8, 12, 15, 19, 22].map((hour) => greetingFor("ko", "호윤", new Date(2026, 8, day, hour, 0, 0))));
  assert.equal(bands.size, 7, "each band produced its own line");
});
