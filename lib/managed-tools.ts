import { existsSync } from "node:fs";
import path from "node:path";
import { dataDir, db } from "./database.ts";

/**
 * Whether the executables behind the browser and YouTube tools are in place. Synchronous and cheap, for the public
 * config; the architecture is checked when a file is installed, and the tools report a clear error if one stops working.
 */
const exe = (name: string) => process.platform === "win32" ? `${name}.exe` : name;
/** With `userId`, the browser also counts as installed when the account has a virtual computer (it runs there). */
export function managedToolsInstalled(userId?: string) {
  const tools = path.join(dataDir, "tools");
  const onVm = Boolean(userId && db.prepare("SELECT 1 FROM mcp_connections WHERE user_id = ? AND kind = 'vm' AND enabled = 1").get(userId));
  return {
    browser: onVm || (existsSync(path.join(tools, "obscura", exe("obscura"))) && existsSync(path.join(tools, "obscura", exe("obscura-worker")))),
    youtube: existsSync(path.join(tools, "yt-dlp", exe("yt-dlp"))),
  };
}
