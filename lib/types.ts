import type { ToolState } from "./tools/state.ts";
import type { PersonalSampling, SamplingParams } from "./sampling-params.ts";
import type { GreetingOverrides } from "./greetings.ts";
import type { RepetitionSettings } from "./repetition.ts";

export type ReasoningKind = "builtin" | "custom";
export type SystemPromptMode = "replace" | "prepend" | "append";
export type Locale = "en" | "ko";
export type ConnectionDriver = "openai" | "lmstudio" | "google" | "anthropic" | "lmf";
export type McpAuthType = "oauth" | "api_key" | "none";
export type McpToolPolicy = "blocked" | "always_ask" | "session_ask" | "always_allow";
export type ArtifactKind = "html" | "csv" | "json" | "xml" | "markdown";
export type ModelWaitPolicy = "capacity" | "serial";
export type ChatWaitPhase = "waiting-session" | "freeing-space" | "loading-model" | "waiting-server" | "preparing-response" | "processing-prompt" | "compacting-context" | "creating-artifact";
export type AccentPaletteId = "blue" | "violet" | "teal" | "amber" | "rose" | "graphite" | "custom";
export type StreamReveal = "instant" | "fade";

/** Per-user presentation choices that never affect what is sent to a model. */
export interface AppearancePreferences {
  lmStudioProgress: "text" | "percent" | "donut" | "both";
  accentPalette: AccentPaletteId;
  /** Used when the palette is "custom". */
  accentColor: string;
  streamReveal: StreamReveal;
  /** Duration of the fade applied independently to each newly received text fragment. */
  streamFadeDurationMs: number;
  /** Show each reasoning choice's description in the chat picker. */
  showReasoningNotes: boolean;
  /** Count the prompt-processing time into the thinking time shown on a reasoning step. */
  thinkingIncludesPromptTime: boolean;
  /** Show the prompt-processing time next to the thinking time, e.g. "12초 동안 생각함 (3초 프롬프트 처리함)". */
  thinkingShowsPromptTime: boolean;
  /** Carry the accent glow into an open chat as a dim wash along the bottom of the thread. */
  chatBackgroundGlow: boolean;
  /** Per-effort description overrides. An absent key falls back to the built-in wording. */
  reasoningNotes: Record<string, string>;
  greetings: GreetingOverrides;
}

/** Accent for the sign-in screen. One administrator choice shown to everyone, signed in or not. */
export interface LoginAppearance {
  accentPalette: AccentPaletteId;
  /** Used when the palette is "custom". */
  accentColor: string;
}

export interface ReasoningPreset {
  id: string;
  name: string;
  kind: ReasoningKind;
  /** Shown under the name in the chat picker, in place of the effort's generic note. */
  description?: string;
  effort?: string;
  systemPrompt?: string;
  systemPromptMode?: SystemPromptMode;
  ownerId?: string;
  /** Set by an administrator: every account that can use the model sees the template. */
  global?: boolean;
  /** Administrator values for requests made with this template; they override the model's, field by field. */
  samplingParams?: SamplingParams;
}

