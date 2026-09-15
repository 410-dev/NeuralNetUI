import { promises as fs } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright-core";
import type { ModelContentPart } from "./document-processing";
import type { ToolSettings } from "./types";
import { saveGeneratedImage } from "./uploads.ts";

const ACTION_TIMEOUT_MS = 20_000;
const MAX_SESSIONS = 8;
const MAX_SESSIONS_PER_OWNER = 2;
const MAX_TEXT_CHARACTERS = 24_000;
const MAX_SNAPSHOT_CHARACTERS = 32_000;
const MAX_FULL_PAGE_SCREENSHOT_HEIGHT = 1_600;
const DNS_CACHE_TTL_MS = 30_000;
const ALLOWED_ACTIONS = new Set(["open", "inspect", "click", "type", "select", "press", "scroll", "wait", "screenshot", "list_tabs", "new_tab", "switch_tab", "close_tab", "set_tab_metadata", "close"]);
const VIEWPORT = { width: 1280, height: 800 } as const;
const BROWSER_VIEW_ACTIONS = new Set(["click", "drag", "scroll", "key", "insert_text", "navigate", "back", "forward", "reload", "new_tab", "switch_tab", "close_tab"]);

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
  | { action: "list_tabs"; sessionId: string }
  | { action: "new_tab"; sessionId: string; url?: string; label: string; note: string }
  | { action: "switch_tab" | "close_tab"; sessionId: string; tabId: string }
  | { action: "set_tab_metadata"; sessionId: string; tabId: string; label?: string; note?: string }
  | { action: "close"; sessionId: string };

type BrowserTab = { id: string; label: string; note: string; page: Page; createdAt: number };
type BrowserSession = {
  id: string;
  ownerKey: string;
  context: BrowserContext;
  tabs: Map<string, BrowserTab>;
  activeTabId: string;
  maxTabs: number;
  createdAt: number;
  touchedAt: number;
};

export type BrowserToolExecution = { result: unknown; content?: ModelContentPart[] };
export type BrowserTabState = { id: string; title: string; url: string; label: string; note: string; active: boolean };
export type BrowserViewState = { available: boolean; sessionId?: string; activeTabId?: string; tabs: BrowserTabState[]; maxTabs: number; url?: string; title?: string; width: number; height: number; headed: boolean };
export type BrowserViewAction =
  | { action: "click"; sessionId: string; x: number; y: number }
  | { action: "drag"; sessionId: string; x: number; y: number; endX: number; endY: number }
  | { action: "scroll"; sessionId: string; x: number; y: number; deltaX: number; deltaY: number }
  | { action: "key"; sessionId: string; key: string; modifiers: string[] }
  | { action: "insert_text"; sessionId: string; text: string }
  | { action: "navigate"; sessionId: string; url: string }
  | { action: "new_tab"; sessionId: string }
  | { action: "switch_tab" | "close_tab"; sessionId: string; tabId: string }
  | { action: "back" | "forward" | "reload"; sessionId: string };

const sessions = new Map<string, BrowserSession>();
const publicAddressCache = new Map<string, { expiresAt: number; promise: Promise<readonly string[]> }>();
let sharedBrowser: Browser | undefined;
let launchPromise: Promise<Browser> | undefined;

function browserIsHeaded() {
  return process.platform === "win32" || process.platform === "darwin" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

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
  const cacheKey = url.hostname.toLowerCase(); const now = Date.now();
  let cached = publicAddressCache.get(cacheKey);
  if (!cached || cached.expiresAt <= now) {
    const promise = lookup(url.hostname, { all: true }).then(records => records.map(record => record.address));
    if (!publicAddressCache.has(cacheKey) && publicAddressCache.size >= 256) publicAddressCache.delete(publicAddressCache.keys().next().value!);
    cached = { expiresAt: now + DNS_CACHE_TTL_MS, promise }; publicAddressCache.set(cacheKey, cached);
    void promise.catch(() => { if (publicAddressCache.get(cacheKey)?.promise === promise) publicAddressCache.delete(cacheKey); });
  }
  const addresses = await cached.promise;
  if (!addresses.length || addresses.some(privateBrowserAddress)) throw new Error("Private or local network pages cannot be opened.");
  return url;
}

function stringValue(value: unknown, name: string, required = true) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (required && !normalized) throw new Error(`${name} is required.`);
  if (normalized.length > 2_000) throw new Error(`${name} is too long.`);
  return normalized;
}

