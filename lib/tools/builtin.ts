import { DEFAULT_HARNESS_SETTINGS } from "../harness";
import { currentTime, executeWebTool, reverseGeocode, toolDefinitions } from "../web-tools";
import { executeStorageAccessTool, storageAccessToolDefinition } from "../storage-tool";
import { saveArtifactFile } from "../uploads";
import { callObscuraTool, configureObscura, disposeObscuraConversation, downloadWithObscura, formatBytes, obscuraTools, saveObscuraBytes, type ObscuraSettings } from "../obscura";
import { downloadYoutubeVideo, youtubeLanguages, youtubeSubtitles, type YoutubeSettings } from "../youtube";
import type { HarnessSettings } from "../types";
import type { ArtifactKind, ToolEvent } from "../types";
import { builtinToolProvider } from "./catalog";
import { CODE_FUNCTIONS, MAX_CODE_CHARS, normalizeCodeRunResult } from "./code-runner";
import { specFromModelTool } from "./registry";
import type { ToolContext, ToolProvider, ToolProviderSource, ToolSpec } from "./types";
import type { ModelContentPart } from "../document-processing";

/**
 * NeuralNetUI's own tools as providers. Each one is a thin adapter over the module that already implements the
 * tool; the adapters only translate between the registry's contract and those modules.
 */

const manifest = (id: string) => {
  const found = builtinToolProvider(id);
  if (!found) throw new Error(`Unknown built-in tool provider ${id}.`);
  return found;
};

/** Specs from the existing OpenAI-format definition builder, so their wording stays in one place. */
function webSpecs(ctx: ToolContext, switches: Parameters<typeof toolDefinitions>[0]): ToolSpec[] {
  return toolDefinitions(switches, ctx.config.toolSettings).map(specFromModelTool);
}

const webSearch: ToolProvider = {
  manifest: manifest("web-search"),
  tools: ctx => webSpecs(ctx, { internetSearch: true }),
  execute: (name, _args, ctx) => executeWebTool(name, ctx.rawArguments, { internetSearch: true }, ctx.config.toolSettings, ctx.signal),
};

const pageVisit: ToolProvider = {
  manifest: manifest("page-visit"),
  tools: ctx => webSpecs(ctx, { pageVisit: true }),
  execute: (name, _args, ctx) => executeWebTool(name, ctx.rawArguments, { pageVisit: true }, ctx.config.toolSettings, ctx.signal),
};

const time: ToolProvider = {
  manifest: manifest("current-time"),
  tools: ctx => webSpecs(ctx, { currentTime: true }),
  execute: async (_name, _args, ctx) => ({ result: currentTime(ctx.clientContext?.timeZone, ctx.clientContext?.locale || "en-US") }),
};

const location: ToolProvider = {
  manifest: manifest("location"),
  tools: ctx => webSpecs(ctx, { location: true }),
  async execute(_name, _args, ctx) {
    const browserResult = await ctx.waitForUser();
    const value = browserResult && typeof browserResult === "object" ? browserResult as Record<string, unknown> : {};
    if (value.error) return { result: { error: String(value.error) } };
    return { result: await reverseGeocode(Number(value.latitude), Number(value.longitude), Number(value.accuracy), ctx.signal) };
  },
};

function storagePermissions(ctx: ToolContext) {
  return { read: ctx.options.read === true, write: ctx.options.write === true, maxWrites: Number(ctx.options.maxFiles) || 5, writesUsed: storageWriteCount(ctx.history()) };
}

/** Files this conversation's storage tool already wrote, so the per-chat limit spans every reply. */
export function storageWriteCount(events: ToolEvent[]) {
  const seen = new Set<string>(); let count = 0;
  for (const event of events) {
    if (seen.has(event.id) || event.name !== "storage_access" || event.status !== "completed") continue; seen.add(event.id);
    const args = event.arguments && typeof event.arguments === "object" ? event.arguments as Record<string, unknown> : {};
    if (["write", "save_url"].includes(String(args.action || "").toLowerCase())) count++;
  }
  return count;
}

