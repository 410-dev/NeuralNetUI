/**
 * Reads a JSON API response in the browser. A body that is not JSON (a reverse proxy or tunnel error page sent in
 * place of the app's answer) becomes a readable error naming the HTTP status, instead of a bare JSON.parse failure.
 * A response that is not OK throws its `error` message.
 */
export async function readApiResponse<T = Record<string, unknown>>(response: Response, locale: "ko" | "en" = "ko"): Promise<T> {
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : {}; }
  catch {
    const preview = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(locale === "ko"
      ? `서버가 JSON이 아닌 응답(HTTP ${response.status})을 보냈습니다. NeuralNetUI 앞의 프록시나 터널이 응답을 바꿨을 수 있습니다.${preview ? ` 응답: ${preview}` : ""}`
      : `The server sent a non-JSON response (HTTP ${response.status}). A proxy or tunnel in front of NeuralNetUI may have replaced it.${preview ? ` Response: ${preview}` : ""}`);
  }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!response.ok) throw new Error(typeof record.error === "string" && record.error ? record.error : `HTTP ${response.status}`);
  return record as T;
}
