import type { ModelContentPart } from "../document-processing.ts";
import type { AppConfig, ChatWaitPhase, Locale, ModelConfig, ToolEvent, UserRole } from "../types.ts";
import type { ToolOptions, ToolProviderManifest } from "./catalog.ts";
import type { ToolState } from "./state.ts";

/**
 * One function a provider offers, in the shape of an MCP `Tool`. Built-in and installed providers both describe
 * their functions this way, and one converter turns every spec into the OpenAI-compatible `tools` entry the model
 * sees, so the model cannot tell where a function came from.
 */
export interface ToolSpec {
  /** Name the model calls. Must match ^[a-zA-Z0-9_-]{1,64}$ and be unique within the request. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The provider's own name for the function when the advertised name is namespaced (MCP tool name). */
  sourceName?: string;
  /** The tool says it only reads (MCP `readOnlyHint`). Missing means unknown. */
  readOnly?: boolean;
}

/**
 * Decides a call before the provider's own approval: "run" executes it without asking, "provider" leaves it to the
 * provider's approval, and `{ result }` answers the model without running it. Used by the agent's automatic runs.
 */
export type ToolGate = (call: { providerId: string; name: string; sourceName: string; readOnlyHint?: boolean; args: Record<string, unknown>; ctx: ToolCallContext }) => Promise<"run" | "provider" | { result: unknown }>;

/**
 * What a call returns: `result` is kept on the tool event for the transcript, `content` (when present) is what the model
 * reads. `define` replaces the definitions of the same provider's tools (matched by name) for the rest of the reply,
 * e.g. MCP tools listed as one-line summaries whose full definitions the model just asked for.
 */
export type ToolExecution = { result: unknown; content?: ModelContentPart[]; define?: ToolSpec[] };

/** Server facilities a provider may use without importing the chat runtime. */
export interface ToolServices {
  /** An isolated completion with no chat history, as used for titles and command risk checks. Empty model id means the chat's model. */
  complete(modelId: string, effort: string, prompt: string, input: string, maxTokens: number): Promise<{ text: string }>;
}

/** Facts about the request every provider sees. */
export interface ToolRequestContext {
  userId: string;
  role: UserRole;
  conversationId: string;
  locale: Locale;
  clientContext?: { timeZone?: string; locale?: string; language?: Locale };
  config: AppConfig;
  model: ModelConfig;
  signal: AbortSignal;
  /** Tool events already recorded in this conversation, including the reply being written. */
  history(): ToolEvent[];
  services: ToolServices;
  /** Built-in provider ids the account's plan switches off. */
  disabledTools?: readonly string[];
  /** Executables installed in Harness settings. */
  managedTools?: { browser?: boolean; youtube?: boolean };
  /** Set for the personal agent: its automatic runs decide calls here first. */
  gate?: ToolGate;
  /** Set for the personal agent: which agent session this request belongs to. */
  agent?: { userId: string; mode: "main" | "sub"; runId?: string; autonomous: boolean };
}

/** The request context plus this provider's own switch values. */
export interface ToolContext extends ToolRequestContext {
  options: ToolOptions;
  /** Per-chat allow-list of the provider's function names, when the person narrowed it. */
  functions?: string[];
}

export interface ToolCallContext extends ToolContext {
  callId: string;
  /** The model's raw JSON arguments, for executors that parse them themselves. */
  rawArguments: string;
  updateEvent(patch: Partial<ToolEvent>): void;
  /** Marks the call waiting and resolves with what the browser sends back (an answer, a decision, coordinates). */
  waitForUser(): Promise<unknown>;
  setWaitPhase(phase: ChatWaitPhase | undefined): void;
}

export type AuthorizationResult = { approved: true } | { approved: false; result: unknown; define?: ToolSpec[] };

export interface ToolProvider {
  manifest: ToolProviderManifest;
  /** Server-enforced conditions beyond the manifest requirements (plan, connection state). Defaults to true. */
  available?(ctx: ToolContext): boolean | Promise<boolean>;
  /** Functions offered for this request. May be empty, e.g. storage with both read and write off. */
  tools(ctx: ToolContext): ToolSpec[] | Promise<ToolSpec[]>;
  /** Runs before every call. Returning not approved skips execution and sends `result` to the model. */
  authorize?(name: string, args: Record<string, unknown>, ctx: ToolCallContext): Promise<AuthorizationResult>;
  execute(name: string, args: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolExecution>;
  /**
   * Hand the chat's model slot back while this provider runs (approval waits, long jobs, its own model calls).
   * Without this a provider that calls `services.complete` on the same model would wait on itself.
   */
  releasesModelWhileRunning?: boolean;
  /** Frees anything kept per conversation (sessions, processes, sandboxes) when the conversation is deleted. */
  disposeConversation?(userId: string, conversationId: string): void | Promise<void>;
}

/** Produces providers for one request: the built-in list, the account's MCP connections, installed plugins. */
export interface ToolProviderSource {
  id: string;
  providers(ctx: ToolRequestContext, state: ToolState): ToolProvider[] | Promise<ToolProvider[]>;
}
