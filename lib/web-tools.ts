import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import { existsSync } from "node:fs";

export type EnabledWebTools = { internetSearch?: boolean; pageVisit?: boolean; currentTime?: boolean; location?: boolean; multipleChoice?: boolean };

export function toolDefinitions(enabled: EnabledWebTools) {
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
      description: "Ask the user up to 3 concise questions using selectable options. Choose single_select when exactly one answer is appropriate, multi_select when several answers may be chosen, or rank_priorities when order matters. Use for ambiguous preferences, not for already-clear or emotional conversational questions. The tool pauses the turn until the user answers each question.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array", minItems: 1, maxItems: 3,
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

async function limitedText(response: Response, limit = 1_000_000) {
  if (!response.body) return "";
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); break; }
    chunks.push(value);
  }
  const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}

function cleanHtml(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const withoutNoise = html.replace(/<(script|style|noscript|svg|canvas|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ").replace(/<[^>]+>/g, " ");
  const decode = (value: string) => value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  return { title: decode(title).replace(/\s+/g, " ").trim(), text: decode(withoutNoise).replace(/\s+/g, " ").trim().slice(0, 24_000) };
}

export async function internetSearch(query: string, maxResults = 5) {
  const normalized = query.trim().slice(0, 300); if (!normalized) throw new Error("Search query is empty.");
  const virtualEnvPython = path.join(process.cwd(), ".python", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const embeddedPython = path.join(process.cwd(), ".python", "python.exe");
  const interpreter = process.env.NEURAL_CHAT_PYTHON || (existsSync(virtualEnvPython) ? virtualEnvPython : existsSync(embeddedPython) ? embeddedPython : process.platform === "win32" ? "python" : "python3");
  const script = path.join(process.cwd(), "scripts", "ddgs-search.py");
  const payload = JSON.stringify({ query: normalized, max_results: Math.max(1, Math.min(10, maxResults)) });
  return new Promise((resolve, reject) => {
    const child = spawn(interpreter, [script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error("Internet search timed out.")); }, 25_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk)); child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => { clearTimeout(timer); reject(new Error(`Unable to start DDGS. Install Python dependencies from requirements.txt. ${error.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let result: { error?: string; query?: string; results?: unknown[] } = {};
      try { result = JSON.parse(Buffer.concat(stdout).toString("utf8")); }
      catch { return reject(new Error(Buffer.concat(stderr).toString("utf8") || "DDGS returned an invalid response.")); }
      if (code !== 0 || result.error) return reject(new Error(result.error || Buffer.concat(stderr).toString("utf8") || "DDGS search failed."));
      resolve({ query: result.query || normalized, results: result.results || [] });
    });
    child.stdin.end(payload);
  });
}

export async function visitPage(rawUrl: string) {
  let url = await assertPublicUrl(rawUrl); let response: Response | undefined;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "NeuralChat/1.0 (+local page reader)", Accept: "text/html, text/plain;q=0.9" } });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location"); if (!location) break;
    url = await assertPublicUrl(new URL(location, url).toString());
  }
  if (!response?.ok) throw new Error(`Page responded with ${response?.status || "an error"}.`);
  const contentType = response.headers.get("content-type") || "";
  if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(contentType)) throw new Error("This page is not readable text or HTML.");
  const raw = await limitedText(response); const page = contentType.includes("html") || contentType.includes("xhtml") ? cleanHtml(raw) : { title: "", text: raw.slice(0, 24_000) };
  return { url: url.toString(), ...page };
}

export async function executeWebTool(name: string, rawArguments: string, enabled: EnabledWebTools) {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(rawArguments || "{}"); } catch { throw new Error("Tool arguments were not valid JSON."); }
  if (name === "internet_search" && enabled.internetSearch) return internetSearch(String(args.query || ""), Number(args.max_results || 5));
  if (name === "visit_page" && enabled.pageVisit) return visitPage(String(args.url || ""));
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

export async function reverseGeocode(latitude: number, longitude: number, accuracy?: number) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error("The browser returned invalid coordinates.");
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2"); url.searchParams.set("lat", String(latitude)); url.searchParams.set("lon", String(longitude)); url.searchParams.set("zoom", "18"); url.searchParams.set("addressdetails", "1");
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "NeuralChat/1.3 location-tool", "Accept-Language": "ko,en;q=0.8" } });
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
