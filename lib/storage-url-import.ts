import { lookup } from "node:dns/promises";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sniffRasterMimeType } from "./document-processing.ts";
import { classifyMcpAddress } from "./mcp-utils.ts";
import { saveHostFile } from "./uploads.ts";

const MAX_REDIRECTS = 4;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const RASTER_EXTENSIONS: Record<string, string> = { "image/png":".png", "image/jpeg":".jpg", "image/webp":".webp", "image/gif":".gif" };

export type UrlImportOptions = { name?: string; limitBytes: number; allowPrivateNetwork: boolean; signal?: AbortSignal };

/**
 * Check a download target. Link-local, reserved and IPv4-mapped addresses are always refused;
 * loopback and private LAN addresses are reachable only for accounts allowed to use them, because
 * self-hosted tool servers often return URLs on the same internal network.
 */
async function assertDownloadTarget(raw: string, allowPrivateNetwork: boolean) {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP(S) URLs can be saved.");
  if (url.username || url.password) throw new Error("Credential-bearing URLs are not allowed.");
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
  if (!addresses.length) throw new Error("The URL host could not be resolved.");
  const classes = addresses.map(item => classifyMcpAddress(item.address));
  if (classes.includes("blocked")) throw new Error("Link-local or reserved addresses cannot be downloaded.");
  if (classes.includes("private") && !allowPrivateNetwork) throw new Error("Private or local network URLs can be saved only by administrator accounts.");
  return url;
}

function limitError(limit: number) { return new Error(`The file exceeds the configured ${Math.round(limit / 1024 / 1024 * 100) / 100} MB download limit.`); }

function responseFilename(response: Response, url: URL) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename\s*=\s*["']?([^;"']+)/i.exec(disposition)?.[1];
  let name = "";
  try { name = decodeURIComponent(encoded || plain || path.posix.basename(url.pathname)); } catch { name = path.posix.basename(url.pathname); }
  return path.basename(name.replace(/\\/g, "/")).trim();
}

/** Stream an HTTP(S) file into the owner's retained private storage and return chat-ready Markdown. */
export async function importUrlToStorage(rawUrl: string, userId: string, options: UrlImportOptions) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]) : AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let url = await assertDownloadTarget(rawUrl, options.allowPrivateNetwork);
  let response: Response | undefined;
  for (let redirects = 0; ; redirects += 1) {
    response = await fetch(url, { redirect: "manual", signal, headers: { accept: "*/*" } });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error("The URL redirected without a location.");
    if (redirects >= MAX_REDIRECTS) throw new Error("The URL redirected too many times.");
    url = await assertDownloadTarget(new URL(location, url).toString(), options.allowPrivateNetwork);
  }
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(`The URL responded with ${response.status}.`); }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.limitBytes) { await response.body?.cancel().catch(() => undefined); throw limitError(options.limitBytes); }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "neural-chat-url-import-"));
  try {
    const target = path.join(workDir, "download");
    const file = await fs.open(target, "wx", 0o600);
    let size = 0; const header: Buffer[] = [];
    try {
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > options.limitBytes) { await reader.cancel().catch(() => undefined); throw limitError(options.limitBytes); }
          if (header.reduce((sum, chunk) => sum + chunk.length, 0) < 32) header.push(Buffer.from(value.subarray(0, 32)));
          await file.write(value);
        }
      }
    } finally { await file.close(); }
    if (!size) throw new Error("The URL returned an empty file.");
    const raster = sniffRasterMimeType(Buffer.concat(header).subarray(0, 32));
    let name = String(options.name || "").trim() || responseFilename(response, url) || "download";
    if (raster && !path.extname(name)) name += RASTER_EXTENSIONS[raster] || "";
    const stored = await saveHostFile(target, userId, name);
    return { ...stored, sourceUrl: url.toString() };
  } finally { await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined); }
}
