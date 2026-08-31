export type ReasoningKind = "builtin" | "custom";
export type SystemPromptMode = "replace" | "prepend" | "append";
export type Locale = "en" | "ko";

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
  server: {
    baseUrl: string;
    apiKey: string;
  };
  profile: {
    name: string;
  };
  preferences: {
    sendReasoningToModel: boolean;
    exportReasoning: boolean;
    language: Locale;
    onDemand: boolean;
    showModelIdentifiers: boolean;
    defaultModelId?: string;
    defaultReasoningPresetId?: string;
  };
  toolSettings: ToolSettings;
  models: ModelConfig[];
}

export interface ToolSettings {
  maxToolRounds: number;
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

export type PublicConfig = Omit<AppConfig, "server"> & {
  server: AppConfig["server"] & { apiKey: string; hasApiKey: boolean };
  account?: AccountInfo;
};
