import assert from "node:assert/strict";
import test from "node:test";
import { discoverModelRecords } from "./model-discovery.ts";
import { inferReasoning } from "./reasoning-capabilities.ts";

test("OpenAI-compatible discovery inherits native options without changing served IDs", async () => {
  const fetcher: typeof fetch = async input => Response.json(String(input).includes('/api/v1/') ? { models: [{ key: 'qwen3.8-uncensored', type: 'llm', loaded_instances: [{ id: 'served-alias' }], capabilities: { reasoning: { allowed_options: ['off', 'on'] } } }] } : { data: [{ id: 'served-alias' }] });
  const records = await discoverModelRecords('openai', 'http://localhost:1234/v1', '', fetcher);
  assert.equal(records[0].key, 'served-alias');
  assert.deepEqual(inferReasoning(records[0], 'served-alias', 'openai').reasoningEfforts, ['off', 'on']);
});
test("generic OpenAI servers survive absent native API; native discovery excludes embeddings", async () => {
  const fetcher: typeof fetch = async input => String(input).includes('/api/v1/') ? new Response('Not found', { status: 404 }) : Response.json({ data: [{ id: 'generic' }] });
  assert.deepEqual(await discoverModelRecords('openai', 'http://host/v1', '', fetcher), [{ id: 'generic' }]);
  const native: typeof fetch = async () => Response.json({ models: [null, { key: 'embed', type: 'embedding' }, { key: 'chat', type: 'llm' }] });
  assert.deepEqual(await discoverModelRecords('lmstudio', 'http://host', '', native), [{ key: 'chat', type: 'llm' }]);
});
