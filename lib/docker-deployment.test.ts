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

test("Linux netsync deployment shares the host loopback network", () => {
  const compose = readFileSync(new URL("../docker-compose.netsync.yml", import.meta.url), "utf8");
  const script = readFileSync(new URL("../deploy-docker-linux-netsync.sh", import.meta.url), "utf8");

  assert.match(compose, /^\s*network_mode:\s*host\s*$/m);
  assert.doesNotMatch(compose, /^\s*ports:\s*$/m, "host networking must not publish duplicate ports");
  assert.match(compose, /PORT:\s*"\$\{NEURAL_CHAT_PORT:-3000\}"/);
  assert.match(compose, /process\.env\.PORT/);
  assert.match(script, /docker compose -f docker-compose\.netsync\.yml up --detach --build --remove-orphans/);
  assert.match(script, /http:\/\/localhost:\$\{NEURAL_CHAT_RELAY_PORT\}/);
});
