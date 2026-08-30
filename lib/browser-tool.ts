import { promises as fs } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright-core";
import type { ModelContentPart } from "./document-processing";

const ACTION_TIMEOUT_MS = 20_000;
const SESSION_TTL_MS = 10 * 60_000;
const MAX_SESSIONS = 8;
const MAX_SESSIONS_PER_OWNER = 2;
const MAX_TEXT_CHARACTERS = 24_000;
const ALLOWED_ACTIONS = new Set(["open", "inspect", "click", "type", "select", "press", "scroll", "wait", "screenshot", "close"]);

type BrowserAction =
  | { action: "open"; url: string; waitSeconds: number; screenshot: boolean; fullPage: boolean }
  | { action: "inspect"; sessionId: string }
  | { action: "click"; sessionId: string; target: string }
  | { action: "type"; sessionId: string; target: string; text: string }
  | { action: "select"; sessionId: string; target: string; value: string }
  | { action: "press"; sessionId: string; target?: string; key: string }
  | { action: "scroll"; sessionId: string; deltaY: number }
  | { action: "wait"; sessionId: string; waitSeconds: number }
  | { action: "screenshot"; sessionId: string; waitSeconds: number; fullPage: boolean }
  | { action: "close"; sessionId: string };

type BrowserSession = {
  id: string;
  ownerKey: string;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  touchedAt: number;
};

export type BrowserToolExecution = { result: unknown; content?: ModelContentPart[] };

const sessions = new Map<string, BrowserSession>();
let sharedBrowser: Browser | undefined;
let launchPromise: Promise<Browser> | undefined;

export function privateBrowserAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:") && isIP(normalized.slice(7)) === 4) return privateBrowserAddress(normalized.slice(7));
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254 ||
      parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168 || parts[0] >= 224;
  }
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.");
}

async function assertPublicBrowserUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The browser only opens public HTTP(S) URLs.");
  if (url.username || url.password) throw new Error("Credential-bearing URLs are not allowed.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateBrowserAddress(address))) throw new Error("Private or local network pages cannot be opened.");
  return url;
}

function stringValue(value: unknown, name: string, required = true) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (required && !normalized) throw new Error(`${name} is required.`);
  if (normalized.length > 2_000) throw new Error(`${name} is too long.`);
  return normalized;
}

function waitSeconds(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.min(30, number)) : 0;
}

export function normalizeBrowserAction(value: unknown): BrowserAction {
  const args = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const action = String(args.action || "").toLowerCase();
  if (!ALLOWED_ACTIONS.has(action)) throw new Error("A supported browser action is required.");
  if (action === "open") return { action, url: stringValue(args.url, "url"), waitSeconds: waitSeconds(args.wait_seconds), screenshot: args.screenshot === true, fullPage: args.full_page === true };
  const sessionId = stringValue(args.session_id, "session_id");
  if (action === "inspect" || action === "close") return { action, sessionId };
  if (action === "wait") return { action, sessionId, waitSeconds: waitSeconds(args.wait_seconds) };
  if (action === "screenshot") return { action, sessionId, waitSeconds: waitSeconds(args.wait_seconds), fullPage: args.full_page === true };
  if (action === "scroll") {
    const rawDelta = Number(args.delta_y ?? 700);
    return { action, sessionId, deltaY: Number.isFinite(rawDelta) ? Math.max(-10_000, Math.min(10_000, rawDelta)) : 700 };
  }
  const target = stringValue(args.target, "target", action === "press" ? false : true) || undefined;
  if (action === "click") return { action, sessionId, target: target! };
  if (action === "type") return { action, sessionId, target: target!, text: stringValue(args.text, "text") };
  if (action === "select") return { action, sessionId, target: target!, value: stringValue(args.value, "value") };
  return { action: "press", sessionId, target, key: stringValue(args.key, "key") };
}

