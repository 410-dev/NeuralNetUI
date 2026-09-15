import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("Windows installer suppresses system restarts", async () => {
  const source = await readFile(path.join(process.cwd(), "installer", "Product.wxs"), "utf8");
  assert.match(source, /<Property Id="REBOOT" Value="ReallySuppress" Secure="yes"\s*\/>/);
  assert.match(source, /<Property Id="REBOOTPROMPT" Value="Suppress" Secure="yes"\s*\/>/);
  assert.doesNotMatch(source, /<(?:ForceReboot|ScheduleReboot)\b/);
});
