/**
 * Composer slash commands. A message that is exactly one of these runs the command instead of being sent; anything
 * else that starts with or contains a command is an ordinary message for the model. New commands are added to
 * SLASH_COMMANDS (for the autocomplete) and to parseSlashCommand (for what they do).
 */
export type CompactCommand = "default" | "summarize";
export type SlashCommandAction = { kind: "compact"; mode: CompactCommand };
export type SlashCommand = { command: string; description: { ko: string; en: string } };

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { command: "/compact", description: { ko: "설정된 방식으로 지금 컨텍스트 압축", en: "Compact the context now with the configured method" } },
  { command: "/compact summarize", description: { ko: "설정과 관계없이 요약으로 압축", en: "Summarize the context regardless of settings" } },
];

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

export function parseSlashCommand(text: string): SlashCommandAction | undefined {
  const value = normalize(text);
  if (value === "/compact") return { kind: "compact", mode: "default" };
  if (value === "/compact summarize") return { kind: "compact", mode: "summarize" };
  return undefined;
}

export function parseCompactCommand(text: string): CompactCommand | undefined {
  const action = parseSlashCommand(text);
  return action?.kind === "compact" ? action.mode : undefined;
}

/** Commands the draft could still become, for the autocomplete above the composer. Empty once it cannot match one. */
export function slashSuggestions(draft: string): SlashCommand[] {
  if (!draft.startsWith("/") || /\n/.test(draft.trim())) return [];
  const typed = draft.replace(/\s+/g, " ").toLowerCase();
  return SLASH_COMMANDS.filter(item => item.command.toLowerCase().startsWith(typed));
}
