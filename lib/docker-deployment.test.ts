import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Docker excludes the host Python environment from the build context", () => {
  const entries = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith("#"));

  assert.ok(
    entries.includes(".python") || entries.includes(".python/"),
    ".python must stay outside the Docker context because virtualenv symlinks can escape the build root",
  );
});