async function executablePath() {
  const configured = process.env.NEURAL_CHAT_BROWSER_EXECUTABLE;
  const bundled = chromium.executablePath();
  const packaged = await findPackagedBrowser(path.join(process.cwd(), "browser"));
  const candidates = [
    configured,
    packaged,
    bundled,
    process.platform === "win32" ? path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.platform === "win32" ? path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.platform === "win32" ? path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.platform === "linux" ? "/usr/bin/chromium" : undefined,
    process.platform === "linux" ? "/usr/bin/chromium-browser" : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
    process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { /* try the next supported browser */ }
  }
  throw new Error("No Chromium browser was found. Install Chrome/Edge, run `npm run browser:install`, or set NEURAL_CHAT_BROWSER_EXECUTABLE.");
}

async function findPackagedBrowser(root: string): Promise<string | undefined> {
  const executableNames = process.platform === "win32" ? new Set(["chrome.exe", "headless_shell.exe"]) : new Set(["chrome", "headless_shell"]);
  async function visit(directory: string, depth: number): Promise<string | undefined> {
    if (depth > 4) return undefined;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return undefined; }
    for (const entry of entries) if (entry.isFile() && executableNames.has(entry.name)) return path.join(directory, entry.name);
    for (const entry of entries) if (entry.isDirectory()) {
      const found = await visit(path.join(directory, entry.name), depth + 1); if (found) return found;
    }
    return undefined;
  }
  return visit(root, 0);
}

async function browserInstance() {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  if (!launchPromise) launchPromise = (async () => {
    const browser = await chromium.launch({
      executablePath: await executablePath(),
      headless: true,
      args: process.platform === "linux" ? ["--disable-dev-shm-usage", "--no-sandbox"] : [],
    });
    browser.on("disconnected", () => { if (sharedBrowser === browser) sharedBrowser = undefined; });
    sharedBrowser = browser;
    return browser;
  })().finally(() => { launchPromise = undefined; });
  return launchPromise;
}

async function closeSession(session: BrowserSession) {
  sessions.delete(session.id);
  await session.context.close().catch(() => undefined);
  if (!sessions.size && sharedBrowser) {
    const browser = sharedBrowser; sharedBrowser = undefined;
    await browser.close().catch(() => undefined);
  }
}

async function cleanupSessions() {
  const expired = [...sessions.values()].filter((session) => Date.now() - session.touchedAt > SESSION_TTL_MS);
  await Promise.all(expired.map(closeSession));
}

async function guardRoute(route: Route) {
  const raw = route.request().url();
  if (raw === "about:blank" || raw.startsWith("data:") || raw.startsWith("blob:")) return route.continue();
  try { await assertPublicBrowserUrl(raw); await route.continue(); }
  catch { await route.abort("blockedbyclient"); }
}

async function newSession(ownerKey: string) {
  await cleanupSessions();
  const owned = [...sessions.values()].filter((session) => session.ownerKey === ownerKey).sort((left, right) => left.touchedAt - right.touchedAt);
  while (owned.length >= MAX_SESSIONS_PER_OWNER) await closeSession(owned.shift()!);
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((left, right) => left.touchedAt - right.touchedAt)[0];
    if (oldest) await closeSession(oldest);
  }
  const context = await (await browserInstance()).newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: false, serviceWorkers: "block" });
  await context.route("**/*", guardRoute);
  await context.routeWebSocket("**/*", (webSocket) => webSocket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS);
  page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
  page.on("download", (download) => void download.cancel().catch(() => undefined));
  const session: BrowserSession = { id: crypto.randomUUID(), ownerKey, context, page, createdAt: Date.now(), touchedAt: Date.now() };
  context.on("page", (nextPage) => {
    if (nextPage === page) return;
    nextPage.setDefaultTimeout(ACTION_TIMEOUT_MS); nextPage.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS);
    nextPage.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
    nextPage.on("download", (download) => void download.cancel().catch(() => undefined));
    session.page = nextPage;
  });
  sessions.set(session.id, session);
  return session;
}

function ownedSession(ownerKey: string, sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session || session.ownerKey !== ownerKey) throw new Error("Browser session was not found or has expired.");
  session.touchedAt = Date.now();
  return session;
}

function targetSelector(target: string) {
  if (/^e\d+$/.test(target)) return `[data-neural-browser-ref="${target}"]`;
  return target;
}