function metadataValue(value: unknown, name: string, maximum: number) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${name} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maximum) throw new Error(`${name} is too long.`);
  return normalized;
}

function optionalMetadataValue(value: unknown, name: string, maximum: number) {
  if (value === undefined || value === null) return undefined;
  return metadataValue(value, name, maximum);
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
  if (action === "inspect" || action === "list_tabs" || action === "close") return { action, sessionId };
  if (action === "new_tab") return { action, sessionId, url: stringValue(args.url, "url", false) || undefined, label: metadataValue(args.label, "label", 80), note: metadataValue(args.note, "note", 1_000) };
  if (action === "switch_tab" || action === "close_tab") return { action, sessionId, tabId: stringValue(args.tab_id, "tab_id") };
  if (action === "set_tab_metadata") {
    const label = optionalMetadataValue(args.label, "label", 80);
    const note = optionalMetadataValue(args.note, "note", 1_000);
    if (label === undefined && note === undefined) throw new Error("set_tab_metadata requires label or note.");
    return { action, sessionId, tabId: stringValue(args.tab_id, "tab_id"), label, note };
  }
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

export function browserExecutableCandidates(platform: NodeJS.Platform, environment: Record<string, string | undefined>, bundled: string, packaged?: string) {
  return [
    platform === "win32" ? path.join(environment.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe") : undefined,
    platform === "win32" ? path.join(environment["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    platform === "win32" ? path.join(environment.PROGRAMFILES || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    platform === "win32" ? path.join(environment.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe") : undefined,
    platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
    platform === "linux" ? "/usr/bin/google-chrome" : undefined,
    packaged,
    bundled,
    platform === "linux" ? "/usr/bin/chromium" : undefined,
    platform === "linux" ? "/usr/bin/chromium-browser" : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export function browserLaunchArguments(headed: boolean, platform: NodeJS.Platform = process.platform) {
  return [
    "--disable-blink-features=AutomationControlled",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
    ...(platform === "linux" ? ["--disable-dev-shm-usage", "--no-sandbox"] : []),
    ...(headed ? ["--window-position=-32000,-32000", `--window-size=${VIEWPORT.width},${VIEWPORT.height}`] : []),
  ];
}

async function executablePath() {
  const configured = process.env.NEURAL_CHAT_BROWSER_EXECUTABLE;
  const bundled = chromium.executablePath();
  const packaged = await findPackagedBrowser(path.join(process.cwd(), "browser"));
  const candidates = [
    configured,
    ...browserExecutableCandidates(process.platform, process.env, bundled, packaged),
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
      headless: !browserIsHeaded(),
      ignoreDefaultArgs: ["--enable-automation"],
      args: browserLaunchArguments(browserIsHeaded()),
    });
    browser.on("disconnected", () => {
      if (sharedBrowser !== browser) return;
      sharedBrowser = undefined;
      // The pages are already gone; release their registry slots so a crashed browser cannot
      // permanently exhaust the explicit session limits.
      sessions.clear();
    });
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

async function guardRoute(route: Route) {
  const raw = route.request().url();
  if (raw === "about:blank" || raw.startsWith("data:") || raw.startsWith("blob:")) return route.continue();
  try { await assertPublicBrowserUrl(raw); await route.continue(); }
  catch { await route.abort("blockedbyclient"); }
}

function configurePage(page: Page) {
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS);
  page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
  page.on("download", (download) => void download.cancel().catch(() => undefined));
}

function registerTab(session: BrowserSession, page: Page, activate = true) {
  const existing = [...session.tabs.values()].find((tab) => tab.page === page);
  if (existing) { if (activate) session.activeTabId = existing.id; return existing; }
  if (session.tabs.size >= session.maxTabs) { void page.close().catch(() => undefined); return undefined; }
  configurePage(page);
  const tab: BrowserTab = { id: crypto.randomUUID(), label: "", note: "", page, createdAt: Date.now() };
  session.tabs.set(tab.id, tab);
  if (activate) session.activeTabId = tab.id;
  page.on("close", () => {
    session.tabs.delete(tab.id);
    if (session.activeTabId === tab.id) session.activeTabId = [...session.tabs.values()].sort((left, right) => right.createdAt - left.createdAt)[0]?.id || "";
  });
  return tab;
}

function activeTab(session: BrowserSession) {
  const selected = session.tabs.get(session.activeTabId);
  if (selected && !selected.page.isClosed()) return selected;
  const fallback = [...session.tabs.values()].find((tab) => !tab.page.isClosed());
  if (!fallback) throw new Error("The browser session has no open tabs.");
  session.activeTabId = fallback.id;
  return fallback;
}

function ownedTab(session: BrowserSession, tabId: string) {
  const tab = session.tabs.get(tabId);
  if (!tab || tab.page.isClosed()) throw new Error("Browser tab was not found or has been closed.");
  return tab;
}

async function newSession(ownerKey: string, maxTabs: number) {
  const owned = [...sessions.values()].filter((session) => session.ownerKey === ownerKey);
  if (owned.length >= MAX_SESSIONS_PER_OWNER) throw new Error(`This conversation is limited to ${MAX_SESSIONS_PER_OWNER} browser sessions. Close an existing browser session before opening another.`);
  if (sessions.size >= MAX_SESSIONS) throw new Error(`The browser is limited to ${MAX_SESSIONS} active sessions. Close an existing browser session before opening another.`);
  const context = await (await browserInstance()).newContext({ viewport: VIEWPORT, acceptDownloads: false, serviceWorkers: "block" });
  await context.addInitScript(() => { Object.defineProperty(Navigator.prototype, "webdriver", { get: () => undefined, configurable: true }); });
  await context.route("**/*", guardRoute);
  await context.routeWebSocket("**/*", (webSocket) => webSocket.close());
  const session: BrowserSession = { id: crypto.randomUUID(), ownerKey, context, tabs: new Map(), activeTabId: "", maxTabs, createdAt: Date.now(), touchedAt: Date.now() };
  const page = await context.newPage();
  registerTab(session, page);
  context.on("page", (nextPage) => {
    if (nextPage !== page) registerTab(session, nextPage);
  });
  sessions.set(session.id, session);
  return session;
}

function ownedSession(ownerKey: string, sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session || session.ownerKey !== ownerKey) throw new Error("Browser session was not found or does not belong to this conversation.");
  session.touchedAt = Date.now();
  return session;
}

export function assertOwnedBrowserSession(ownerKey: string, sessionId: string) {
  return ownedSession(ownerKey, sessionId);
}

function conversationSession(userId: string, conversationId: string, sessionId?: string) {
  const ownerKey = `${userId}:${conversationId}`;
  const legacyPrefix = `${ownerKey}:`;
  const matching = [...sessions.values()].filter((session) => (session.ownerKey === ownerKey || session.ownerKey.startsWith(legacyPrefix)) && (!sessionId || session.id === sessionId));
  const session = matching.sort((left, right) => right.touchedAt - left.touchedAt)[0];
  if (session) session.touchedAt = Date.now();
  return session;
}

export function normalizeBrowserViewAction(value: unknown): BrowserViewAction {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const action = String(input.action || "").toLowerCase();
  if (!BROWSER_VIEW_ACTIONS.has(action)) throw new Error("A supported browser view action is required.");
  const sessionId = stringValue(input.sessionId, "sessionId");
  const coordinate = (raw: unknown, maximum: number) => {
    const number = Number(raw);
    if (!Number.isFinite(number)) throw new Error("Browser coordinates must be finite numbers.");
    return Math.max(0, Math.min(maximum, number));
  };
  if (action === "click") return { action, sessionId, x: coordinate(input.x, VIEWPORT.width), y: coordinate(input.y, VIEWPORT.height) };
  if (action === "drag") return { action, sessionId, x: coordinate(input.x, VIEWPORT.width), y: coordinate(input.y, VIEWPORT.height), endX: coordinate(input.endX, VIEWPORT.width), endY: coordinate(input.endY, VIEWPORT.height) };
  if (action === "scroll") {
    const finiteDelta = (raw: unknown) => Number.isFinite(Number(raw)) ? Math.max(-10_000, Math.min(10_000, Number(raw))) : 0;
    return { action, sessionId, x: coordinate(input.x, VIEWPORT.width), y: coordinate(input.y, VIEWPORT.height), deltaX: finiteDelta(input.deltaX), deltaY: finiteDelta(input.deltaY) };
  }
  if (action === "key") {
    const key = stringValue(input.key, "key");
    if (key.length > 80) throw new Error("The browser key is too long.");
    const allowedModifiers = new Set(["Alt", "Control", "Meta", "Shift"]);
    const modifiers = Array.isArray(input.modifiers) ? input.modifiers.map(String).filter((item) => allowedModifiers.has(item)).slice(0, 4) : [];
    return { action, sessionId, key, modifiers };
  }
  if (action === "insert_text") {
    const text = typeof input.text === "string" ? input.text : "";
    if (!text || text.length > 4_000) throw new Error("Browser text must contain 1 to 4000 characters.");
    return { action, sessionId, text };
  }
  if (action === "navigate") return { action, sessionId, url: stringValue(input.url, "url") };
  if (action === "new_tab") return { action, sessionId };
  if (action === "switch_tab" || action === "close_tab") return { action, sessionId, tabId: stringValue(input.tabId, "tabId") };
  return { action: action as "back" | "forward" | "reload", sessionId };
}

async function tabStates(session: BrowserSession) {
  return Promise.all([...session.tabs.values()].filter((tab) => !tab.page.isClosed()).map(async (tab): Promise<BrowserTabState> => ({
    id: tab.id,
    title: await tab.page.title().catch(() => ""),
    url: tab.page.url(),
    label: tab.label,
    note: tab.note,
    active: tab.id === session.activeTabId,
  })));
}

async function viewState(session?: BrowserSession): Promise<BrowserViewState> {
  if (!session || !session.tabs.size) return { available: false, tabs: [], maxTabs: session?.maxTabs || 0, width: VIEWPORT.width, height: VIEWPORT.height, headed: browserIsHeaded() };
  const tab = activeTab(session);
  return { available: true, sessionId: session.id, activeTabId: tab.id, tabs: await tabStates(session), maxTabs: session.maxTabs, url: tab.page.url(), title: await tab.page.title().catch(() => ""), width: VIEWPORT.width, height: VIEWPORT.height, headed: browserIsHeaded() };
}

export async function browserViewState(userId: string, conversationId: string) {
  return viewState(conversationSession(userId, conversationId));
}

export async function captureBrowserView(userId: string, conversationId: string, sessionId: string) {
  const session = conversationSession(userId, conversationId, sessionId);
  if (!session) throw new Error("Browser session was not found or has expired.");
  return activeTab(session).page.screenshot({ type: "jpeg", quality: 76, animations: "disabled" });
}

export async function controlBrowserView(userId: string, conversationId: string, raw: unknown) {
  const action = normalizeBrowserViewAction(raw);
  const session = conversationSession(userId, conversationId, action.sessionId);
  if (!session) throw new Error("Browser session was not found or has expired.");
  session.touchedAt = Date.now();
  if (action.action === "new_tab") {
    if (session.tabs.size >= session.maxTabs) throw new Error(`This browser session is limited to ${session.maxTabs} tabs.`);
    const page = await session.context.newPage(); registerTab(session, page);
    return viewState(session);
  }
  if (action.action === "switch_tab") { session.activeTabId = ownedTab(session, action.tabId).id; await activeTab(session).page.bringToFront(); return viewState(session); }
  if (action.action === "close_tab") {
    const tab = ownedTab(session, action.tabId); await tab.page.close();
    if (!session.tabs.size) { await closeSession(session); return viewState(); }
    return viewState(session);
  }
  const page = activeTab(session).page;
  if (action.action === "click") await page.mouse.click(action.x, action.y);
  if (action.action === "drag") {
    await page.mouse.move(action.x, action.y); await page.mouse.down();
    await page.mouse.move(action.endX, action.endY, { steps: 12 }); await page.mouse.up();
  }
  if (action.action === "scroll") { await page.mouse.move(action.x, action.y); await page.mouse.wheel(action.deltaX, action.deltaY); }
  if (action.action === "key") await page.keyboard.press([...action.modifiers, action.key].join("+"));
  if (action.action === "insert_text") await page.keyboard.insertText(action.text);
  if (action.action === "navigate") await page.goto((await assertPublicBrowserUrl(action.url)).toString(), { waitUntil: "domcontentloaded" });
  if (action.action === "back") await page.goBack({ waitUntil: "domcontentloaded" });
  if (action.action === "forward") await page.goForward({ waitUntil: "domcontentloaded" });
  if (action.action === "reload") await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(120);
  return viewState(session);
}

function targetSelector(target: string) {
  if (/^e\d+$/.test(target)) return `[data-neural-browser-ref="${target}"]`;
  return target;
}

async function snapshot(page: Page, configuredCharacterLimit = MAX_TEXT_CHARACTERS) {
  return page.evaluate(({ characterLimit, serializedLimit }) => {
    const clipped = (value: string | null | undefined, maximum: number) => value?.replace(/\s+/g, " ").trim().slice(0, maximum) || undefined;
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
        text: clipped(element.innerText || input.value, 240),
        label: clipped(element.getAttribute("aria-label") || element.getAttribute("title"), 240),
        placeholder: clipped(input.placeholder, 240),
        type: input.type || undefined,
        href: element instanceof HTMLAnchorElement ? element.href.slice(0, 600) : undefined,
        disabled: "disabled" in input ? Boolean(input.disabled) : undefined,
      };
    });
    const bodyText = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    const result = { title: document.title.slice(0, 500), url: location.href.slice(0, 2_000), text: bodyText.slice(0, characterLimit), truncated: bodyText.length > characterLimit, elements };
    while (result.elements.length && JSON.stringify(result).length > serializedLimit) result.elements.pop();
    if (JSON.stringify(result).length > serializedLimit) {
      const withoutText = JSON.stringify({ ...result, text: "" }).length;
      result.text = result.text.slice(0, Math.max(0, serializedLimit - withoutText));
      result.truncated = true;
      while (result.text && JSON.stringify(result).length > serializedLimit) {
        const excess = JSON.stringify(result).length - serializedLimit;
        result.text = result.text.slice(0, Math.max(0, result.text.length - Math.max(1, excess)));
      }
    }
    return result;
  }, { characterLimit: Math.min(MAX_TEXT_CHARACTERS, Math.max(1_000, configuredCharacterLimit)), serializedLimit: MAX_SNAPSHOT_CHARACTERS });
}

