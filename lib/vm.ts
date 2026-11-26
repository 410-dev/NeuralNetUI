import { createHash } from "node:crypto";
import { db } from "./database";

/**
 * The account's virtual computer: an MCP connection of kind "vm" whose server also offers browser sessions and file
 * transfer next to its MCP endpoint (vm-agent/neuralnetui_vm.py).
 */
export type VmConnection = { id: string; userId: string; url: string; credential: string; enabled: boolean; name: string };

export function vmConnection(userId: string, includeDisabled = false): VmConnection | undefined {
  const row = db.prepare("SELECT id, user_id, url, credential, enabled, name FROM mcp_connections WHERE user_id = ? AND kind = 'vm'").get(userId) as { id: string; user_id: string; url: string; credential: string; enabled: number; name: string } | undefined;
  if (!row || (!includeDisabled && row.enabled !== 1)) return undefined;
  return { id: row.id, userId: row.user_id, url: row.url, credential: row.credential, enabled: row.enabled === 1, name: row.name };
}

/** The opaque id the virtual computer keys workspaces by: stable per account, without revealing the account id. */
export function vmCallerId(userId: string) {
  return createHash("sha256").update(`neuralnetui-vm:${userId}`).digest("hex").slice(0, 32);
}

export function vmHeaders(vm: Pick<VmConnection, "credential" | "userId">): Record<string, string> {
  return { ...(vm.credential ? { Authorization: `Bearer ${vm.credential}` } : {}), "X-NNUI-User": vmCallerId(vm.userId) };
}

/** The server root next to its MCP endpoint (".../mcp" → "..."). */
export function vmBaseUrl(url: string) {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/\/mcp\/?$/, "").replace(/\/$/, "");
  parsed.search = ""; parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

/** Default approval for the virtual computer's own tools: reading is allowed, anything that changes the computer asks. */
export function vmDefaultPolicy(toolName: string): "always_allow" | "always_ask" | "session_ask" {
  if (["computer_info", "shell_output", "shell_jobs", "screen_capture", "copy_to_storage"].includes(toolName)) return "always_allow";
  if (toolName === "copy_from_storage") return "session_ask";
  return "always_ask";
}
