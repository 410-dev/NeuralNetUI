import assert from "node:assert/strict";
import test from "node:test";
import { connectionOnline, connectionStates, probeConnection } from "./connection-status.ts";

const probe = { driver: "openai" as const, baseUrl: "http://model.test/v1", headers: {} };

test("a model server is offline on transport failure or 5xx", async () => {
  assert.equal(await probeConnection(probe, (async () => new Response("{}", { status: 200 })) as typeof fetch), true);
  assert.equal(await probeConnection(probe, (async () => new Response("", { status: 401 })) as typeof fetch), true);
  assert.equal(await probeConnection(probe, (async () => new Response("", { status: 503 })) as typeof fetch), false);
  assert.equal(await probeConnection(probe, (async () => { throw new TypeError("fetch failed"); }) as typeof fetch), false);
});

test("status checks probe the listing endpoint and reuse fresh results", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string) => { urls.push(url); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  const [first, second] = await Promise.all([connectionOnline("status-test", probe, 5_000, fetcher), connectionOnline("status-test", probe, 5_000, fetcher)]);
  assert.equal(first && second, true);
  assert.equal(await connectionOnline("status-test", probe, 5_000, fetcher), true);
  assert.deepEqual(urls, ["http://model.test/v1/models"]);
});

test("disabled servers are reported without a probe and others as online or offline", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string) => { urls.push(url); return new Response("", { status: url.includes("down") ? 502 : 200 }); }) as unknown as typeof fetch;
  const base = { apiKey: "", driver: "openai" as const };
  const states = await connectionStates([
    { ...base, id: "state-up", baseUrl: "http://up.test/v1" },
    { ...base, id: "state-down", baseUrl: "http://down.test/v1" },
    { ...base, id: "state-off", baseUrl: "http://off.test/v1", disabled: true },
  ], "", fetcher);
  assert.deepEqual(states, { "state-up": "online", "state-down": "offline", "state-off": "disabled" });
  assert.equal(urls.some(url => url.includes("off.test")), false);
});