export interface ModelConfig {
  id: string;
  name: string;
  sourceModel: string;
  description?: string;
  systemPrompt?: string;
  isAlias: boolean;
  visible: boolean;
  reasoningSupported: boolean;
  reasoningEfforts?: string[];
  reasoningPresets: ReasoningPreset[];
  /** Administrator choice: reasoning values are sent through the API although the server advertises none. `reasoningEfforts` then holds the forced fallback list. */
  reasoningForceApi?: boolean;
  /** User-configured limit. Kept separately so API discovery never overwrites it. */
  contextWindowTokens?: number;
  /** Context limit advertised by the OpenAI-compatible model API. */
  apiContextWindowTokens?: number;
  /** Whether stored image originals or bounded model-context derivatives are sent. */
  visionImageMode?: "original" | "max-resolution";
  /** Long-edge pixel limit used only when visionImageMode is max-resolution. */
  visionMaxEdgePixels?: number;
  /** Route prompts through the OpenAI-compatible Images API instead of Chat Completions. */
  imageGeneration?: boolean;
  /** Whether this model accepts image attachments as input. Missing legacy values mean enabled. */
  imageInput?: boolean;
  ownerId?: string;
  isPublic?: boolean;
  /** Connection that serves this model. Aliases inherit their base model connection. */
  connectionId?: string;
  /** Administrator choice: earlier responses' reasoning is sent back to this model. Aliases without one follow their base. */
  rememberReasoning?: boolean;
  /** Administrator choice for a served model: accounts may replace its system prompt for themselves. Aliases always may. */
  systemPromptEditable?: boolean;
  /** Administrator choice for a served model: start/end pairs that mark reasoning in its text. Missing means the defaults; aliases use their base's. */
  thinkingTags?: Array<{ start: string; end: string }>;
  /** Administrator choice: any end tag closes a block opened by any start tag, not only its own pair. */
  thinkingTagsCross?: boolean;
  /** Administrator values sent with every request; a missing field leaves the server default. */
  samplingParams?: SamplingParams;
  /** What the server reported as its defaults at the last model refresh, if it could be read. */
  samplingDefaults?: SamplingParams;
  /** Default token usage weight, applied wherever a plan does not set one for this model. Missing means 1. */
  usageWeight?: number;
  /** LMFuseFramework routing model (usually "auto"): the provider changes per request and is shown under the picker. */
  routerModel?: boolean;
  /** Display names for the providers a routing model may pick, keyed by `lmfRouteKey` ("provider/model"). */
  routeDisplayNames?: Record<string, string>;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  driver: ConnectionDriver;
  baseUrl: string;
  /** Extra addresses of the same serving, tried after the base URL. When all are online the least busy one is used. */
  backupUrls?: string[];
  apiKey: string;
  /** Explicitly disable saved and environment credentials until a replacement is entered. */
  clearApiKey?: boolean;
  /** An administrator switched the server off: its models leave the picker and chat requests are refused. */
  disabled?: boolean;
  /** Zero or absent means unlimited. A positive limit enables managed loading. */
  maxResidentModels?: number;
  modelWaitPolicy?: ModelWaitPolicy;
  /** LMFuseFramework only: count cached prompt tokens at a discount in plan usage. Missing means on. */
  lmfCacheDiscount?: boolean;
  /** LMFuseFramework only: how much of each cached prompt token is waived, in percent. Missing means 90. */
  lmfCacheDiscountPercent?: number;
  /** Requests this server may run at once; 0 means no limit. The agent runs subagents in parallel only up to it. Missing means 1. */
  maxConcurrentRequests?: number;
  /** LMFuseFramework only: a chat's session is deleted on the server after this many hours without a request. Missing means 24. */
  lmfSessionTtlHours?: number;
  models: ModelConfig[];
}

export type UserRole = "superadmin" | "admin" | "user";

export interface AccountInfo {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  canAudit: boolean;
  planId?: string;
}

export interface UserSummary extends AccountInfo {
  createdAt: string;
  storageQuotaBytes: number;
  storageUsedBytes: number;
  trashQuotaBytes: number;
  trashUsedBytes: number;
  auditEnabled: boolean;
  storageQuotaUsesDefault: boolean;
  trashQuotaUsesDefault: boolean;
}

export type TokenScope = "input" | "output" | "both";

export interface PlanTokenLimit {
  id: string;
  durationSeconds: number;
  tokenLimit: number;
  tokenScope: TokenScope;
}

export interface UsagePlan {
  id: string;
  name: string;
  servedModelIds: string[];
  modelWeights: Record<string, number>;
  tokenLimits: PlanTokenLimit[];
  storageQuotaBytes: number;
  trashQuotaBytes: number;
  mcpEnabled: boolean;
  maxMcpConnections: number;
  artifactHtmlEnabled: boolean;
  /** Built-in tool provider ids people on this plan cannot use. */
  disabledToolIds: string[];
  /** People on this plan may use the personal agent. */
  agentEnabled: boolean;
  /** Shortest interval, in minutes, between the agent's automatic runs and recurring tasks. */
  agentMinIntervalMinutes: number;
  userCount?: number;
}

