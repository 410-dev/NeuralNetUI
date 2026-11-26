import assert from "node:assert/strict";
import test from "node:test";
import { keepsSeriesSession, reusesSeriesSession } from "./series.ts";

test("periodic sessions are kept only when the interval fits in the cache lifetime with a margin", () => {
  assert.equal(keepsSeriesSession(50, 3600), true);          // 50-minute check, 60-minute cache
  assert.equal(keepsSeriesSession(59, 3600), true);
  assert.equal(keepsSeriesSession(60, 3600), false);         // hourly: the next run would land just past the TTL
  assert.equal(keepsSeriesSession(360, 3600), false);
  assert.equal(keepsSeriesSession(50, undefined), false);    // no cache information (not a routing session)
  assert.equal(keepsSeriesSession(0, 3600), false);
});

test("a kept session is reused only while its cache is still warm", () => {
  assert.equal(reusesSeriesSession(50, { remainingSeconds: 600, totalSeconds: 3600 }), true);
  assert.equal(reusesSeriesSession(50, { remainingSeconds: 3, totalSeconds: 3600 }), false);
  assert.equal(reusesSeriesSession(50, undefined), false);
  assert.equal(reusesSeriesSession(90, { remainingSeconds: 600, totalSeconds: 3600 }), false);
});