const storage: ToolProvider = {
  manifest: manifest("storage"),
  tools: ctx => {
    const permissions = storagePermissions(ctx);
    return permissions.read || permissions.write ? [specFromModelTool(storageAccessToolDefinition(permissions))] : [];
  },
  execute: (_name, args, ctx) => executeStorageAccessTool(args, ctx.userId, ctx.config.toolSettings, storagePermissions(ctx), ctx.model, ctx.signal),
};

function codeSpecs(timeoutSeconds: number): ToolSpec[] {
  const shared = { type: "object", properties: { code: { type: "string", description: "Complete source to run" } }, required: ["code"], additionalProperties: false };
  return [
    { name: "run_javascript", inputSchema: shared, description: `Run JavaScript in a sandboxed Web Worker inside the user's browser, never on the server. There is no DOM, no network, and no access to the app or its data. Output from console.log/info/warn/error is captured and the value of a top-level \`return\` is reported; top-level await is allowed. Every call starts fresh. Time limit: ${timeoutSeconds} seconds. Use it for calculations, data transformation and checking logic.` },
    { name: "run_python", inputSchema: shared, description: `Run Python 3 (Pyodide, WebAssembly) in a sandbox inside the user's browser, never on the server. print output is captured and the value of the last expression is reported. The standard library is available, and packages bundled with Pyodide (numpy, pandas, sympy, scipy and others) load automatically from import statements. There is no network access apart from those package downloads, nothing is saved, and plots cannot be shown. Every call starts with fresh variables; the first call in a browser tab may take several seconds to load Python. Time limit: ${timeoutSeconds} seconds, not counting loading.` },
  ];
}

/** Code runs only in the person's browser: the server records the request, waits for the browser, and bounds the answer. */
const codeRunner: ToolProvider = {
  manifest: manifest("code-runner"),
  releasesModelWhileRunning: true,
  tools: ctx => codeSpecs(Number(ctx.options.timeoutSeconds) || 30),
  async execute(name, args, ctx) {
    const language = CODE_FUNCTIONS[name];
    if (!language) throw new Error(`Unknown code runner function ${name}.`);
    const code = typeof args.code === "string" ? args.code : "";
    if (!code.trim()) throw new Error("Code is required.");
    if (code.length > MAX_CODE_CHARS) throw new Error(`Code is limited to ${MAX_CODE_CHARS} characters.`);
    ctx.updateEvent({ arguments: { language, code, timeoutSeconds: Number(ctx.options.timeoutSeconds) || 30 } });
    return { result: normalizeCodeRunResult(await ctx.waitForUser(), language) };
  },
};

function validateQuestions(value: unknown, maximum: number) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const questions = Array.isArray(record.questions) ? record.questions.slice(0, maximum) : [];
  if (!questions.length) throw new Error("No multiple-choice questions were provided.");
  return { questions: questions.map((item, index) => {
    const question = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const options = Array.isArray(question.options) ? question.options.map(String).filter(Boolean).slice(0, 4) : [];
    if (options.length < 2) throw new Error("Each multiple-choice question needs 2 to 4 options.");
    const type = ["single_select", "multi_select", "rank_priorities"].includes(String(question.type)) ? String(question.type) : "single_select";
    return { id: `question-${index + 1}`, question: String(question.question || `Question ${index + 1}`), type, options };
  }) };
}

const multipleChoice: ToolProvider = {
  manifest: manifest("multiple-choice"),
  tools: ctx => webSpecs(ctx, { multipleChoice: true }),
  async execute(_name, args, ctx) {
    ctx.updateEvent({ arguments: validateQuestions(args, ctx.config.toolSettings.maxMultipleChoiceQuestions) });
    return { result: await ctx.waitForUser() };
  },
};

