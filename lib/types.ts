import type { GreetingOverrides } from "./greetings.ts";
import type { HostTrustedPermissions } from "./host-permissions.ts";

export type ReasoningKind = "builtin" | "custom";
export type SystemPromptMode = "replace" | "prepend" | "append";
export type Locale = "en" | "ko";
export type ConnectionDriver = "openai" | "lmstudio" | "nnui";
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
  effort?: string;
  systemPrompt?: string;
  systemPromptMode?: SystemPromptMode;
  ownerId?: string;
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
}

export interface ConnectionConfig {
  id: string;
  name: string;
  driver: ConnectionDriver;
  baseUrl: string;
  apiKey: string;
  /** Explicitly disable saved and environment credentials until a replacement is entered. */
  clearApiKey?: boolean;
  /** An administrator switched the server off: its models leave the picker and chat requests are refused. */
  disabled?: boolean;
  /** Zero or absent means unlimited. A positive limit enables managed loading. */
  maxResidentModels?: number;
  modelWaitPolicy?: ModelWaitPolicy;
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
    language: Locale;
    onDemand: boolean;
    showModelIdentifiers: boolean;
    renderStrikethrough: boolean;
    defaultModelId?: string;
    defaultReasoningPresetId?: string;
    /** Per-account default served model for each alias. Alias settings remain recommendations. */
    aliasBaseModelIds?: Record<string, string>;
    appearance: AppearancePreferences;
    /** Per-account composer tool switches; absent keys use the built-in defaults. */
    enabledTools?: Partial<EnabledTools>;
  };
  /** Workspace-wide, never overridden per account. */
  loginAppearance: LoginAppearance;
  /** Workspace-wide: every account sees its plan's model weight badges in the chat picker. */
  showModelWeights: boolean;
  /** Workspace-wide: show connection/server names below models in the chat picker. */
  showModelConnectionNames: boolean;
  userStorageSettings: UserStorageSettings;
  harnessSettings?: HarnessSettings;
  toolSettings: ToolSettings;
  experimental: ExperimentalFeatures;
  models: ModelConfig[];
}

export interface HarnessSettings {
  contextMode: "rolling" | "compacting";
  /** Cap on tokens the model may generate per response. Zero leaves it to the context window. */
  maxOutputTokens: number;
  compactThreshold: number;
  compactModelId: string;
  compactEffort: string;
  compactPrompt: string;
  resumePrompt: string;
  maxCompactionResumes: number;
  titleEnabled: boolean;
  titleTiming: "before" | "after";
  titleModelId: string;
  titleEffort: string;
  titlePrompt: string;
  /** Automatically keep artifact-tool output in the creator's private storage. */
  artifactAutoSaveToStorage: boolean;
  /** Confirmation policy for the Superadmin-only host computer tool. */
  hostTrustMode: "full" | "partial" | "none";
  /** Per-operation automatic approval choices. Used only in partial trust mode. */
  hostTrustedPermissions: HostTrustedPermissions;
  /** Optional isolated model used to classify and explain shell commands. */
  hostCommandModelId: string;
  hostCommandEffort: string;
  hostCommandAnalysisPrompt: string;
}

/** Opt-in features an administrator must switch on before anyone can use them. */
export interface ExperimentalFeatures {
  openAIProgress?: boolean;
  browserTool: boolean;
  hostComputerTool: boolean;
}

export interface ToolSettings {
  maxToolRounds: number;
  maxBrowserTabs: number;
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
  | { kind: "reasoning"; text: string; seconds?: number }
  | { kind: "content"; text: string }
  | { kind: "tools"; ids: string[] }
  | { kind: "compaction"; seconds?: number; summary?: string; reasoning?: string; retainedToolIds?: string[] };

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

export interface EnabledTools {
  internetSearch: boolean;
  pageVisit: boolean;
  browser: boolean;
  storageAccess: boolean;
  /** Fine-grained private-storage permissions for the current chat session. */
  storageRead: boolean;
  storageWrite: boolean;
  /** Maximum text files the storage tool may create in one conversation. */
  storageWriteMaxFiles: number;
  currentTime: boolean;
  location: boolean;
  multipleChoice: boolean;
  artifact: boolean;
  hostComputer: boolean;
  mcpConnectionIds: string[];
  /** Per-chat MCP tool allow-list. Missing connections use every non-blocked tool. */
  mcpToolNames: Record<string, string[]>;
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
}

export type PublicConnectionConfig = Omit<ConnectionConfig, "apiKey"> & { apiKey: string; hasApiKey: boolean };

export type PublicConfig = Omit<AppConfig, "connections"> & {
  connections: PublicConnectionConfig[];
  account?: AccountInfo;
  /** Runtime capability, computed by the server and never persisted. */
  hostComputerAvailable?: boolean;
  /** Present while weight badges are enabled: the account's plan weights other than 1, keyed by picker model id. */
  modelWeights?: Record<string, number>;
  /** Runtime-only plan allow-list used by the chat picker, including for administrators. */
  planModelIds: string[];
  /** Runtime-only, user-owned MCP records. Credentials are never included. */
  mcpConnections: McpConnection[];
  mcpEntitlement: McpEntitlement;
};
