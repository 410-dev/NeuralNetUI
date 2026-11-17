import { DEFAULT_HARNESS_SETTINGS } from "../harness";
import { currentTime, executeWebTool, reverseGeocode, toolDefinitions } from "../web-tools";
import { closeHostComputerSession, deterministicHostAssessment, executeHostComputerTool, hostActionRequiresApproval, hostComputerToolDefinition, isShellHostAction, type HostRiskAssessment } from "../host-computer-tool";
import { executeStorageAccessTool, storageAccessToolDefinition } from "../storage-tool";
import { saveArtifactFile } from "../uploads";
import type { ArtifactKind, ToolEvent } from "../types";
import { builtinToolProvider } from "./catalog";
import { CODE_FUNCTIONS, MAX_CODE_CHARS, normalizeCodeRunResult } from "./code-runner";
import { specFromModelTool } from "./registry";
import type { ToolCallContext, ToolContext, ToolProvider, ToolProviderSource, ToolSpec } from "./types";

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

const ownerKey = (ctx: Pick<ToolContext, "userId" | "conversationId">) => `${ctx.userId}:${ctx.conversationId}`;

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

function parseHostAssessment(text: string): HostRiskAssessment {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(candidate) as Record<string, unknown>;
  const riskLevel = Math.floor(Number(parsed.riskLevel)); const explanation = String(parsed.explanation || "").trim();
  if (![1, 2, 3, 4, 5].includes(riskLevel) || !explanation) throw new Error("The command assessor returned an invalid result.");
  return { riskLevel: riskLevel as HostRiskAssessment["riskLevel"], explanation };
}

/** Shell commands are rated by an isolated model call that sees only the command; anything it cannot rate is level 5. */
async function assessShell(args: Record<string, unknown>, ctx: ToolCallContext): Promise<HostRiskAssessment> {
  const harness = ctx.config.harnessSettings || DEFAULT_HARNESS_SETTINGS;
  const ko = ctx.locale === "ko";
  try {
    const request = JSON.stringify({ language: ko ? "Korean" : "English", shell: args.shell, command: args.command, cwd: args.cwd || null });
    const result = await ctx.services.complete(harness.hostCommandModelId, harness.hostCommandEffort, harness.hostCommandAnalysisPrompt, request, 700);
    return parseHostAssessment(result.text);
  } catch {
    ctx.signal.throwIfAborted();
    const command = String(args.command || ""), shell = String(args.shell || "shell");
    return { riskLevel: 5, explanation: ko
      ? `명령어 “${command}”의 독립 위험도 분석에 실패하여 가장 높은 5단계로 분류했습니다. 실행 시 지정된 ${shell} 셸이 이 명령 전체를 처리합니다.`
      : `Independent analysis failed, so command “${command}” was assigned the highest risk level 5. The selected ${shell} shell will process the complete command if approved.` };
  }
}

const hostComputer: ToolProvider = {
  manifest: manifest("host-computer"),
  releasesModelWhileRunning: true,
  tools: () => [specFromModelTool(hostComputerToolDefinition())],
  async authorize(_name, args, ctx) {
    if (ctx.role !== "superadmin") throw new Error("The host computer tool is restricted to Superadmin.");
    const harness = ctx.config.harnessSettings || DEFAULT_HARNESS_SETTINGS;
    const assessment = isShellHostAction(args) ? await assessShell(args, ctx) : deterministicHostAssessment(args, ctx.locale);
    ctx.setWaitPhase(undefined);
    ctx.updateEvent({ arguments: { ...args, authorization: assessment } });
    if (!hostActionRequiresApproval(harness, args, assessment.riskLevel)) return { approved: true };
    const response = await ctx.waitForUser();
    const value = response && typeof response === "object" ? response as Record<string, unknown> : {};
    const decision = String(value.decision || "reject");
    if (decision === "approve") return { approved: true };
    const instruction = decision === "redirect" ? String(value.instruction || "").trim() : "";
    return { approved: false, result: { executed: false, rejected: true, decision: decision === "redirect" ? "redirect" : "reject", ...(instruction ? { instruction } : {}) } };
  },
  execute: (_name, args, ctx) => executeHostComputerTool(ownerKey(ctx), args, ctx.userId, ctx.config.toolSettings, ctx.model, ctx.signal),
  disposeConversation: (userId, conversationId) => { closeHostComputerSession(`${userId}:${conversationId}`); },
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

/** In catalog order, which is also the order the model sees them. */
export const BUILTIN_PROVIDERS: readonly ToolProvider[] = [webSearch, pageVisit, time, location, storage, codeRunner, hostComputer, multipleChoice, artifact];

export const builtinSource: ToolProviderSource = { id: "builtin", providers: () => [...BUILTIN_PROVIDERS] };