const artifact: ToolProvider = {
  manifest: manifest("artifact"),
  tools: ctx => webSpecs(ctx, { artifact: true }),
  async execute(name, _args, ctx) {
    const execution = await executeWebTool(name, ctx.rawArguments, { artifact: true }, ctx.config.toolSettings, ctx.signal);
    const result = execution.result && typeof execution.result === "object" ? execution.result as Record<string, unknown> : {};
    const created = result.artifact && typeof result.artifact === "object" ? result.artifact as Record<string, unknown> : undefined;
    const autoSave = (ctx.config.harnessSettings || DEFAULT_HARNESS_SETTINGS).artifactAutoSaveToStorage;
    if (!autoSave || !created) return { ...execution, result: { ...result, storage: { saved: false, autoSave: false } } };
    try {
      const stored = await saveArtifactFile(String(created.title || "Artifact"), String(created.kind || "") as ArtifactKind, String(created.content ?? ""), ctx.userId, ctx.conversationId);
      const message = stored.action === "created" && stored.nameChanged
        ? `Artifact saved to storage as ${stored.fileName}. The requested name was already in use by another conversation.`
        : `Artifact ${stored.action === "updated" ? "updated in" : "saved to"} storage as ${stored.fileName}.`;
      return { ...execution, result: { ...result, storage: { saved: true, autoSave: true, id: stored.attachment.id, url: stored.attachment.url, fileName: stored.fileName, requestedFileName: stored.requestedName, nameChanged: stored.nameChanged, action: stored.action, message } } };
    } catch (error) {
      return { ...execution, result: { ...result, storage: { saved: false, autoSave: true, error: error instanceof Error ? error.message : "Artifact storage copy failed." } } };
    }
  },
};

const BROWSER_TEXT_LIMIT = 40_000;
const RENDER_FUNCTIONS = new Set(["browser_screenshot", "browser_pdf"]);
const BROWSER_DOWNLOAD = "browser_download_file";

function browserSettings(ctx: Pick<ToolContext, "config">): ObscuraSettings {
  const harness: HarnessSettings = { ...DEFAULT_HARNESS_SETTINGS, ...(ctx.config.harnessSettings || {}) };
  const settings = { render: harness.browserRender, stealth: harness.browserStealth, idleMinutes: harness.browserIdleMinutes, maxSessions: harness.browserMaxSessions };
  configureObscura(settings);
  return settings;
}

const boundedText = (text: string) => text.length <= BROWSER_TEXT_LIMIT ? text : `${text.slice(0, BROWSER_TEXT_LIMIT)}\n[Truncated: ${text.length - BROWSER_TEXT_LIMIT} more characters. Use browser_markdown or browser_search on a narrower part of the page.]`;

/**
 * The headless browser: Obscura's own MCP tools, passed through a per-conversation session broker (lib/obscura.ts),
 * plus a download function that saves files into the account's private storage. With render off, screenshots and PDF
 * export are not offered.
 */
