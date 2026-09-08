import type { Conversation } from "./types";

export async function saveConversationRequest(next: Conversation, create: boolean, request: typeof fetch = fetch): Promise<Conversation> {
  const response = await request(create ? "/api/conversations" : `/api/conversations/${next.id}`, {
    method: create ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Unable to save conversation (${response.status}).`);
  if (body.id !== next.id || !Array.isArray(body.branches)) throw new Error("Invalid conversation save response.");
  return body as Conversation;
}