export interface McpConnection {
  id: string;
  name: string;
  description?: string;
  url: string;
  authType: McpAuthType;
  hasCredential: boolean;
  enabled: boolean;
  toolTimeoutSeconds: number;
  /** "vm" is the account's virtual computer: one per account, not counted toward the plan's MCP limit. */
  kind: "user" | "vm";
  /** OAuth sign-in through NeuralNetUI: the client and whether it is signed in (secrets and tokens never leave the server). */
  /** How the connection's tool definitions reach the model: as sent, length-capped, or on demand. */
  toolDefinitions: "full" | "trimmed" | "on_demand";
  oauth?: { clientId: string; hasClientSecret: boolean; authorizationUrl: string; tokenUrl: string; scopes: string[]; signedIn: boolean; canRefresh: boolean; expiresAt?: string };
  createdAt: string;
  updatedAt: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
  policy: McpToolPolicy;
}

export interface ArtifactDocument {
  title: string;
  kind: ArtifactKind;
  content: string;
  updatedAt?: string;
}

export interface McpEntitlement {
  enabled: boolean;
  maxConnections: number;
  usedConnections: number;
}

export interface ResetCredit {
  id: string;
  title: string;
  maxWindowSeconds: number;
  expiresAt: string;
  targetType: "user" | "plan";
  targetId: string;
}

export interface UsageWindowStatus extends PlanTokenLimit {
  usedTokens: number;
  percentage: number;
  startsAt?: string;
  resetsAt?: string;
}

export interface UsageStatus {
  plan?: Pick<UsagePlan, "id" | "name">;
  windows: UsageWindowStatus[];
  nearestPercentage: number;
  blocked: boolean;
  credits: ResetCredit[];
}

export interface UserStorageSettings {
  /** Workspace default active quota inherited by new accounts and accounts set to zero. */
  defaultQuotaBytes: number;
  /** Workspace default trash quota inherited by new accounts and accounts set to zero. */
  defaultTrashQuotaBytes: number;
  /** Deleted chats and files are retained for this many days, up to 60. */
  trashRetentionDays: number;
}

export interface AppConfig {
  /** Ordered highest priority first. */
  connections: ConnectionConfig[];
  profile: {
    name: string;
  };
  preferences: {
    sendReasoningToModel: boolean;
    exportReasoning: boolean;
    /** Editing a message that has later messages: start a new branch from it, edit it where it is, or ask. */
    messageEditMode?: MessageEditMode;
    /** Editing a message inside the compacted part of the context: open the summary, keep it, or ask. */
    compactedEditMode?: CompactedEditMode;
    language: Locale;
    onDemand: boolean;
    showModelIdentifiers: boolean;
    renderStrikethrough: boolean;
    defaultModelId?: string;
    defaultReasoningPresetId?: string;
    /** Per-account default served model for each alias. Alias settings remain recommendations. */
    aliasBaseModelIds?: Record<string, string>;
    appearance: AppearancePreferences;
    /** Per-account tool provider switches; providers without an entry use their defaults. Older saves use the legacy switch object. */
    enabledTools?: ToolState;
    /** Legacy per-account replacements by model id, then preset id; read once into `modelSystemPrompts`. */
    systemPromptOverrides?: Record<string, Record<string, string>>;
    /** The account's own system prompt per model, replacing the model's server default. */
    modelSystemPrompts?: Record<string, string>;
    /** The account's own inference parameters per model and template; used only while accounts may change them. */
    modelSamplingParams?: PersonalSampling;
  };
  /** Workspace-wide, never overridden per account. */
  loginAppearance: LoginAppearance;
  /** Workspace-wide: every account sees its plan's model weight badges in the chat picker. */
  showModelWeights: boolean;
  /**
   * Workspace-wide: the service is deployed for an organization. For now it adds a notice under the composer that
   * the organization's administrators can see conversations (not in temporary chats).
   */
  organizationMode: boolean;
  /** Workspace-wide: show connection/server names below models in the chat picker. */
  showModelConnectionNames: boolean;
  /** Workspace-wide: standard accounts may set their own inference parameters per model and template. */
  samplingUserEditable?: boolean;
  userStorageSettings: UserStorageSettings;
  harnessSettings?: HarnessSettings;
  toolSettings: ToolSettings;
  models: ModelConfig[];
}

