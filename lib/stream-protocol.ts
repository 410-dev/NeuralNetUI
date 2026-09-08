/** Only SSE data fields are passed here; comments/keep-alives are handled by the framing layer. */
export function readSsePayload(data: string): Record<string, unknown> | "done" {
  if (data === "[DONE]") return "done";
  let payload: unknown;
  try { payload = JSON.parse(data); } catch { throw new Error("Invalid JSON in the model response stream."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid model response payload.");
  const record = payload as Record<string, unknown>;
  if (record.error) {
    const error = record.error;
    throw new Error(typeof error === "object" && error && "message" in error ? String(error.message) : String(error));
  }
  return record;
}
