import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import { classifyDocument, cleanupTemporaryDocuments, decodeTextDocument, pdfModelContent, sniffDocument, sniffRasterMimeType, type ModelContentPart } from "./document-processing.ts";
import { pageVisitHeaders } from "./page-visit-request.ts";
import type { ToolSettings } from "./types.ts";

export type EnabledWebTools = { internetSearch?: boolean; pageVisit?: boolean; browser?: boolean; storageAccess?: boolean; storageRead?: boolean; storageWrite?: boolean; storageWriteMaxFiles?: number; currentTime?: boolean; location?: boolean; multipleChoice?: boolean; artifact?: boolean; hostComputer?: boolean; mcpConnectionIds?: string[]; mcpToolNames?: Record<string,string[]> };
export type WebToolExecution = { result: unknown; content?: ModelContentPart[] };

export function toolDefinitions(enabled: EnabledWebTools, settings: ToolSettings) {
  const tools: Array<Record<string, unknown>> = [];
  if (enabled.internetSearch) tools.push({
    type: "function",
    function: {
      name: "internet_search",
      description: "Search the public internet with DuckDuckGo. Use this for current or externally verifiable information. Results include titles, URLs, and snippets.",
      parameters: { type: "object", properties: { query: { type: "string", description: "A concise search query" }, max_results: { type: "integer", minimum: 1, maximum: 10, default: 5 } }, required: ["query"], additionalProperties: false },
    },
  });
  if (enabled.pageVisit) tools.push({
    type: "function",
    function: {
      name: "visit_page",
      description: "Visit a public HTTP(S) page and read its title and main text. Use URLs from search results when more detail is needed.",
      parameters: { type: "object", properties: { url: { type: "string", description: "Public http:// or https:// URL" } }, required: ["url"], additionalProperties: false },
    },
  });
  if (enabled.browser) tools.push({
    type: "function",
    function: {
      name: "browser",
      description: `Control a real JavaScript-enabled browser for pages that visit_page cannot render. One session supports up to ${settings.maxBrowserTabs} tabs. Open a session, inspect and interact with its active tab, and use list_tabs, new_tab, switch_tab, close_tab, and set_tab_metadata to organize parallel work. Tab listings include title, URL, model-assigned label, and note. Reuse session_id and tab_id values exactly across tool rounds and later responses in this conversation. If a CAPTCHA or another step needs the person, use request_user; they can operate the same tabs in split view and mark the handoff complete. Tabs remain open after a response ends; close a tab or session only when it is no longer needed.`,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["open", "inspect", "click", "type", "select", "press", "scroll", "wait", "screenshot", "list_tabs", "new_tab", "switch_tab", "close_tab", "set_tab_metadata", "request_user", "close"] },
          url: { type: "string", description: "Public HTTP(S) URL; required for open" },
          session_id: { type: "string", description: "Session returned by open; required for every other action" },
          tab_id: { type: "string", description: "Tab identifier from open, new_tab, or list_tabs; required for switch_tab, close_tab, and set_tab_metadata" },
          label: { type: "string", description: "Short model-assigned tab label for new_tab or set_tab_metadata; omitted fields are preserved and an empty string clears one" },
          note: { type: "string", description: "Model note describing the tab's purpose or findings; omitted fields are preserved and an empty string clears one" },
          target: { type: "string", description: "Element ref such as e3 from the latest snapshot, or a CSS selector" },
          text: { type: "string", description: "Replacement text for type" },
          value: { type: "string", description: "Option value for select" },
          key: { type: "string", description: "Playwright key such as Enter, Tab, or ArrowDown for press" },
          delta_y: { type: "number", minimum: -10000, maximum: 10000, description: "Vertical pixels for scroll" },
          wait_seconds: { type: "number", minimum: 0, maximum: 30, description: "Delay before returning or capturing" },
          screenshot: { type: "boolean", description: "Capture after open and wait_seconds" },
          full_page: { type: "boolean", description: "Capture the complete scrollable page" },
          message: { type: "string", description: "Short instruction shown to the person for request_user" },
        },
        required: ["action"], additionalProperties: false,
      },
    },
  });
  if (enabled.currentTime) tools.push({
    type: "function",
    function: {
      name: "get_current_time",
      description: "Get the user's current date and time, including seconds and IANA time zone. Call this whenever current local time is needed.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  });
  if (enabled.location) tools.push({
    type: "function",
    function: {
      name: "get_current_location",
      description: "Ask the browser for the user's current location, then return coordinates and reverse-geocoded country, region, city, and detailed local administrative area. Use only when location is relevant.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  });
  if (enabled.multipleChoice) tools.push({
    type: "function",
    function: {
      name: "ask_multiple_choice",
      description: `Ask the user up to ${settings.maxMultipleChoiceQuestions} concise questions using selectable options. Choose single_select when exactly one answer is appropriate, multi_select when several answers may be chosen, or rank_priorities when order matters. Use for ambiguous preferences, not for already-clear or emotional conversational questions. The tool pauses the turn until the user answers each question.`,
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array", minItems: 1, maxItems: settings.maxMultipleChoiceQuestions,
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                type: { type: "string", enum: ["single_select", "multi_select", "rank_priorities"] },
                options: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
              },
              required: ["question", "type", "options"], additionalProperties: false,
            },
          },
        },
        required: ["questions"], additionalProperties: false,
      },
    },
  });
  if (enabled.artifact) tools.push({
    type:"function",
    function:{
      name:"create_artifact",
      description:"Create a rich artifact that the user can open beside the conversation. Use HTML for interactive mini-apps or visual documents, CSV for datasets, JSON or XML for structured data, and Markdown for formatted documents. Put the complete source in content. When workspace artifact auto-save is enabled, the result reports the exact storage fileName. A collision with another conversation may append (n); keep using the original artifact title for later updates in this conversation, but use the returned fileName whenever referring to the stored file.",
      parameters:{type:"object",properties:{title:{type:"string",description:"Short artifact title"},kind:{type:"string",enum:["html","csv","json","xml","markdown"]},content:{type:"string",description:"Complete artifact source"}},required:["title","kind","content"],additionalProperties:false},
    },
  });
  return tools;
}

function privateAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || parts[0] === 169 && parts[1] === 254 ||
      parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168 || parts[0] >= 224;
  }
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

async function assertPublicUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP(S) pages can be visited.");
  if (url.username || url.password) throw new Error("Credential-bearing URLs are not allowed.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error("Private or local network pages cannot be visited.");
  return url;
}

function timedSignal(signal: AbortSignal | undefined, milliseconds: number) {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function limitedBuffer(response: Response, limit: number, allowTruncation: boolean, signal?: AbortSignal) {
  const declared = Number(response.headers.get("content-length"));
  if (!allowTruncation && Number.isFinite(declared) && declared > limit) throw new Error(`The file exceeds the configured ${Math.round(limit / 1024 / 1024 * 100) / 100} MB limit.`);
  if (!response.body) return { buffer: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  let truncated = false;
  while (true) {
    signal?.throwIfAborted();
    const { done, value } = await reader.read(); if (done) break;
    if (size + value.byteLength > limit) {
      if (!allowTruncation) { await reader.cancel(); throw new Error(`The file exceeds the configured ${Math.round(limit / 1024 / 1024 * 100) / 100} MB limit.`); }
      const remaining = Math.max(0, limit - size); if (remaining) chunks.push(value.subarray(0, remaining)); size += remaining; truncated = true; await reader.cancel(); break;
    }
    size += value.byteLength; chunks.push(value);
  }
  const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return { buffer: Buffer.from(joined), truncated };
}

function cleanHtml(html: string, characterLimit: number) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const withoutNoise = html.replace(/<(script|style|noscript|svg|canvas|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ").replace(/<[^>]+>/g, " ");
  const decode = (value: string) => value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  const text = decode(withoutNoise).replace(/\s+/g, " ").trim();
  return { title: decode(title).replace(/\s+/g, " ").trim(), text: text.slice(0, characterLimit), truncated: text.length > characterLimit };
}

export async function internetSearch(query: string, maxResults = 5, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const normalized = query.trim().slice(0, 300); if (!normalized) throw new Error("Search query is empty.");
  const virtualEnvPython = path.join(process.cwd(), ".python", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const embeddedPython = path.join(process.cwd(), ".python", "python.exe");
  const interpreter = process.env.NEURAL_CHAT_PYTHON || (existsSync(virtualEnvPython) ? virtualEnvPython : existsSync(embeddedPython) ? embeddedPython : process.platform === "win32" ? "python" : "python3");
  const script = path.join(process.cwd(), "scripts", "ddgs-search.py");
  const payload = JSON.stringify({ query: normalized, max_results: Math.max(1, Math.min(10, maxResults)) });
  return new Promise((resolve, reject) => {
    const child = spawn(interpreter, [script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    let settled = false;
    const finish = (error?: unknown, value?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); error ? reject(error) : resolve(value); };
    const abort = () => { child.kill(); finish(signal?.reason || new DOMException("The operation was aborted.", "AbortError")); };
    const timer = setTimeout(() => { child.kill(); finish(new Error("Internet search timed out.")); }, 25_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk)); child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on("error", (error) => { if (!settled) finish(new Error(`Unable to send the DDGS request: ${error.message}`)); });
    child.on("error", (error) => finish(new Error(`Unable to start DDGS. Install Python dependencies from requirements.txt. ${error.message}`)));
    child.on("close", (code) => {
      if (settled) return;
      let result: { error?: string; query?: string; results?: unknown[] } = {};
      try { result = JSON.parse(Buffer.concat(stdout).toString("utf8")); }
      catch { return finish(new Error(Buffer.concat(stderr).toString("utf8") || "DDGS returned an invalid response.")); }
      if (code !== 0 || result.error) return finish(new Error(result.error || Buffer.concat(stderr).toString("utf8") || "DDGS search failed."));
      finish(undefined, { query: result.query || normalized, results: result.results || [] });
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdin.end(payload);
  });
}

function responseFilename(response: Response, url: URL) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename\s*=\s*["']?([^;"']+)/i.exec(disposition)?.[1];
  try { return decodeURIComponent(encoded || plain || path.basename(url.pathname)); } catch { return path.basename(url.pathname); }
}

async function downloadPdf(response: Response, limit: number, signal?: AbortSignal) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "neural-chat-download-"));
  const target = path.join(workDir, "document.pdf");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) { await fs.rm(workDir, { recursive: true, force: true }); throw new Error(`The PDF exceeds the configured ${Math.round(limit / 1024 / 1024 * 100) / 100} MB limit.`); }
  const file = await fs.open(target, "wx", 0o600); let size = 0;
  try {
    if (!response.body) throw new Error("The server returned no PDF body.");
    const reader = response.body.getReader();
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error(`The PDF exceeds the configured ${Math.round(limit / 1024 / 1024 * 100) / 100} MB limit.`); }
      await file.write(value);
    }
  } catch (error) {
    await file.close().catch(() => undefined); await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined); throw error;
  }
  await file.close();
  const signatureFile = await fs.open(target, "r"); const signature = Buffer.alloc(16);
  try { await signatureFile.read(signature, 0, signature.length, 0); } finally { await signatureFile.close(); }
  if (sniffDocument(signature, "application/pdf") !== "pdf") { await fs.rm(workDir, { recursive: true, force: true }); throw new Error("The URL did not return a valid PDF file."); }
  return { workDir, target, size };
}

