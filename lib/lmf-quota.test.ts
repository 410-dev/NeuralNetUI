import assert from "node:assert/strict";
import test from "node:test";
import { foldedQuotaWindows, quotaPressure } from "./lmf-quota.ts";

const w = (windowSeconds: number | undefined, usedPercent: number, thresholdPercent?: number) => ({ windowSeconds, usedPercent, thresholdPercent });

test("windows run short to long and the folded one is closest to its routing limit", () => {
  // 5h 11% of 75%, 7d 59% of 70%: the week is the tight one; the 5-hour window opens above it
  const week = foldedQuotaWindows([w(604800, 59, 70), w(18000, 11, 75)]);
  assert.deepEqual(week.ordered.map(item => item.windowSeconds), [18000, 604800]);
  assert.equal(week.primary, 1);
  // 5h nearly spent, week plenty left: the short one is shown and the week opens below
  const hour = foldedQuotaWindows([w(604800, 10, 70), w(18000, 70, 75)]);
  assert.equal(hour.primary, 0);
  // unknown lengths go last; without a threshold 100% is the limit
  assert.deepEqual(foldedQuotaWindows([w(undefined, 1), w(3600, 2)]).ordered.map(item => item.windowSeconds), [3600, undefined]);
  assert.equal(quotaPressure(w(1, 50)), 50);
  assert.equal(quotaPressure(w(1, 35, 70)), 50);
});
