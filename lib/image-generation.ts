import { sniffRasterMimeType } from "./document-processing.ts";
import { imageEditEndpoint, imageGenerationEndpoint } from "./connection-drivers.ts";

type ImageUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

export type CompatibleGeneratedImage = {
  image: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpg" | "webp";
  revisedPrompt?: string;
  usage: ImageUsage;
};

type GenerateCompatibleImageInput = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  prompt: string;
  maximumBytes: number;
  sourceImages?: Array<{ data: Buffer; name: string; mimeType: "image/png" | "image/jpeg" | "image/webp" }>;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
};

const IMAGE_RESPONSE_OVERHEAD_BYTES = 256 * 1024;

export function isGptImage2Model(modelId: string) {
  return /(?:^|[/:])gpt-image-2(?:$|-)/i.test(modelId.trim());
}

function usageToken(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

async function boundedResponseBuffer(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("The image-generation response exceeded the configured limit.");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new Error("The image-generation response exceeded the configured limit.");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => undefined); reader.releaseLock();
  }
}

function decodeBase64Image(value: unknown, maximumBytes: number) {
  if (typeof value !== "string") throw new Error("The image-generation response did not include a base64 image.");
  const normalized = value.replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) throw new Error("The image-generation response did not contain valid base64 data.");
  const image = Buffer.from(normalized, "base64");
  if (image.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")) throw new Error("The image-generation response did not contain valid base64 data.");
  if (image.length > maximumBytes) throw new Error("The generated image exceeded the configured limit.");
  const mimeType = sniffRasterMimeType(image.subarray(0, 32));
  if (!mimeType || !["image/png", "image/jpeg", "image/webp"].includes(mimeType)) throw new Error("The image-generation response was not a supported PNG, JPEG, or WebP image.");
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
  return { image, mimeType: mimeType as CompatibleGeneratedImage["mimeType"], extension: extension as CompatibleGeneratedImage["extension"] };
}

/** Request the non-streaming GPT Image response used by OpenAI-compatible /images/generations endpoints. */
export async function generateCompatibleImage(input: GenerateCompatibleImageInput): Promise<CompatibleGeneratedImage> {
  const maximumBytes = Math.max(1, Math.floor(input.maximumBytes));
  const maximumResponseBytes = Math.ceil(maximumBytes / 3) * 4 + IMAGE_RESPONSE_OVERHEAD_BYTES;
  const sources = input.sourceImages || [];
  if (sources.length > 16) throw new Error("GPT Image supports at most 16 input images.");
  const requestHeaders = { Accept: "application/json", ...input.headers };
  let endpoint = imageGenerationEndpoint(input.baseUrl); let body: BodyInit;
  if (sources.length) {
    endpoint = imageEditEndpoint(input.baseUrl);
    delete (requestHeaders as Record<string, string>)["Content-Type"];
    delete (requestHeaders as Record<string, string>)["content-type"];
    const form = new FormData(); form.append("model", input.model); form.append("prompt", input.prompt); form.append("n", "1");
    for (const source of sources) form.append("image[]", new Blob([new Uint8Array(source.data)], { type: source.mimeType }), source.name);
    body = form;
  } else {
    (requestHeaders as Record<string, string>)["Content-Type"] = "application/json";
    body = JSON.stringify({ model: input.model, prompt: input.prompt, n: 1 });
  }
  const response = await (input.fetcher || fetch)(endpoint, { method: "POST", headers: requestHeaders, signal: input.signal, body });
  const payloadBuffer = await boundedResponseBuffer(response, maximumResponseBytes);
  if (!response.ok) {
    const detail = payloadBuffer.toString("utf8").trim().slice(0, 4_096);
    throw new Error(detail || `Image server responded with ${response.status}.`);
  }
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(payloadBuffer.toString("utf8")) as Record<string, unknown>; }
  catch { throw new Error("The image-generation server returned invalid JSON."); }
  const first = Array.isArray(payload.data) && payload.data[0] && typeof payload.data[0] === "object" ? payload.data[0] as Record<string, unknown> : undefined;
  if (!first) throw new Error("The image-generation response did not include an image.");
  const decoded = decodeBase64Image(first.b64_json, maximumBytes);
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
  return {
    ...decoded,
    ...(typeof first.revised_prompt === "string" && first.revised_prompt.trim() ? { revisedPrompt: first.revised_prompt.trim() } : {}),
    usage: { inputTokens: usageToken(usage.input_tokens), outputTokens: usageToken(usage.output_tokens), totalTokens: usageToken(usage.total_tokens) },
  };
}
