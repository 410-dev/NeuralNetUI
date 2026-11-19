import { existsSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./database.ts";

/**
 * Whether the executables behind the browser and YouTube tools are in place. Synchronous and cheap, for the public
 * config; the architecture is checked when a file is installed, and the tools report a clear error if one stops working.
 */
const exe = (name: string) => process.platform === "win32" ? `${name}.exe` : name;
export function managedToolsInstalled() {
  const tools = path.join(dataDir, "tools");
  return {
    browser: existsSync(path.join(tools, "obscura", exe("obscura"))) && existsSync(path.join(tools, "obscura", exe("obscura-worker"))),
    youtube: existsSync(path.join(tools, "yt-dlp", exe("yt-dlp"))),
  };
}