const browser: ToolProvider = {
  manifest: manifest("browser"),
  async tools(ctx) {
    const settings = browserSettings(ctx);
    const listed = await obscuraTools(ctx.userId, ctx.conversationId);
    const specs: ToolSpec[] = listed
      .filter(tool => tool.name.startsWith("browser_") && tool.name !== BROWSER_DOWNLOAD && (settings.render || !RENDER_FUNCTIONS.has(tool.name)))
      .map(tool => ({ name: tool.name, description: `[Browser] ${tool.description || tool.name}`, inputSchema: tool.inputSchema || { type: "object", properties: {} } }));
    specs.push({ name: BROWSER_DOWNLOAD, description: "[Browser] Download a file from an HTTP(S) URL with the browser's cookies and save it to the user's private storage. Use it when the user wants a file (a PDF, an archive, an image or any document) rather than reading a page. Files larger than the space left in private storage are refused.", inputSchema: {
      type: "object", additionalProperties: false, required: ["url"],
      properties: { url: { type: "string", description: "Absolute HTTP(S) URL of the file" }, filename: { type: "string", description: "Optional file name to store it under, with its extension" } },
    } });
    return specs;
  },
  async execute(name, args, ctx) {
    const settings = browserSettings(ctx);
    if (name === BROWSER_DOWNLOAD) {
      const url = String(args.url || "").trim();
      if (!url) throw new Error("A URL is required.");
      const ko = ctx.locale === "ko";
      const saved = await downloadWithObscura({ userId: ctx.userId, conversationId: ctx.conversationId, url, name: typeof args.filename === "string" ? args.filename : undefined, signal: ctx.signal, settings,
        onProgress: bytes => ctx.updateEvent({ result: { inProgress: true, message: ko ? `내려받는 중 ${formatBytes(bytes)}` : `Downloading ${formatBytes(bytes)}` } }) });
      const text = `Saved "${saved.name}" (${formatBytes(saved.size)}) to the user's private storage. Link for the user: ${saved.markdown}`;
      return { result: { type: "saved_to_storage", ...saved }, content: [{ type: "text", text }] };
    }
    if (!settings.render && RENDER_FUNCTIONS.has(name)) throw new Error("Screenshots and PDF export are turned off for the browser.");
    const response = await callObscuraTool(ctx.userId, ctx.conversationId, name, args, ctx.signal);
    const content: ModelContentPart[] = [];
    const summaries: unknown[] = [];
    for (const part of response.content || []) {
      if (part.type === "text") { const text = boundedText(String(part.text || "")); content.push({ type: "text", text }); summaries.push({ type: "text", text: text.slice(0, 4000) }); }
      else if (part.type === "image" && typeof part.data === "string") {
        content.push({ type: "image_url", image_url: { url: `data:${part.mimeType || "image/png"};base64,${part.data}` } });
        summaries.push({ type: "image", mimeType: part.mimeType, bytes: Math.ceil(part.data.length * .75) });
      } else if (part.type === "resource" && part.resource && typeof part.resource === "object") {
        const resource = part.resource as { uri?: string; mimeType?: string; text?: string; blob?: string };
        if (typeof resource.blob === "string") {
          // Files the browser hands back (PDF export) go straight into private storage, like downloads.
          const extension = resource.mimeType === "application/pdf" ? ".pdf" : "";
          try {
            const saved = await saveObscuraBytes(ctx.userId, Buffer.from(resource.blob, "base64"), `page-${new Date().toISOString().replace(/[:.]/g, "-")}${extension}`);
            const text = `Saved "${saved.name}" (${formatBytes(saved.size)}) to the user's private storage. Link for the user: ${saved.markdown}`;
            content.push({ type: "text", text }); summaries.push({ type: "saved_to_storage", ...saved });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            content.push({ type: "text", text: `The file could not be saved to private storage: ${message}` }); summaries.push({ type: "storage_save_failed", error: message });
          }
        } else if (typeof resource.text === "string") { const text = boundedText(resource.text); content.push({ type: "text", text }); summaries.push({ type: "resource", uri: resource.uri, text: text.slice(0, 4000) }); }
      }
    }
    if (response.structuredContent !== undefined && !content.length) { const text = boundedText(JSON.stringify(response.structuredContent)); content.push({ type: "text", text }); summaries.push({ type: "structured", text: text.slice(0, 4000) }); }
    return { result: { tool: name, isError: response.isError === true, content: summaries }, ...(content.length ? { content } : {}) };
  },
  disposeConversation: (userId, conversationId) => disposeObscuraConversation(userId, conversationId),
};

function youtubeSettings(ctx: Pick<ToolContext, "config">): YoutubeSettings {
  const harness: HarnessSettings = { ...DEFAULT_HARNESS_SETTINGS, ...(ctx.config.harnessSettings || {}) };
  return { maxChars: harness.youtubeMaxChars, preferredLanguages: harness.youtubePreferredLanguages, maxDownloadMb: harness.youtubeMaxDownloadMb };
}