async function snapshot(page: Page) {
  return page.evaluate((characterLimit) => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("a[href],button,input,textarea,select,[role=button],[role=link],[contenteditable=true]"));
    const elements = candidates.filter((element) => {
      const style = getComputedStyle(element); const bounds = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && bounds.width > 0 && bounds.height > 0;
    }).slice(0, 120).map((element, index) => {
      const ref = `e${index + 1}`; element.dataset.neuralBrowserRef = ref;
      const input = element as HTMLInputElement;
      return {
        ref,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || undefined,
        text: (element.innerText || input.value || "").replace(/\s+/g, " ").trim().slice(0, 240) || undefined,
        label: element.getAttribute("aria-label") || element.getAttribute("title") || undefined,
        placeholder: input.placeholder || undefined,
        type: input.type || undefined,
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        disabled: "disabled" in input ? Boolean(input.disabled) : undefined,
      };
    });
    const bodyText = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    return { title: document.title, url: location.href, text: bodyText.slice(0, characterLimit), truncated: bodyText.length > characterLimit, elements };
  }, MAX_TEXT_CHARACTERS);
}

async function capture(session: BrowserSession, fullPage: boolean) {
  const dimensions = fullPage ? await session.page.evaluate(() => ({
    width: Math.min(1440, Math.max(document.documentElement.clientWidth, document.body?.scrollWidth || 0)),
    height: Math.min(8000, Math.max(document.documentElement.clientHeight, document.body?.scrollHeight || 0)),
  })) : undefined;
  const buffer = await session.page.screenshot({ type: "jpeg", quality: 78, animations: "disabled", ...(dimensions ? { clip: { x: 0, y: 0, ...dimensions } } : {}) });
  return {
    result: { sessionId: session.id, url: session.page.url(), screenshot: true, fullPage, bounded: fullPage, size: buffer.length },
    content: [
      { type: "text", text: JSON.stringify({ sessionId: session.id, url: session.page.url(), screenshot: true, fullPage }) },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${buffer.toString("base64")}` } },
    ] satisfies ModelContentPart[],
  };
}

async function pause(seconds: number) {
  if (seconds > 0) await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
}

export async function executeBrowserTool(ownerKey: string, rawArguments: string): Promise<BrowserToolExecution> {
  let raw: unknown;
  try { raw = JSON.parse(rawArguments || "{}"); } catch { throw new Error("Browser tool arguments were not valid JSON."); }
  const action = normalizeBrowserAction(raw);
  if (action.action === "open") {
    const url = await assertPublicBrowserUrl(action.url);
    const session = await newSession(ownerKey);
    try {
      await session.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await pause(action.waitSeconds);
      if (action.screenshot) return capture(session, action.fullPage);
      const state = await snapshot(session.page);
      return { result: { sessionId: session.id, ...state }, content: [{ type: "text", text: JSON.stringify({ sessionId: session.id, ...state }) }] };
    } catch (error) { await closeSession(session); throw error; }
  }
  const session = ownedSession(ownerKey, action.sessionId);
  if (action.action === "close") { await closeSession(session); return { result: { sessionId: action.sessionId, closed: true } }; }
  if (action.action === "wait") await pause(action.waitSeconds);
  if (action.action === "click") await session.page.locator(targetSelector(action.target)).first().click();
  if (action.action === "type") await session.page.locator(targetSelector(action.target)).first().fill(action.text);
  if (action.action === "select") await session.page.locator(targetSelector(action.target)).first().selectOption(action.value);
  if (action.action === "press") {
    if (action.target) await session.page.locator(targetSelector(action.target)).first().press(action.key);
    else await session.page.keyboard.press(action.key);
  }
  if (action.action === "scroll") await session.page.mouse.wheel(0, action.deltaY);
  if (action.action === "screenshot") { await pause(action.waitSeconds); return capture(session, action.fullPage); }
  await session.page.waitForTimeout(250);
  const state = await snapshot(session.page);
  return { result: { sessionId: session.id, ...state }, content: [{ type: "text", text: JSON.stringify({ sessionId: session.id, ...state }) }] };
}

export async function closeBrowserSessions(ownerKey: string) {
  await Promise.all([...sessions.values()].filter((session) => session.ownerKey === ownerKey).map(closeSession));
}
