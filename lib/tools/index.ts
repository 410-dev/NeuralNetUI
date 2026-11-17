import { BUILTIN_PROVIDERS, builtinSource } from "./builtin";
import { clearSessionApprovals } from "./approval";
import { mcpSource } from "./mcp-source";
import type { ToolProviderSource } from "./types";

/**
 * Every source of tool providers, in menu and model order: NeuralNetUI's built-in tools, then the account's own
 * MCP connections. Workspace plugins installed by an administrator join here as a third source.
 */
export function toolSources(): ToolProviderSource[] {
  return [builtinSource, mcpSource];
}

/**
 * Releases everything tools keep for these conversations: browser sessions, host computer state, remembered
 * approvals, and whatever a future provider (such as a code sandbox) holds. Safe to call more than once.
 */
export async function disposeConversationTools(userId: string, conversationIds: string[]) {
  await Promise.all(conversationIds.flatMap(conversationId => {
    clearSessionApprovals(userId, conversationId);
    return BUILTIN_PROVIDERS.map(async provider => {
      try { await provider.disposeConversation?.(userId, conversationId); }
      catch (error) { console.warn(`Tool provider ${provider.manifest.id} could not release conversation ${conversationId}:`, error); }
    });
  }));
}

export { resolveTools } from "./registry";
export type { ResolvedTools } from "./registry";
