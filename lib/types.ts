import type { GreetingOverrides } from "./greetings.ts";

export type ReasoningKind = "builtin" | "custom";
export type SystemPromptMode = "replace" | "prepend" | "append";
export type Locale = "en" | "ko";
export type ConnectionDriver = "openai" | "lmstudio";
export type ModelWaitPolicy = "capacity" | "serial";
export type ChatWaitPhase = "waiting-session" | "freeing-space" | "loading-model" | "waiting-server" | "preparing-response" | "processing-prompt" | "compacting-context";
export type AccentPaletteId = "blue" | "violet" | "teal" | "amber" | "rose" | "graphite" | "custom";
export type StreamReveal = "instant" | "fade";
export type StreamPacing = "immediate" | "chunked";

/** Per-user presentation choices that never affect what is sent to a model. */
export interface AppearancePreferences {
  lmStudioProgress: "text" | "percent" | "donut" | "both";
  accentPalette: AccentPaletteId;
  /** Used when the palette is "custom". */
  accentColor: string;
  streamReveal: StreamReveal;
  streamPacing: StreamPacing;
  /** Characters released per step while pacing is "chunked". */
  streamChunkSize: number;
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
}

export interface UserSummary extends AccountInfo {
  createdAt: string;
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
    appearance: AppearancePreferences;
  };
  /** Workspace-wide, never overridden per account. */
  loginAppearance: LoginAppearance;
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
  /** Confirmation policy for the Superadmin-only host computer tool. */
  hostTrustMode: "full" | "partial" | "none";
  /** One entry for each risk level (1..5). Used only in partial trust mode. */
  hostTrustedRiskLevels: boolean[];
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
  | { kind: "compaction"; seconds?: number; summary?: string; reasoning?: string };

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
  currentTime: boolean;
  location: boolean;
  multipleChoice: boolean;
  hostComputer: boolean;
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
}

export type PublicConnectionConfig = Omit<ConnectionConfig, "apiKey"> & { apiKey: string; hasApiKey: boolean };

export type PublicConfig = Omit<AppConfig, "connections"> & {
  connections: PublicConnectionConfig[];
  account?: AccountInfo;
  /** Runtime capability, computed by the server and never persisted. */
  hostComputerAvailable?: boolean;
};
