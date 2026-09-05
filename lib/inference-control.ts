export type InferenceAction = "load" | "status" | "unload";

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function inferenceEndpoint(baseUrl: string, action: InferenceAction) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/$/, "").replace(/\/v1$/, "");
  url.pathname = `${basePath}/api/inference/${action}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function loadedModelIdentifier(status: unknown) {
  if (!status || typeof status !== "object") return undefined;
  const value = status as Record<string, unknown>;
  const direct = nonEmptyString(value.model_identifier) || nonEmptyString(value.active_model);
  if (direct) return direct;
  if (!Array.isArray(value.loaded)) return undefined;
  return value.loaded.map(nonEmptyString).find((model): model is string => Boolean(model));
}
