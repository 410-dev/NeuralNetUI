import assert from "node:assert/strict";
import test from "node:test";
import { connectionProbe, connectionStates, probeConnection } from "./connection-status.ts";

const probe = { driver: "openai" as const, baseUrl: "http://model.test/v1", headers: {} };

test("a model server is online only with a usable listing, an error when it answers badly, offline when unreachable", async () => {
  const reply = (body: string, status = 200, headers: Record<string, string> = {}) => (async () => new Response(body, { status, headers })) as typeof fetch;
  assert.equal(await probeConnection(probe, reply('{"data":[]}')), "online");
  assert.equal(await probeConnection({ ...probe, driver: "lmstudio" }, reply('{"models":[]}')), "online");
  assert.equal(await probeConnection(probe, reply("", 401)), "error");
  assert.equal(await probeConnection(probe, reply("", 404)), "error");
  assert.equal(await probeConnection(probe, reply("", 503)), "error");
  assert.equal(await probeConnection(probe, reply("<!doctype html><html></html>", 200, { "content-type": "text/html" })), "error");
  assert.equal(await probeConnection(probe, reply('{"error":"nope"}')), "error");
  assert.equal(await probeConnection(probe, (async () => { throw new TypeError("fetch failed"); }) as typeof fetch), "offline");
  assert.equal(await probeConnection(probe, (async () => { throw new DOMException("timed out", "TimeoutError"); }) as typeof fetch), "offline");
});

test("status checks probe the listing endpoint and reuse fresh results", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string) => { urls.push(url); return new Response('{"data":[]}', { status: 200 }); }) as unknown as typeof fetch;
  const [first, second] = await Promise.all([connectionProbe("status-test", probe, 5_000, fetcher), connectionProbe("status-test", probe, 5_000, fetcher)]);
  assert.deepEqual([first, second], ["online", "online"]);
  assert.equal(await connectionProbe("status-test", probe, 5_000, fetcher), "online");
  assert.deepEqual(urls, ["http://model.test/v1/models"]);
});

test("disabled servers are reported without a probe and others as online, error or offline", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string) => { urls.push(url); if (url.includes("down")) throw new TypeError("fetch failed"); return new Response(url.includes("bad") ? "" : '{"data":[]}', { status: url.includes("bad") ? 401 : 200 }); }) as unknown as typeof fetch;
  const base = { apiKey: "", driver: "openai" as const };
  const states = await connectionStates([
    { ...base, id: "state-up", baseUrl: "http://up.test/v1" },
    { ...base, id: "state-down", baseUrl: "http://down.test/v1" },
    { ...base, id: "state-bad", baseUrl: "http://bad.test/v1" },
    { ...base, id: "state-off", baseUrl: "http://off.test/v1", disabled: true },
  ], "", fetcher);
  assert.deepEqual(states, { "state-up": "online", "state-down": "offline", "state-bad": "error", "state-off": "disabled" });
  assert.equal(urls.some(url => url.includes("off.test")), false);
});
