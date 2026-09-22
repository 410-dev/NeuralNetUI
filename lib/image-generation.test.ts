import assert from "node:assert/strict";
import test from "node:test";
import { generateCompatibleImage, isGptImage2Model } from "./image-generation.ts";

const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("GPT Image 2 aliases and snapshots use the image-generation route", () => {
  assert.equal(isGptImage2Model("gpt-image-2"), true);
  assert.equal(isGptImage2Model("gpt-image-2-2026-04-21"), true);
  assert.equal(isGptImage2Model("openai/gpt-image-2"), true);
  assert.equal(isGptImage2Model("gpt-image-2.5-sunburst"), false);
  assert.equal(isGptImage2Model("gpt-5.6"), false);
});

test("compatible generation posts the official request shape and decodes b64_json", async () => {
  let requestUrl = ""; let requestInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (url, init) => {
    requestUrl = String(url); requestInit = init;
    return Response.json({
      created: 123,
      data: [{ b64_json: onePixelPng.toString("base64"), revised_prompt: "A refined prompt" }],
      output_format: "png",
      size: "1024x1024",
      usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 },
    });
  };
  const result = await generateCompatibleImage({
    baseUrl: "https://example.test/v1/",
    headers: { Authorization: "Bearer secret" },
    model: "gpt-image-2",
    prompt: "Draw an otter",
    maximumBytes: 1024,
    fetcher,
  });
  assert.equal(requestUrl, "https://example.test/v1/images/generations");
  assert.equal(requestInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), { model: "gpt-image-2", prompt: "Draw an otter", n: 1 });
  assert.deepEqual(result.image, onePixelPng);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.extension, "png");
  assert.equal(result.revisedPrompt, "A refined prompt");
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 22, totalTokens: 33 });
});

test("compatible image editing uses multipart input images and the official edits endpoint", async () => {
  let requestUrl = ""; let requestInit: RequestInit | undefined;
  const result = await generateCompatibleImage({
    baseUrl: "https://example.test/v1", headers: { Authorization: "Bearer secret", "Content-Type": "application/json" }, model: "gpt-image-2", prompt: "Add a hat", maximumBytes: 1024,
    sourceImages: [{ data: onePixelPng, name: "otter.png", mimeType: "image/png" }],
    fetcher: async (url, init) => { requestUrl = String(url); requestInit = init; return Response.json({ data: [{ b64_json: onePixelPng.toString("base64") }] }); },
  });
  assert.equal(requestUrl, "https://example.test/v1/images/edits");
  assert.ok(requestInit?.body instanceof FormData);
  assert.equal(new Headers(requestInit?.headers).has("content-type"), false);
  const form = requestInit.body as FormData;
  assert.equal(form.get("model"), "gpt-image-2");
  assert.equal(form.get("prompt"), "Add a hat");
  assert.equal(form.get("n"), "1");
  assert.ok(form.get("image[]") instanceof Blob);
  assert.deepEqual(result.image, onePixelPng);
});

test("compatible generation rejects malformed, oversized, and missing images", async () => {
  const call = (body: unknown, maximumBytes = 1024) => generateCompatibleImage({
    baseUrl: "https://example.test/v1",
    headers: {}, model: "gpt-image-2", prompt: "test", maximumBytes,
    fetcher: async () => Response.json(body),
  });
  await assert.rejects(call({ data: [{ b64_json: "not base64!" }] }), /valid base64/i);
  await assert.rejects(call({ data: [{ b64_json: onePixelPng.toString("base64") }] }, 8), /configured limit/i);
  await assert.rejects(call({ data: [] }), /did not include an image/i);
});

test("compatible generation surfaces bounded upstream errors", async () => {
  await assert.rejects(generateCompatibleImage({
    baseUrl: "https://example.test/v1", headers: {}, model: "gpt-image-2", prompt: "test", maximumBytes: 1024,
    fetcher: async () => new Response("blocked by policy", { status: 400 }),
  }), /blocked by policy/);
});