export type MessageEditMode = "truncate" | "in_place" | "ask";
export type CompactedEditMode = "edit_summary" | "ignore" | "ask";

export interface HarnessSettings {
  /** The base method: rolling drops the oldest turns, compacting summarizes earlier turns at the threshold. */
  contextMode: "rolling" | "compacting";
  /**
   * Drop Details first: at the threshold, earlier tool calls, tool results and reasoning are removed without a model
   * call. When that is not enough, the base method above takes over.
   */
  dropDetailsFirst: boolean;
  /** Cap on tokens the model may generate per response. Zero leaves it to the context window. */
  maxOutputTokens: number;
  compactThreshold: number;
  /** Recent question-and-answer pairs kept word for word when earlier turns are summarized or their details dropped. */
  compactKeepTurns: number;
  compactModelId: string;
  compactEffort: string;
  compactPrompt: string;
  /** Where the compaction prompt goes relative to the conversation when it has no {CHAT_CONTENT} placeholder. */
  compactPromptPosition: "before" | "after";
  resumePrompt: string;
  maxCompactionResumes: number;
  titleEnabled: boolean;
  titleTiming: "before" | "after";
  titleModelId: string;
  titleEffort: string;
  titlePrompt: string;
  /** Automatically keep artifact-tool output in the creator's private storage. */
  artifactAutoSaveToStorage: boolean;
  /** Per-kind switches and consecutive-copy thresholds for flagging a response that repeats itself. */
  repetitionDetection: RepetitionSettings;
  /** Obscura browser: screenshots and PDF export (render), and fingerprint/tracker protection (stealth). */
  browserRender: boolean;
  browserStealth: boolean;
  /** Minutes without use before a conversation's browser process is stopped to reclaim memory. */
  browserIdleMinutes: number;
  /** Browser processes that may run at the same time on this server. */
  browserMaxSessions: number;
  /** YouTube tool: characters of transcript per call, subtitle language order, and the per-video download cap. */
  youtubeMaxChars: number;
  youtubePreferredLanguages: string[];
  youtubeMaxDownloadMb: number;
}

/** Opt-in features an administrator must switch on before anyone can use them. */
export interface ToolSettings {
  maxToolRounds: number;
  maxMultipleChoiceQuestions: number;
  maxAttachmentsPerMessage: number;
  textDownloadLimitMb: number;
  textCharacterLimit: number;
  imageDownloadLimitMb: number;
  imageUploadLimitMb: number;
  pdfSizeLimitMb: number;
  pdfPageLimit: number;
  pdfTextCharacterLimit: number;
  pdfVisionPageLimit: number;
  pdfProcessingTimeoutSeconds: number;
  temporaryFileTtlMinutes: number;
  orphanUploadTtlHours: number;
}

/**
 * One stage of an assistant turn, in the order it happened. Reasoning, delivered text, tool
 * rounds and context compaction interleave, so the transcript keeps the sequence rather than
 * grouping each kind together. `content` and `reasoning` stay the concatenation of every step,
 * so copying, export and upstream history are unaffected.
 */
export type MessageStep =
  /** `startedAt` is the server clock (epoch ms) when the step opened; `promptSeconds` is the prompt-processing stage that ran just before it. */
  | { kind: "reasoning"; text: string; seconds?: number; startedAt?: number; promptSeconds?: number }
  | { kind: "content"; text: string }
  | { kind: "tools"; ids: string[] }
  | { kind: "compaction"; seconds?: number; summary?: string; reasoning?: string; retainedToolIds?: string[]; method?: "drop" | "roll"; savedTokens?: number; /** Epoch ms (server clock) when the stage started, for the live timer. */ startedAt?: number };