const YOUTUBE_URL = { type: "string", description: "YouTube video link (youtube.com/watch, youtu.be, shorts, live) or an 11-character video id." };

/** YouTube through the harness's yt-dlp (lib/youtube.ts). Downloads go into the account's private storage. */
const youtube: ToolProvider = {
  manifest: manifest("youtube"),
  // Downloads can take minutes; the chat's model slot is not held meanwhile.
  releasesModelWhileRunning: true,
  tools: () => [
    { name: "get_youtube_subtitles", description: "Get the subtitles of one YouTube video as plain text, with its title, channel and length. Use it when the user shares a YouTube link and wants a summary, quotes or answers about the video. Uploaded subtitles are preferred, then automatic captions in the spoken language. Long transcripts come in pages: when the reply says to call again with an offset, do so before summarizing the whole video.", inputSchema: {
      type: "object", additionalProperties: false, required: ["url"], properties: {
        url: YOUTUBE_URL,
        language: { type: "string", description: "Optional language code such as \"ko\" or \"en\". Leave empty to pick the best available track." },
        include_timestamps: { type: "boolean", description: "Start each paragraph with its time, e.g. [3:05], for questions about when something is said." },
        offset: { type: "integer", minimum: 0, description: "Character offset of the next page of a long transcript, exactly as given in the previous reply." },
      } } },
    { name: "list_youtube_subtitles", description: "List the subtitle languages a YouTube video offers: uploaded subtitles and automatic captions.", inputSchema: { type: "object", additionalProperties: false, required: ["url"], properties: { url: YOUTUBE_URL } } },
    { name: "download_youtube_video", description: "Download a YouTube video and save it to the user's private storage. Use it only when the user asks for the video file itself. By default it takes the best available video and audio quality, without subtitles. Large videos can take several minutes; the reply says where the file was saved.", inputSchema: {
      type: "object", additionalProperties: false, required: ["url"], properties: { url: YOUTUBE_URL, max_height: { type: "integer", minimum: 144, maximum: 4320, description: "Optional resolution cap in pixels, e.g. 1080. Leave empty for the best available." } } } },
  ],
  async execute(name, args, ctx) {
    const settings = youtubeSettings(ctx);
    const url = String(args.url || "");
    const text = name === "get_youtube_subtitles"
      ? await youtubeSubtitles({ userId: ctx.userId, url, language: typeof args.language === "string" ? args.language : "", timestamps: args.include_timestamps === true, offset: Number(args.offset) || 0, settings, signal: ctx.signal })
      : name === "list_youtube_subtitles" ? await youtubeLanguages({ userId: ctx.userId, url, signal: ctx.signal }) : undefined;
    if (text !== undefined) return { result: { tool: name, text: text.slice(0, 4000) }, content: [{ type: "text", text }] };
    if (name !== "download_youtube_video") throw new Error(`Unknown YouTube function ${name}.`);
    const maxHeight = Number(args.max_height);
    const downloaded = await downloadYoutubeVideo({ userId: ctx.userId, url, settings, signal: ctx.signal, ...(Number.isFinite(maxHeight) && maxHeight > 0 ? { maxHeight: Math.floor(maxHeight) } : {}),
      onProgress: (message, progress, total) => ctx.updateEvent({ result: { inProgress: true, message, ...(total ? { progress, total } : {}) } }) });
    return { result: { type: "saved_to_storage", ...downloaded.saved }, content: [{ type: "text", text: downloaded.text }] };
  },
};

/** In catalog order, which is also the order the model sees them. */
export const BUILTIN_PROVIDERS: readonly ToolProvider[] = [webSearch, pageVisit, browser, youtube, time, location, storage, codeRunner, multipleChoice, artifact];

export const builtinSource: ToolProviderSource = { id: "builtin", providers: () => [...BUILTIN_PROVIDERS] };
