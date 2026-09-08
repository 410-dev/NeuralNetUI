import { lmStudioEndpoint, modelsEndpoint } from "./connection-drivers.ts";

type LmStudioModelRecord = {
  id?: string;
  key?: string;
  selected_variant?: string;
  variants?: string[];
  loaded_instances?: unknown[];
};

type SharedLoad = { promise: Promise<void>; controller: AbortController; waiters: number; settled: boolean };
const loads = new Map<string, SharedLoad>();

export function isLmStudioModelLoaded(payload: unknown, ...identifiers: Array<string | undefined>) {
  if (!payload || typeof payload !== "object") return false;
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) return false;
  const requested = new Set(identifiers.filter((value): value is string => Boolean(value)));
  const record = models.find((candidate): candidate is LmStudioModelRecord => {
    if (!candidate || typeof candidate !== "object") return false;
    const model = candidate as LmStudioModelRecord;
    return [model.id, model.key, model.selected_variant, ...(Array.isArray(model.variants) ? model.variants : [])]
      .some((value) => typeof value === "string" && requested.has(value));
  });
  return Boolean(record && Array.isArray(record.loaded_instances) && record.loaded_instances.length > 0);
}

export async function ensureLmStudioModelLoaded(options: {
  baseUrl: string;
  headers: Record<string, string>;
  sourceModel: string;
  modelId: string;
  contextWindowTokens?: number;
  signal: AbortSignal;
  request?: typeof fetch;
}) {
  const { baseUrl, headers, sourceModel, modelId, contextWindowTokens, signal, request = fetch } = options;
  signal.throwIfAborted();
  const key = `${baseUrl.replace(/\/$/, "")}\0${sourceModel}`;
  let shared = loads.get(key);
  if (!shared) {
    const controller = new AbortController();
    const entry: SharedLoad = { promise: Promise.resolve(), controller, waiters: 0, settled: false };
    const loadSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
    entry.promise = (async () => {
      const listResponse = await request(modelsEndpoint("lmstudio", baseUrl), { headers, signal: loadSignal, cache: "no-store" });
      if (!listResponse.ok) throw new Error((await listResponse.text()) || `Model list failed with ${listResponse.status}`);
      const payload = await listResponse.json().catch(() => ({}));
      if (isLmStudioModelLoaded(payload, sourceModel, modelId)) return;
      const loadResponse = await request(lmStudioEndpoint(baseUrl, "load"), { method: "POST", headers, body: JSON.stringify({ model: sourceModel, ...(contextWindowTokens ? { context_length: contextWindowTokens } : {}) }), signal: loadSignal });
      if (!loadResponse.ok && loadResponse.status !== 409) throw new Error((await loadResponse.text()) || `Model load failed with ${loadResponse.status}`);
    })().finally(() => { entry.settled = true; if (loads.get(key) === entry) loads.delete(key); });
    loads.set(key, entry); shared = entry;
  }
  const entry = shared;
  entry.waiters++;
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      entry.promise.then(() => { signal.removeEventListener("abort", abort); resolve(); }, error => { signal.removeEventListener("abort", abort); reject(error); });
      if (signal.aborted) abort();
    });
  } finally {
    entry.waiters--;
    if (!entry.waiters && !entry.settled) {
      if (loads.get(key) === entry) loads.delete(key);
      entry.controller.abort();
    }
  }
}
