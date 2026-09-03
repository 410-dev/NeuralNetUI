export type InferenceAction = "load" | "status" | "unload";

export function inferenceEndpoint(baseUrl: string, action: InferenceAction) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/$/, "").replace(/\/v1$/, "");
  url.pathname = `${basePath}/api/inference/${action}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