export async function visitPage(rawUrl: string, settings: ToolSettings, signal?: AbortSignal): Promise<WebToolExecution> {
  signal?.throwIfAborted();
  await cleanupTemporaryDocuments(settings);
  let url = await assertPublicUrl(rawUrl); let response: Response | undefined;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    response = await fetch(url, { redirect: "manual", signal: timedSignal(signal, 15_000), headers: pageVisitHeaders() });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location"); if (!location) break;
    url = await assertPublicUrl(new URL(location, url).toString());
  }
  if (!response?.ok) throw new Error(`Page responded with ${response?.status || "an error"}.`);
  const contentType = response.headers.get("content-type") || "";
  const filename = responseFilename(response, url);
  const kind = classifyDocument(contentType, filename);
  if (kind === "archive") throw new Error("Archive files are not opened by the page visit tool.");
  if (kind === "pdf") {
    const downloaded = await downloadPdf(response, settings.pdfSizeLimitMb * 1024 * 1024, signal);
    try {
      const processed = await pdfModelContent(downloaded.target, filename || "document.pdf", settings, undefined, signal);
      return { result: { url: url.toString(), contentType, size: downloaded.size, ...processed.result }, content: processed.content };
    } finally { await fs.rm(downloaded.workDir, { recursive: true, force: true }).catch(() => undefined); }
  }
  if (kind === "image") {
    const downloaded = await limitedBuffer(response, settings.imageDownloadLimitMb * 1024 * 1024, false, signal);
    const detectedMimeType = sniffRasterMimeType(downloaded.buffer);
    if (!detectedMimeType) throw new Error("The URL did not return a valid raster image.");
    const mimeType = detectedMimeType;
    return {
      result: { url: url.toString(), type: "image", contentType: mimeType, size: downloaded.buffer.length },
      content: [{ type: "text", text: `[Image loaded from ${url.toString()}]` }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${downloaded.buffer.toString("base64")}` } }],
    };
  }
  const downloaded = await limitedBuffer(response, settings.textDownloadLimitMb * 1024 * 1024, true, signal);
  const sniffed = sniffDocument(downloaded.buffer, contentType, filename);
  if (sniffed !== "text") throw new Error("This URL returned an unsupported binary file.");
  const html = /text\/html|application\/xhtml\+xml/i.test(contentType);
  const decoded = decodeTextDocument(downloaded.buffer, contentType, html ? Number.MAX_SAFE_INTEGER : settings.textCharacterLimit);
  const page = html ? cleanHtml(decoded.text, settings.textCharacterLimit) : { title: "", text: decoded.text, truncated: decoded.truncated };
  const result = { url: url.toString(), contentType, ...page, truncated: downloaded.truncated || page.truncated };
  return { result, content: [{ type: "text", text: JSON.stringify(result) }] };
}

export async function executeWebTool(name: string, rawArguments: string, enabled: EnabledWebTools, settings: ToolSettings, signal?: AbortSignal): Promise<WebToolExecution> {
  signal?.throwIfAborted();
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(rawArguments || "{}"); } catch { throw new Error("Tool arguments were not valid JSON."); }
  if(name==="create_artifact"&&enabled.artifact){
    const kind=String(args.kind||"");const title=String(args.title||"").trim().slice(0,160),content=String(args.content??"");
    if(!["html","csv","json","xml","markdown"].includes(kind)||!title)throw new Error("Artifact title and kind are required.");
    if(Buffer.byteLength(content,"utf8")>1_000_000)throw new Error("Artifacts are limited to 1 MB.");
    return {result:{artifact:{title,kind,content,updatedAt:new Date().toISOString()}}};
  }
  if (name === "internet_search" && enabled.internetSearch) return { result: await internetSearch(String(args.query || ""), Number(args.max_results || 5), signal) };
  if (name === "visit_page" && enabled.pageVisit) return visitPage(String(args.url || ""), settings, signal);
  throw new Error(`Tool ${name} is not enabled.`);
}

export function currentTime(timeZone?: string, locale = "en-US") {
  const validTimeZone = (() => { try { Intl.DateTimeFormat(undefined, { timeZone }).format(); return timeZone; } catch { return undefined; } })();
  const date = new Date();
  return {
    timeZone: validTimeZone || "UTC",
    localTime: new Intl.DateTimeFormat(locale, {
      timeZone: validTimeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "longOffset",
    }).format(date),
    isoUtc: date.toISOString(),
  };
}

export async function reverseGeocode(latitude: number, longitude: number, accuracy?: number, signal?: AbortSignal) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error("The browser returned invalid coordinates.");
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2"); url.searchParams.set("lat", String(latitude)); url.searchParams.set("lon", String(longitude)); url.searchParams.set("zoom", "18"); url.searchParams.set("addressdetails", "1");
  const response = await fetch(url, { signal: timedSignal(signal, 12_000), headers: { "User-Agent": "NeuralChat/1.3 location-tool", "Accept-Language": "ko,en;q=0.8" } });
  if (!response.ok) throw new Error(`Reverse geocoding failed (${response.status}).`);
  const payload = await response.json() as { display_name?: string; address?: Record<string, string> };
  const address = payload.address || {};
  return {
    coordinates: { latitude, longitude, accuracyMeters: accuracy },
    country: address.country, countryCode: address.country_code?.toUpperCase(),
    region: address.state || address.province || address.region,
    city: address.city || address.town || address.county,
    district: address.city_district || address.district || address.borough,
    localArea: address.municipality || address.suburb || address.quarter || address.village || address.hamlet || address.neighbourhood,
    administrativeAreas: address,
    road: address.road, formattedAddress: payload.display_name,
  };
}