export interface StoredMessage {
  id: string;
  revisionGroupId?: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  reasoningDurationSeconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  completionDurationSeconds?: number;
  timeToFirstTokenSeconds?: number;
  contextTokens?: number;
  /** Estimated tokens of the tool definitions the reply's last request carried (they are part of every request). */
  toolDefinitionTokens?: number;
  /** Every prompt-processing stage of the response added together. */
  promptProcessingSeconds?: number;
  /** From the request reaching the server to the response ending. */
  totalDurationSeconds?: number;
  /** Display name of the model that answered, as it was when the reply was written. */
  modelName?: string;
  /** For an LMFuseFramework routing model: the routed provider and model that actually answered. */
  routedModel?: string;
  /** Agent chat only: "notice" is something the agent told the person on its own; "context" is a result only the model reads. */
  agentKind?: "notice" | "context";
  /** Agent chat only: a line the system puts in front of the content for the model (the time it was sent or a subagent
   * returned). The chat does not show it; the context view does. */
  contextPrefix?: string;
  /** Absent on messages written before the sequential transcript existed. */
  steps?: MessageStep[];
  toolEvents?: ToolEvent[];
  attachments?: StoredAttachment[];
  createdAt: string;
}

export type ToolEventStatus = "calling" | "waiting" | "completed" | "error";

export interface ToolEvent {
  id: string;
  name: string;
  status: ToolEventStatus;
  reasoningOffset?: number;
  arguments?: unknown;
  result?: unknown;
  startedAt: string;
  completedAt?: string;
}

export type MultipleChoiceKind = "single_select" | "multi_select" | "rank_priorities";

export interface MultipleChoiceQuestion {
  id?: string;
  question: string;
  type: MultipleChoiceKind;
  options: string[];
}


export interface StoredAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  url: string;
  thumbnailUrl?: string;
  /** Client-only marker: removing a draft reference must not delete the stored source file. */
  fromStorage?: boolean;
}

export interface StorageFile extends StoredAttachment {
  createdAt: string;
  referenceCount: number;
  retained: boolean;
  deletedAt?: string;
}

export interface ChatBranch {
  id: string;
  name: string;
  parentBranchId?: string;
  forkedFromMessageId?: string;
  messages: StoredMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  /** Kept out of history and removed when the chat ends unless the user promotes it. */
  temporary?: boolean;
  modelId: string;
  reasoningPresetId?: string;
  /** This chat's own system prompts by model id, then reasoning preset id. A new chat opened from it starts with a copy. */
  systemPromptOverrides?: Record<string, Record<string, string>>;
  activeBranchId: string;
  branches: ChatBranch[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  activeBranchId: string;
  branchCount: number;
  updatedAt: string;
  deletedAt?: string;
  /** Set while the chat is pinned to the top of the history list. */
  pinnedAt?: string;
}

export type PublicConnectionConfig = Omit<ConnectionConfig, "apiKey"> & { apiKey: string; hasApiKey: boolean };

export type PublicConfig = Omit<AppConfig, "connections"> & {
  connections: PublicConnectionConfig[];
  account?: AccountInfo;
  /** Present while weight badges are enabled: the account's plan weights other than 1, keyed by picker model id. */
  modelWeights?: Record<string, number>;
  /** Runtime-only plan allow-list used by the chat picker, including for administrators. */
  planModelIds: string[];
  /** Built-in tool provider ids the account's plan switches off. */
  planDisabledToolIds?: string[];
  /** Executables installed in Harness settings that tools depend on. */
  managedTools?: { browser?: boolean; youtube?: boolean };
  /** Runtime-only, user-owned MCP records. Credentials are never included. */
  mcpConnections: McpConnection[];
  mcpEntitlement: McpEntitlement;
};
