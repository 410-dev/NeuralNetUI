/**
 * Composer commands that compact the context instead of sending a message. Only the exact forms count: anything else
 * that starts with or contains /compact is an ordinary message for the model.
 */
export type CompactCommand = "default" | "summarize";

export function parseCompactCommand(text: string): CompactCommand | undefined {
  const match = text.trim().match(/^\/compact(?:\s+(summarize))?$/i);
  if (!match) return undefined;
  return match[1] ? "summarize" : "default";
}