export function browserImageTokenEstimate(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1600;
  // Two tokens per 14x14 vision patch is deliberately conservative across local multimodal models.
  return Math.max(1600, Math.ceil(width / 14) * Math.ceil(height / 14) * 2);
}

export function boundedBrowserScreenshot(width: number, pageHeight: number, fullPage: boolean) {
  const boundedWidth = Math.min(1440, Math.max(1, Math.floor(width)));
  const requestedHeight = fullPage ? pageHeight : VIEWPORT.height;
  const height = Math.min(fullPage ? MAX_FULL_PAGE_SCREENSHOT_HEIGHT : VIEWPORT.height, Math.max(1, Math.floor(requestedHeight)));
  return { width: boundedWidth, height, pageHeight: Math.max(1, Math.floor(pageHeight)), truncated: fullPage && pageHeight > height };
}

async function capture(session: BrowserSession, fullPage: boolean, userId?: string) {
  if (!userId) throw new Error("A storage owner is required for browser screenshots.");
  const tab = activeTab(session); const page = tab.page;
  const pageDimensions = await page.evaluate(() => ({ width: Math.max(document.documentElement.clientWidth, document.body?.scrollWidth || 0), height: Math.max(document.documentElement.clientHeight, document.body?.scrollHeight || 0) }));
  const dimensions = boundedBrowserScreenshot(fullPage ? pageDimensions.width : page.viewportSize()?.width || VIEWPORT.width, pageDimensions.height, fullPage);
  const buffer = await page.screenshot({ type: "jpeg", quality: 78, animations: "disabled", ...(fullPage ? { clip: { x: 0, y: 0, width: dimensions.width, height: dimensions.height } } : {}) });
  const contextTokens = browserImageTokenEstimate(dimensions.width, dimensions.height);
  const stored = await saveGeneratedImage(buffer, userId, `browser-screenshot-${new Date().toISOString().replace(/[:.]/g,"-")}.jpg`, { width: dimensions.width, height: dimensions.height }, "image/jpeg");
  return {
    result: { sessionId: session.id, tabId: tab.id, url: page.url(), screenshot: true, fullPage, bounded: true, capturedWidth: dimensions.width, capturedHeight: dimensions.height, pageHeight: dimensions.pageHeight, truncated: dimensions.truncated, contextTokens, size: buffer.length, attachment: stored.metadata, storage: "user" },
    content: [
      { type: "text", text: JSON.stringify({ sessionId: session.id, tabId: tab.id, url: page.url(), screenshot: true, fullPage, capturedWidth: dimensions.width, capturedHeight: dimensions.height, pageHeight: dimensions.pageHeight, truncated: dimensions.truncated }) },
      { type: "image_file", file_path: stored.path, mime_type: "image/jpeg", _neural_context_tokens: contextTokens },
    ] satisfies ModelContentPart[],
  };
}

