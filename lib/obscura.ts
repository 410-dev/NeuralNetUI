import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { dataDir } from "./database.ts";
import { executableName, fileExists, readExecutableTarget, runExecutable, targetMatchesHost, toolsDir, describeTarget, hostTarget } from "./managed-binaries.ts";
import { remainingStorageBytes, saveHostFile } from "./uploads.ts";

/**
 * Obscura (https://github.com/h4ckf0r0day/obscura) as NeuralNetUI's headless browser.
 *
 * Obscura's MCP server keeps one browser session per process and was not built for many people at once, so a small
 * broker sits in front of it: every (account, conversation) pair gets its own `obscura mcp` process over stdio with its
 * own profile folder (cookies, localStorage), calls into one session run one at a time, and a session nobody has used
 * for the idle time is stopped to give its memory back. Its profile stays on disk, so the next call in that
 * conversation starts a fresh process that still has the cookies. Deleting the conversation removes the profile.
 */

export type ObscuraBinaryKind = "obscura" | "obscura-worker";
export const OBSCURA_BINARY_KINDS: ObscuraBinaryKind[] = ["obscura", "obscura-worker"];
export const MAX_OBSCURA_BINARY_BYTES = 512 * 1024 * 1024;

export const obscuraDir = path.join(toolsDir, "obscura");
const profilesDir = path.join(dataDir, "browser-profiles");
export const obscuraBinaryPath = (kind: ObscuraBinaryKind) => path.join(obscuraDir, executableName(kind));

export type ObscuraSettings = { render: boolean; stealth: boolean; idleMinutes: number; maxSessions: number };
export type ObscuraBinaryStatus = { kind: ObscuraBinaryKind; installed: boolean; size?: number; updatedAt?: string; target?: string; matchesHost?: boolean };
export type ObscuraStatus = { host: string; binaries: ObscuraBinaryStatus[]; ready: boolean; version?: string; error?: string; sessions: number };

let versionCache: { key: string; version?: string; error?: string } | undefined;

async function binaryStatus(kind: ObscuraBinaryKind): Promise<ObscuraBinaryStatus> {
  const file = obscuraBinaryPath(kind);
  try {
    const stats = await fs.stat(file);
    const target = await readExecutableTarget(file);
    return { kind, installed: true, size: stats.size, updatedAt: stats.mtime.toISOString(), target: describeTarget(target), matchesHost: targetMatchesHost(target) };
  } catch { return { kind, installed: false }; }
}

/** The binaries, whether they fit this server, and the version `obscura --version` reports. */
export async function obscuraStatus(): Promise<ObscuraStatus> {
  const binaries = await Promise.all(OBSCURA_BINARY_KINDS.map(binaryStatus));
  const host = hostTarget();
  const main = binaries[0];
  let version: string | undefined, error: string | undefined;
  if (main.installed && main.matchesHost) {
    const key = `${main.size}:${main.updatedAt}`;
    if (versionCache?.key !== key) {
      try {
        const result = await runExecutable(obscuraBinaryPath("obscura"), ["--version"], { timeoutMs: 15_000 });
        versionCache = result.code === 0 ? { key, version: result.stdout.trim().split(/\r?\n/)[0] } : { key, error: (result.stderr || result.stdout).trim().slice(0, 500) || `exit ${result.code}` };
      } catch (failure) { versionCache = { key, error: failure instanceof Error ? failure.message : String(failure) }; }
    }
    version = versionCache.version; error = versionCache.error;
  }
  const ready = binaries.every(item => item.installed && item.matchesHost) && Boolean(version);
  return { host: `${host.os}/${host.arch}`, binaries, ready, ...(version ? { version } : {}), ...(error ? { error } : {}), sessions: broker().sessions.size };
}

/** Whether chats can use the browser right now. Cheap: no process is started. */
export async function obscuraAvailable() {
  const [main, worker] = await Promise.all([binaryStatus("obscura"), binaryStatus("obscura-worker")]);
  return Boolean(main.installed && main.matchesHost && worker.installed && worker.matchesHost);
}

export async function removeObscuraBinary(kind: ObscuraBinaryKind) {
  await closeAllObscuraSessions();
  await fs.unlink(obscuraBinaryPath(kind)).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
  versionCache = undefined; catalogCache = undefined;
}

