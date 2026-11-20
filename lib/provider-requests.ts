import { anthropicChatFetch } from "./anthropic-bridge.ts";
import type { ConnectionDriver } from "./types.ts";

/** The fetch a chat request to this driver goes through: Anthropic is translated to the Messages API. */
export function chatFetcher(driver: ConnectionDriver): typeof fetch {
  return driver === "anthropic" ? anthropicChatFetch : fetch;
}

const GOOGLE_EFFORTS = new Set(["none", "minimal", "low", "medium", "high"]);

/**
 * Adjusts a Chat Completions body for a provider's compatibility layer. Gemini's OpenAI endpoint rejects
 * fields it does not know, so prior reasoning text is left out of messages and effort is kept to its levels.
 */
export function providerRequestBody<T extends Record<string, unknown>>(driver: ConnectionDriver, body: T): T {
  if (driver !== "google") return body;
  const messages = Array.isArray(body.messages) ? body.messages.map(message => {
    if (!message || typeof message !== "object") return message;
    const { reasoning_content: _content, reasoning: _reasoning, ...rest } = message as Record<string, unknown>;
    return rest;
  }) : body.messages;
  const effort = typeof body.reasoning_effort === "string" ? body.reasoning_effort.toLowerCase() : undefined;
  const { reasoning_effort: _effort, ...rest } = body;
  return { ...rest, messages, ...(effort ? { reasoning_effort: GOOGLE_EFFORTS.has(effort) ? effort : effort === "xhigh" || effort === "max" ? "high" : "medium" } : {}) } as unknown as T;
}
