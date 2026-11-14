import assert from "node:assert/strict";
import test from "node:test";
import { chooseEndpoint, connectionEndpoints, endpointLoad, routeConnection } from "./connection-routing.ts";
import type { ConnectionConfig } from "./types.ts";

const idle = { active: 0, inputTokens: 0, outputTokens: 0 };

test("addresses come primary first, without blanks or duplicates", () => {
  assert.deepEqual(connectionEndpoints({ baseUrl: "http://a/v1", backupUrls: ["", " http://b/v1 ", "http://a/v1/", "http://c/v1"] }), ["http://a/v1", "http://b/v1", "http://c/v1"]);
  assert.deepEqual(connectionEndpoints({ baseUrl: "http://a/v1" }), ["http://a/v1"]);
});

test("all online picks the idle address with the fewest tokens; otherwise the first online in order", () => {
  assert.equal(chooseEndpoint(["online", "online", "online"], [{ active: 1, inputTokens: 0, outputTokens: 0 }, { ...idle, inputTokens: 900 }, { ...idle, inputTokens: 100, outputTokens: 50 }]), 2);
  assert.equal(chooseEndpoint(["online", "online"], [{ ...idle, inputTokens: 5 }, { ...idle, inputTokens: 5 }]), 0);
  assert.equal(chooseEndpoint(["online", "online"], [{ active: 2, inputTokens: 0, outputTokens: 0 }, { active: 1, inputTokens: 999, outputTokens: 0 }]), 1);
  assert.equal(chooseEndpoint(["offline", "online", "online"], [idle, { active: 3, inputTokens: 9e9, outputTokens: 0 }, idle]), 1);
  assert.equal(chooseEndpoint(["online", "offline", "online"], [{ active: 3, inputTokens: 9e9, outputTokens: 0 }, idle, idle]), 0);
  assert.equal(chooseEndpoint(["error", "offline"], [idle, idle]), 0);
});

test("routing spreads concurrent requests, falls back past an offline primary, and tracks tokens", async () => {
  const base: ConnectionConfig = { id: "c", name: "c", driver: "openai", baseUrl: "http://route-a.test/v1", backupUrls: ["http://route-b.test/v1"], apiKey: "", models: [] };
  const up = (async () => new Response('{"data":[]}')) as typeof fetch;
  const first = await routeConnection(base, "", up);
  const second = await routeConnection(base, "", up);
  assert.deepEqual([first.endpoint, second.endpoint], ["http://route-a.test/v1", "http://route-b.test/v1"]);
  assert.equal(second.connection.baseUrl, "http://route-b.test/v1");
  first.record(500, 100); first.release(); first.release(); second.record(10, 10); second.release();
  assert.deepEqual(endpointLoad("http://route-a.test/v1"), { active: 0, inputTokens: 500, outputTokens: 100 });
  const third = await routeConnection(base, "", up); assert.equal(third.endpoint, "http://route-b.test/v1"); third.release();

  const down = { ...base, id: "d", baseUrl: "http://route-down.test/v1", backupUrls: ["http://route-up.test/v1"] };
  const fetcher = (async (url: string) => { if (url.includes("route-down")) throw new TypeError("fetch failed"); return new Response('{"data":[]}'); }) as unknown as typeof fetch;
  const routed = await routeConnection(down, "", fetcher); assert.equal(routed.endpoint, "http://route-up.test/v1"); routed.release();
});