/** Called after a binary was replaced: running sessions still use the old file, so they are stopped. */
export async function obscuraBinaryChanged() {
  await closeAllObscuraSessions();
  versionCache = undefined; catalogCache = undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Session broker

type ToolInfo = { name: string; description?: string; inputSchema: Record<string, unknown> };
type CallResult = { content?: Array<Record<string, unknown>>; isError?: boolean; structuredContent?: unknown };
type Session = {
  key: string; userId: string; conversationId: string; flags: string;
  client: Client; transport: StdioClientTransport; ready: Promise<void>;
  lastUsed: number; busy: number; queue: Promise<unknown>; closed: boolean;
};
type Broker = { sessions: Map<string, Session>; timer?: ReturnType<typeof setInterval>; settings: ObscuraSettings };

const DEFAULT_SETTINGS: ObscuraSettings = { render: true, stealth: true, idleMinutes: 10, maxSessions: 8 };
declare global { var neuralObscuraBroker: Broker | undefined; }

function broker(): Broker {
  globalThis.neuralObscuraBroker ??= { sessions: new Map(), settings: DEFAULT_SETTINGS };
  const value = globalThis.neuralObscuraBroker;
  if (!value.timer) {
    // The collector: sessions idle for longer than the configured time are stopped to reclaim their memory.
    value.timer = setInterval(() => { void collectIdleSessions(); }, 30_000);
    value.timer.unref?.();
  }
  return value;
}

const sessionKey = (userId: string, conversationId: string) => `${userId}:${conversationId}`;
const safeSegment = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "_";
export const obscuraProfileDir = (userId: string, conversationId: string) => path.join(profilesDir, safeSegment(userId), safeSegment(conversationId));
const flagsFor = (settings: ObscuraSettings) => settings.stealth ? "stealth" : "plain";

function globalArgs(settings: ObscuraSettings) { return settings.stealth ? ["--stealth"] : []; }

async function closeSession(session: Session) {
  if (session.closed) return;
  session.closed = true;
  broker().sessions.delete(session.key);
  // Closing stdin lets Obscura flush the profile (cookies, localStorage) before it exits; the transport kills it if not.
  await session.client.close().catch(() => undefined);
}

export async function collectIdleSessions(now = Date.now()) {
  const state = broker();
  const idleMs = Math.max(1, state.settings.idleMinutes) * 60_000;
  await Promise.all([...state.sessions.values()].filter(session => session.busy === 0 && now - session.lastUsed >= idleMs).map(closeSession));
}

export async function closeAllObscuraSessions() {
  await Promise.all([...broker().sessions.values()].map(closeSession));
}

/** Stops the conversation's browser and deletes its profile. */
export async function disposeObscuraConversation(userId: string, conversationId: string) {
  const session = broker().sessions.get(sessionKey(userId, conversationId));
  if (session) await closeSession(session);
  await fs.rm(obscuraProfileDir(userId, conversationId), { recursive: true, force: true }).catch(() => undefined);
}

export function configureObscura(settings: Partial<ObscuraSettings>) {
  const state = broker();
  state.settings = {
    render: settings.render ?? DEFAULT_SETTINGS.render,
    stealth: settings.stealth ?? DEFAULT_SETTINGS.stealth,
    idleMinutes: Math.max(1, Math.min(240, Math.floor(settings.idleMinutes ?? DEFAULT_SETTINGS.idleMinutes))),
    maxSessions: Math.max(1, Math.min(64, Math.floor(settings.maxSessions ?? DEFAULT_SETTINGS.maxSessions))),
  };
}

function startSession(userId: string, conversationId: string, settings: ObscuraSettings): Session {
  const profile = obscuraProfileDir(userId, conversationId);
  const transport = new StdioClientTransport({
    command: obscuraBinaryPath("obscura"), args: [...globalArgs(settings), "mcp"], cwd: obscuraDir, stderr: "ignore",
    env: { ...getDefaultEnvironment(), OBSCURA_STORAGE_DIR: profile, RUST_LOG: "error" },
  });
  const client = new Client({ name: "neuralnetui-browser", version: "1.0.0" });
  const session: Session = {
    key: sessionKey(userId, conversationId), userId, conversationId, flags: flagsFor(settings), client, transport,
    ready: Promise.resolve(), lastUsed: Date.now(), busy: 0, queue: Promise.resolve(), closed: false,
  };
  session.ready = (async () => {
    await fs.mkdir(profile, { recursive: true, mode: 0o700 });
    await client.connect(transport);
  })();
  transport.onclose = () => { if (!session.closed) { session.closed = true; broker().sessions.delete(session.key); } };
  session.ready.catch(() => { void closeSession(session); });
  return session;
}

/** The conversation's running session, started when there is none. Makes room by stopping the least recently used idle one. */
async function acquireSession(userId: string, conversationId: string): Promise<Session> {
  const state = broker();
  const key = sessionKey(userId, conversationId);
  const existing = state.sessions.get(key);
  if (existing && !existing.closed && existing.flags === flagsFor(state.settings)) return existing;
  if (existing) await closeSession(existing);
  if (!await fileExists(obscuraBinaryPath("obscura"))) throw new Error("The browser is not installed. An administrator has to add the Obscura binaries in Harness settings.");
  while (state.sessions.size >= state.settings.maxSessions) {
    const idle = [...state.sessions.values()].filter(session => session.busy === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (!idle) throw new Error("Every browser session on this server is busy. Try again in a moment.");
    await closeSession(idle);
  }
  const session = startSession(userId, conversationId, state.settings);
  state.sessions.set(key, session);
  await session.ready;
  return session;
}

/** Runs `work` on the conversation's session after every earlier call on it has finished. */
async function withSession<T>(userId: string, conversationId: string, work: (session: Session) => Promise<T>): Promise<T> {
  const session = await acquireSession(userId, conversationId);
  session.busy += 1; session.lastUsed = Date.now();
  const run = session.queue.then(() => work(session), () => work(session));
  session.queue = run.catch(() => undefined);
  try { return await run; }
  finally { session.busy -= 1; session.lastUsed = Date.now(); }
}

let catalogCache: { flags: string; tools: ToolInfo[] } | undefined;

/** Obscura's tool list. It is the same for every session, so it is read once per binary and kept. */
export async function obscuraTools(userId: string, conversationId: string): Promise<ToolInfo[]> {
  const flags = flagsFor(broker().settings);
  if (catalogCache?.flags === flags) return catalogCache.tools;
  const tools = await withSession(userId, conversationId, async session => (await session.client.listTools()).tools as ToolInfo[]);
  catalogCache = { flags, tools };
  return tools;
}

export async function callObscuraTool(userId: string, conversationId: string, name: string, args: Record<string, unknown>, signal: AbortSignal, timeoutMs = 90_000): Promise<CallResult> {
  return withSession(userId, conversationId, async session => {
    try {
      return await session.client.callTool({ name, arguments: args }, { signal, timeout: timeoutMs }) as CallResult;
    } catch (error) {
      // A browser that stops answering is restarted on the next call instead of blocking the conversation.
      if (!signal.aborted) void closeSession(session);
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Downloads

const filenameFromUrl = (url: URL) => {
  try { return decodeURIComponent(path.posix.basename(url.pathname)).replace(/[\\/\0]/g, "").trim().slice(0, 200); }
  catch { return ""; }
};

export type ObscuraDownload = { id: string; name: string; size: number; mimeType: string; url: string; markdown: string };

/**
 * Downloads a URL with Obscura (`fetch --dump original`, the raw response body) using a copy of the conversation's
 * profile, so the browser's cookies apply. The bytes go to a temporary file and the transfer is stopped as soon as it
 * passes what is left of the account's private storage; nothing is kept then. A finished file goes into storage.
 */
export async function downloadWithObscura(input: { userId: string; conversationId: string; url: string; name?: string; signal: AbortSignal; settings: ObscuraSettings; timeoutSeconds?: number; onProgress?: (bytes: number, limit: number) => void }): Promise<ObscuraDownload> {
  const url = new URL(input.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP(S) URLs can be downloaded.");
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed.");
  const limit = remainingStorageBytes(input.userId);
  if (limit <= 0) throw new Error("Private storage is full, so nothing can be downloaded.");
  const work = path.join(dataDir, "tmp", `obscura-${randomUUID()}`);
  const profile = path.join(work, "profile");
  const output = path.join(work, "download.bin");
  await fs.mkdir(work, { recursive: true, mode: 0o700 });
  try {
    await fs.cp(obscuraProfileDir(input.userId, input.conversationId), profile, { recursive: true }).catch(() => fs.mkdir(profile, { recursive: true }));
    const args = [...globalArgs(input.settings), "fetch", url.toString(), "--dump", "original", "--quiet", "--storage-dir", profile, "--timeout", String(input.timeoutSeconds ?? 60)];
    const size = await new Promise<number>((resolve, reject) => {
      const child = spawn(obscuraBinaryPath("obscura"), args, { cwd: obscuraDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, RUST_LOG: "error" } });
      const file = createWriteStream(output, { mode: 0o600 });
      let received = 0, stderr = "", failure: Error | undefined, reported = 0;
      const stop = (error: Error) => { if (!failure) { failure = error; child.kill("SIGKILL"); } };
      const abort = () => stop(input.signal.reason instanceof Error ? input.signal.reason : new Error("The download was stopped."));
      input.signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > limit) { stop(new Error(`The file is larger than the ${formatBytes(limit)} left in private storage, so it was not saved.`)); return; }
        file.write(chunk);
        const now = Date.now(); if (now - reported >= 1000) { reported = now; input.onProgress?.(received, limit); }
      });
      child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 4000) stderr += chunk.toString("utf8"); });
      child.on("error", error => stop(error));
      child.on("close", code => {
        input.signal.removeEventListener("abort", abort);
        file.end(() => {
          if (failure) return reject(failure);
          if (code !== 0) return reject(new Error(`The download failed${stderr.trim() ? `: ${stderr.trim().split(/\r?\n/).slice(-3).join(" ")}` : ` (exit ${code}).`}`));
          if (!received) return reject(new Error("The server returned an empty response."));
          resolve(received);
        });
      });
    });
    const name = (input.name || "").replace(/[\\/\0]/g, "").trim().slice(0, 200) || filenameFromUrl(url) || `download-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await assertNotChallengePage(output, url, name);
    const stored = await saveHostFile(output, input.userId, name);
    return { id: stored.metadata.id, name: stored.metadata.name, size, mimeType: stored.metadata.mimeType, url: stored.metadata.url, markdown: stored.markdown };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

const PAGE_EXTENSIONS = new Set(["", ".html", ".htm", ".xhtml", ".php", ".asp", ".aspx", ".jsp"]);

/**
 * A URL that names a file (.pdf, .zip, …) but answered with an HTML page usually hit a bot check or a login page.
 * Storing that page under the file's name would mislead the user, so the download fails with an explanation instead.
 */
async function assertNotChallengePage(file: string, url: URL, name: string) {
  const extension = path.extname(name || url.pathname).toLowerCase();
  if (PAGE_EXTENSIONS.has(extension)) return;
  const handle = await fs.open(file, "r");
  try {
    const head = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const text = head.subarray(0, bytesRead).toString("utf8").trimStart().toLowerCase();
    if (!text.startsWith("<!doctype html") && !text.startsWith("<html")) return;
    const challenge = /just a moment|cf-chl|challenge-platform|captcha|access denied|attention required/.test(text);
    throw new Error(challenge
      ? "The site answered with a bot check page instead of the file. Open the page with browser_navigate first (the check may pass in the browser), then try the download again."
      : "The site answered with a web page instead of the file (it may need a login, or the link points to a download page). Nothing was saved.");
  } finally { await handle.close(); }
}

/** Saves bytes a browser tool returned (a PDF export) into private storage. */
export async function saveObscuraBytes(userId: string, bytes: Buffer, name: string): Promise<ObscuraDownload> {
  if (bytes.length > remainingStorageBytes(userId)) throw new Error("Private storage does not have room for this file.");
  const work = path.join(dataDir, "tmp", `obscura-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true, mode: 0o700 });
  try {
    const file = path.join(work, "file.bin");
    await fs.writeFile(file, bytes, { mode: 0o600 });
    const stored = await saveHostFile(file, userId, name);
    return { id: stored.metadata.id, name: stored.metadata.name, size: bytes.length, mimeType: stored.metadata.mimeType, url: stored.metadata.url, markdown: stored.markdown };
  } finally { await fs.rm(work, { recursive: true, force: true }).catch(() => undefined); }
}

export function formatBytes(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