async function pause(seconds: number) {
  if (seconds > 0) await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
}

export async function executeBrowserTool(ownerKey: string, rawArguments: string, settings: ToolSettings, userId?: string): Promise<BrowserToolExecution> {
  let raw: unknown;
  try { raw = JSON.parse(rawArguments || "{}"); } catch { throw new Error("Browser tool arguments were not valid JSON."); }
  const action = normalizeBrowserAction(raw);
  if (action.action === "open") {
    const url = await assertPublicBrowserUrl(action.url);
    const session = await newSession(ownerKey, settings.maxBrowserTabs);
    try {
      const tab = activeTab(session); await tab.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await pause(action.waitSeconds);
      if (action.screenshot) return capture(session, action.fullPage, userId);
      const state = await snapshot(tab.page, settings.textCharacterLimit);
      const result = { sessionId: session.id, tabId: tab.id, maxTabs: session.maxTabs, ...state };
      return { result, content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) { await closeSession(session); throw error; }
  }
  const session = ownedSession(ownerKey, action.sessionId);
  if (action.action === "close") { await closeSession(session); return { result: { sessionId: action.sessionId, closed: true } }; }
  if (action.action === "list_tabs") return { result: { sessionId: session.id, activeTabId: session.activeTabId, maxTabs: session.maxTabs, tabs: await tabStates(session) } };
  if (action.action === "new_tab") {
    if (session.tabs.size >= session.maxTabs) throw new Error(`This browser session is limited to ${session.maxTabs} tabs.`);
    const url = action.url ? await assertPublicBrowserUrl(action.url) : undefined;
    const page = await session.context.newPage(); const tab = registerTab(session, page);
    if (!tab) throw new Error(`This browser session is limited to ${session.maxTabs} tabs.`);
    tab.label = action.label; tab.note = action.note;
    if (url) await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(120);
    const state = await snapshot(page, settings.textCharacterLimit); const result = { sessionId: session.id, tabId: tab.id, maxTabs: session.maxTabs, ...state };
    return { result, content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  if (action.action === "switch_tab") {
    const tab = ownedTab(session, action.tabId); session.activeTabId = tab.id; await tab.page.bringToFront();
    const state = await snapshot(tab.page, settings.textCharacterLimit); const result = { sessionId: session.id, tabId: tab.id, ...state };
    return { result, content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  if (action.action === "set_tab_metadata") {
    const tab = ownedTab(session, action.tabId);
    if (action.label !== undefined) tab.label = action.label;
    if (action.note !== undefined) tab.note = action.note;
    return { result: { sessionId: session.id, tabId: tab.id, label: tab.label, note: tab.note, tabs: await tabStates(session) } };
  }
  if (action.action === "close_tab") {
    const tab = ownedTab(session, action.tabId); await tab.page.close();
    if (!session.tabs.size) { await closeSession(session); return { result: { sessionId: session.id, tabId: tab.id, closed: true, sessionClosed: true } }; }
    const next = activeTab(session); const state = await snapshot(next.page, settings.textCharacterLimit); const result = { sessionId: session.id, tabId: next.id, closedTabId: tab.id, ...state };
    return { result, content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  const page = activeTab(session).page;
  if (action.action === "wait") await pause(action.waitSeconds);
  if (action.action === "click") await page.locator(targetSelector(action.target)).first().click();
  if (action.action === "type") await page.locator(targetSelector(action.target)).first().fill(action.text);
  if (action.action === "select") await page.locator(targetSelector(action.target)).first().selectOption(action.value);
  if (action.action === "press") {
    if (action.target) await page.locator(targetSelector(action.target)).first().press(action.key);
    else await page.keyboard.press(action.key);
  }
  if (action.action === "scroll") await page.mouse.wheel(0, action.deltaY);
  if (action.action === "screenshot") { await pause(action.waitSeconds); return capture(session, action.fullPage, userId); }
  await page.waitForTimeout(250);
  const state = await snapshot(page, settings.textCharacterLimit); const tab = activeTab(session); const result = { sessionId: session.id, tabId: tab.id, ...state };
  return { result, content: [{ type: "text", text: JSON.stringify(result) }] };
}

export async function closeBrowserSessions(ownerKey: string) {
  const legacyPrefix = `${ownerKey}:`;
  await Promise.all([...sessions.values()].filter((session) => session.ownerKey === ownerKey || session.ownerKey.startsWith(legacyPrefix)).map(closeSession));
}
