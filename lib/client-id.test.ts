import assert from "node:assert/strict";
import test from "node:test";

import { createClientId } from "./client-id.ts";

test("uses Web Crypto UUIDs when the browser exposes them", () => {
  const id = createClientId("message", {
    randomUUID: () => "123e4567-e89b-12d3-a456-426614174000",
    now: () => 0,
    random: () => 0,
  });

  assert.equal(id, "message-123e4567-e89b-12d3-a456-426614174000");
});

test("falls back to unique IDs when Web Crypto is unavailable over HTTP", () => {
  const source = { randomUUID: undefined, now: () => 1_800_000_000_000, random: () => 0 };
  const first = createClientId("conversation", source);
  const second = createClientId("conversation", source);

  assert.match(first, /^conversation-[a-z0-9-]+$/);
  assert.match(second, /^conversation-[a-z0-9-]+$/);
  assert.notEqual(first, second);
});
