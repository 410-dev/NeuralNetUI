import assert from "node:assert/strict";
import test from "node:test";
import { ensureLmStudioModelLoaded, isLmStudioModelLoaded } from "./lm-studio-control.ts";

const payload = {
  models: [
    { key: "loaded-model", loaded_instances: [{ id: "loaded-model" }] },
    { key: "base-model", selected_variant: "base-model@q4", variants: ["base-model@q4"], loaded_instances: [{ id: "base-model@q4" }] },
    { key: "idle-model", loaded_instances: [] },
  ],
};

test("detects an existing LM Studio instance by model key or selected variant", () => {
  assert.equal(isLmStudioModelLoaded(payload, "loaded-model"), true);
  assert.equal(isLmStudioModelLoaded(payload, "base-model@q4"), true);
});

test("does not treat an installed but unloaded model as loaded", () => {
  assert.equal(isLmStudioModelLoaded(payload, "idle-model"), false);
  assert.equal(isLmStudioModelLoaded(payload, "missing-model"), false);
  assert.equal(isLmStudioModelLoaded({}, "loaded-model"), false);
});

test("on-demand loading skips POST when LM Studio already has the model loaded", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method || "GET" });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  await ensureLmStudioModelLoaded({ baseUrl: "http://localhost:1234", headers: {}, sourceModel: "loaded-model", modelId: "loaded-model", signal: new AbortController().signal, request });
  assert.deepEqual(calls, [{ url: "http://localhost:1234/api/v1/models", method: "GET" }]);
});

test("concurrent on-demand requests share one LM Studio load operation", async () => {
  const calls: string[] = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(init?.method || "GET");
    if (!init?.method) await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(init?.method ? "{}" : JSON.stringify({ models: [{ key: "idle-model", loaded_instances: [] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const options = { baseUrl: "http://localhost:1234", headers: {}, sourceModel: "idle-model", modelId: "idle-model", signal: new AbortController().signal, request };
  await Promise.all([ensureLmStudioModelLoaded(options), ensureLmStudioModelLoaded(options)]);
  assert.deepEqual(calls, ["GET", "POST"]);
});

test("cancelling either waiter does not abort the remaining caller", async () => {
  for (const cancelled of [0, 1]) {
    let finish!: () => void;
    let upstreamSignal: AbortSignal | undefined;
    const request = (async (_url: unknown, init: RequestInit) => {
      upstreamSignal = init.signal!;
      await new Promise<void>(resolve => { finish = resolve; });
      return Response.json({ models: [{ key: "shared", loaded_instances: [{ id: "shared" }] }] });
    }) as typeof fetch;
    const controllers = [new AbortController(), new AbortController()];
    const pending = controllers.map(controller => ensureLmStudioModelLoaded({ baseUrl: "http://localhost:1234", headers: {}, sourceModel: "shared", modelId: "shared", signal: controller.signal, request }));
    controllers[cancelled].abort();
    await assert.rejects(pending[cancelled], { name: "AbortError" });
    assert.equal(upstreamSignal?.aborted, false);
    finish(); await pending[1 - cancelled];
  }
});

test("the upstream operation is cancelled when all callers leave", async () => {
  let upstreamSignal: AbortSignal | undefined;
  const request = (async (_url: unknown, init: RequestInit) => {
    upstreamSignal = init.signal!;
    return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
  }) as typeof fetch;
  const controller = new AbortController();
  const pending = ensureLmStudioModelLoaded({ baseUrl: "http://localhost:1234", headers: {}, sourceModel: "alone", modelId: "alone", signal: controller.signal, request });
  controller.abort(); await assert.rejects(pending, { name: "AbortError" });
  assert.equal(upstreamSignal?.aborted, true);
});
