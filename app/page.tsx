"use client";

import { contextUsage, type ContextUsage } from "../lib/context-usage";
import { HarnessSettingsPanel, StorageSettingsPanel } from "./harness-settings";
import { TextDialog } from "./text-dialog";
import { useMessageDialog } from "./message-dialog";
import { HistorySearch } from "./history-search";
import { StorageManager } from "./storage-manager";
import { ChatManager } from "./chat-manager";
import { AdminConversationsDialog, AdminFilesDialog } from "./admin-user-audit";
import { ImageLightbox } from "./image-lightbox";
import { StorageUsageMeter } from "./storage-usage-meter";
import { AccountBackupSettings, DataManagementSettings } from "./backup-settings";
import { PlanSettings } from "./plan-settings";
import { McpSettings } from "./mcp-settings";
import { ArtifactCard } from "./artifact-viewer";
import { SyntaxHighlightedCode } from "./syntax-highlighted-code";
import { UsageDonut } from "./usage-donut";
import { USAGE_REFRESH_EVENT } from "@/lib/usage-popover";
import { formatModelWeight } from "@/lib/plan-usage";
import { DEFAULT_ENABLED_TOOLS } from "@/lib/enabled-tools";
import { SectionTitle } from "./section-title";
import { SelectMenu, usePopoverPresence } from "./select-menu";
import { NeuralMark } from "./neural-mark";
import { ACCENT_PALETTES, accentColorOf, accentVariables, DEFAULT_APPEARANCE, DEFAULT_LOGIN_APPEARANCE, defaultReasoningNote, normalizeHexColor, reasoningNote, REASONING_NOTE_KEYS } from "@/lib/appearance";
import { capabilitySummary, driverCapabilities } from "@/lib/driver-capabilities";
import { lastContentStep, reasoningStepIsWhole, replaceAssistantContent, stepToolEvents, transcriptSteps } from "@/lib/transcript";
import { greetingFor, greetingsFor, BAND_STARTS, timeBandFor } from "@/lib/greetings";
import { chatWaitLabel } from "@/lib/chat-progress";
import { normalizeReasoning, reasoningOptionName, isReasoningToggle } from "@/lib/reasoning-capabilities";

import {
  ArrowDown, ArrowUp, Lightbulb, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CirclePlus, Copy, Download, FileJson,
  FileText, GitBranch, GripVertical, Image as ImageIcon, ImageOff, ImagePlus, KeyRound, LoaderCircle, Menu, MessageSquarePlus, Pencil, Plus, RefreshCw,
  Search, Server, Settings2, SlidersHorizontal, Square, Trash2, UserRound, X, Globe2, Link2,
  LogOut, Users, ShieldCheck, Clock3, MapPin, ListChecks, Wrench, LocateFixed, Monitor, Power, Upload, HardDrive, ShieldAlert,
  Palette, PanelLeftClose, PanelLeftOpen, Settings, Type, Zap, FlaskConical, MessageSquareDashed, Save, Minimize2, Eye, EyeOff, Keyboard, DatabaseBackup, Gauge, Cable, Code2,
} from "lucide-react";
import { Children, cloneElement, createContext, CSSProperties, FormEvent, isValidElement, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type {
  ChatWaitPhase, ChatBranch, ConnectionConfig, Conversation, ConversationSummary, MessageStep, ModelConfig, PublicConfig,
  ReasoningPreset, StoredAttachment, StoredMessage, StorageFile, Locale, AccountInfo, UserSummary, EnabledTools, ToolEvent, MultipleChoiceQuestion, ToolSettings, AccentPaletteId, AppearancePreferences, LoginAppearance, ConnectionDriver, McpConnection, McpToolInfo, ArtifactDocument, HarnessSettings,
} from "@/lib/types";
import { advertisedContextWindowTokens, contextUsageDisplayLimitTokens, effectiveContextWindowTokens } from "@/lib/model-context";
import { shouldExpandComposer } from "@/lib/composer-layout";
import { createClientId } from "@/lib/client-id";
import { multipleChoiceAnswers, pendingMultipleChoiceEvent } from "@/lib/conversation-messages";
import { formatReasoningForDisplay, getToolGroupLabel, getToolGroupState, getToolStatusLabel } from "@/lib/tool-presentation";
import { APP_VERSION } from "@/lib/version";
import { isNearScrollBottom } from "@/lib/chat-scroll";
import { parseModelSettings, serializeModelSettings } from "@/lib/model-settings";
import { copyTextToClipboard, clipboardImages } from "@/lib/client-clipboard";
import { hasMobileComposerInput, shouldSubmitComposerOnEnter } from "@/lib/composer-keyboard";
import { literalStrikethroughSource } from "@/lib/markdown-rendering";
import { saveConversationRequest } from "@/lib/client-persistence";
import { useModalFocus, useModalTransition } from "@/lib/use-modal-focus";
import { connectionForModel, resolveConnectionModels, reconcileConnectionEdits } from "@/lib/connection-drivers";
import { connectedModels, modelServerState, onlineReplacement, type ServerState } from "@/lib/model-availability";
import { aliasBaseModel, aliasWithBaseModel } from "@/lib/alias-base-model";
import { useKeyboardReturn } from "@/lib/use-keyboard-return";
import { describeConnectionFailure, isConnectionFailureCode } from "@/lib/connection-errors";
import { moveItemById, nudgeItemById } from "@/lib/ordered-list";
import { duplicateConversation } from "@/lib/conversation-duplicate";
import { branchesHoldingRevision, deleteMessageEverywhere, deleteMessageFromBranch, revisionGroupOf } from "@/lib/branch-deletion";

type SettingsTab = "general" | "appearance" | "connection" | "mcp" | "tools" | "experimental" | "models" | "reasoning" | "users" | "plans" | "data" | "account";
type AuthStatus = { setupRequired: boolean; authenticated: boolean; user: AccountInfo | null; loginAccent?: string };
type MessageRevision = { messageId: string; branchId: string; updatedAt: string };
type QueuedPrompt = {
  id: string;
  content: string;
  attachments: StoredAttachment[];
  modelId: string;
  aliasBaseModelId?: string;
  reasoningPresetId?: string;
  sendReasoning: boolean;
  tools: EnabledTools;
};
type CompletionOptions = Omit<QueuedPrompt, "id" | "content" | "attachments">;
type AliasBasePicker = {
  models: ModelConfig[];
  selected?: ModelConfig;
  defaultId?: string;
  connections: PublicConfig["connections"];
  showIdentifiers: boolean;
  showConnectionNames: boolean;
  weights?: Record<string, number>;
  onSelect: (model: ModelConfig) => void;
  onDefault: () => void;
};
type ChatJobSnapshot = { conversationId: string; branchId: string; status: "running" | "waiting" | "completed" | "stopped" | "error"; message: StoredMessage; error?: string; waitPhase?: ChatWaitPhase; waitProgress?: number };
const emptyConfig: PublicConfig = {
  connections: [{ id: "openai-default", name: "OpenAI API", driver: "openai", baseUrl: "http://localhost:8888/v1", apiKey: "", hasApiKey: false, models: [] }],
  profile: { name: "" },
  preferences: { sendReasoningToModel: false, exportReasoning: true, language: "en", onDemand: false, showModelIdentifiers: true, renderStrikethrough: true, appearance: DEFAULT_APPEARANCE },
  loginAppearance: DEFAULT_LOGIN_APPEARANCE,
  showModelWeights: false,
  showModelConnectionNames: false,
  planModelIds: [],
  userStorageSettings: { defaultQuotaBytes: 512 * 1024 * 1024, defaultTrashQuotaBytes: 1024 * 1024 * 1024, trashRetentionDays: 60 },
  toolSettings: { maxToolRounds: 8, maxBrowserTabs: 8, maxMultipleChoiceQuestions: 3, maxAttachmentsPerMessage: 12, textDownloadLimitMb: 1, textCharacterLimit: 24_000, imageDownloadLimitMb: 10, imageUploadLimitMb: 20, pdfSizeLimitMb: 25, pdfPageLimit: 100, pdfTextCharacterLimit: 100_000, pdfVisionPageLimit: 6, pdfProcessingTimeoutSeconds: 30, temporaryFileTtlMinutes: 60, orphanUploadTtlHours: 24 },
  experimental: { browserTool: false, hostComputerTool: false },
  mcpConnections: [],
  mcpEntitlement: { enabled: false, maxConnections: 0, usedConnections: 0 },
  models: [],
};
const uid = createClientId;
const now = () => new Date().toISOString();
const titleFrom = (text: string) => text.trim().split(/\s+/).slice(0, 7).join(" ").slice(0, 58) || "New chat";
const McpToolsContext = createContext<{ connections: McpConnection[]; selectedIds: string[]; setSelectedIds: (ids: string[]) => void; selectedTools:Record<string,string[]>;setSelectedTools:(id:string,names:string[])=>void }>({ connections: [], selectedIds: [], setSelectedIds: () => undefined,selectedTools:{},setSelectedTools:()=>undefined });
const StorageToolsContext=createContext<{read:boolean;write:boolean;maxFiles:number;setRead:(value:boolean)=>void;setWrite:(value:boolean)=>void;setMaxFiles:(value:number)=>void}>({read:true,write:false,maxFiles:5,setRead:()=>undefined,setWrite:()=>undefined,setMaxFiles:()=>undefined});
const AliasBaseContext = createContext<AliasBasePicker | undefined>(undefined);

const translations = {
  en: {
    newChat: "New Chat", search: "Search", storageManager: "Storage manager", searchChats: "Search chats…", histories: "Chat histories", exportChat: "Export chat", deleteChat: "Delete chat", deleteAllChats: "Delete all chats", confirmDeleteChat: "Delete this chat?", confirmDeleteAllChats: "Delete all chat histories?",
    historyEmpty: "Your conversations will appear here.", settingsConnections: "Settings & connections", selectModel: "Select a model",
    availableModels: "Available models", checkingModelServers: "Checking model servers", noOnlineModels: "No model server is online.", modelServerOffline: "The server serving this model is offline", modelServerError: "The server serving this model is answering with an error", serverOffline: "Server offline", modelWeightHint: "Uses tokens {weight}x faster", showModelWeights: "Show model weights", showModelWeightsDesc: "Show every account, including administrators, a weight badge on models whose plan weight is not 1. This is a workspace setting.", showModelConnectionNames:"Show model server names", showModelConnectionNamesDesc:"Show connection server names in the model picker for every account. This workspace setting is off by default.", unloadModel: "Unload loaded model", unloadingModel: "Unloading…", modelUnloaded: "The model was unloaded.", modelUnloadFailed: "Unable to unload the model.", welcome: "What would you like to explore?",
    messagePlaceholder: "Message to send", reasoningPreset: "Reasoning preset", native: "Native", template: "Template", default: "default",
    sendPriorReasoning: "Remember its train of thought", sendPriorReasoningDesc: "Send the earlier reasoning back with the next request",
    disclaimer: "Responses may be inaccurate. Verify important information.", stop: "Stop generating", send: "Send message", addToQueue: "Add to queue", queuedMessages: "Queued messages", removeQueuedMessage: "Remove queued message",
    cancel: "Cancel", close: "Close", closeMenu: "Close menu", forkSend: "Fork & send", editBranch: "Edit and branch", reasoning: "Reasoning", copy: "Copy", regenerate: "Regenerate response", regenerateRequest: "Regenerate from this message", deleteMessage: "Delete message", confirmDeleteMessage: "Delete this message and its connected model response?", previousRevision: "Previous revision", nextRevision: "Next revision",
    confirmDelete: "Delete", irreversibleAction: "This action cannot be undone.", deleteWhileGenerating: "Wait for the response to finish before deleting this message.", editPrompt: "Edit prompt", editMessage: "Edit message",
    exportConversation: "Export conversation", exportDescription: "Export every branch as JSON, or the selected branch as Markdown.",
    exportAllChats: "Export every chat", exportAllDescription: "Package every saved chat, with all of its branches, as one ZIP archive.", exportAllChatsAction: "ZIP · every chat", exportingAllChats: "Packaging…", exportAllFailed: "The chats could not be exported.",
    duplicateChat: "Duplicate", duplicateChatFailed: "The chat could not be duplicated.", duplicatedChat: "The chat was duplicated with every branch.",
    deleteThisBranch: "This branch only", deleteEveryBranch: "Every branch", deleteScopeHelp: "This request also exists in another branch. Delete only the version in the branch you are reading, or every version of it.",
    includeReasoning: "Include reasoning", includeReasoningDesc: "Include model reasoning content in the export.", allBranches: "all branches",
    workspace: "Workspace", settings: "Settings", connection: "Connection", models: "Models", reasoningLevel: "Reasoning level", saveChanges: "Save changes", saving: "Saving…",
    serverTitle: "Model connections", serverDesc: "Add servers and drag them into priority order. The first server wins duplicate model identifiers.", baseUrl: "Base URL", connectionName: "Connection name", driver: "Driver", addConnection: "Add connection", removeConnection: "Remove connection", confirmRemoveConnection: "Remove this connection?", removeConnectionDetail: "Its models leave the picker once the settings are saved.", connectionEnabled: "Use this connection", serverStateOnline: "Online", serverStateOffline: "Offline", serverStateError: "Online, but answering with an error", serverStateDisabled: "Disabled", detectFailedTitle: "Model detection failed", detectFailedNotice: "Model detection failed.", detectFailedDetail: "Server response", priorityHelp: "Highest priority", moveUp: "Move up", moveDown: "Move down",
    baseUrlHelp: "Include the API version path, usually /v1.", apiKey: "API key", savedKey: "Saved key ••••••••", requiredKey: "Required by the current server",
    apiKeyHelp: "The key is stored only on this server and is never returned to the browser.", displayName: "Display name",
    discover: "Discover models & capabilities", discoverDesc: "Calls GET /models and keeps every model returned by the server.", detecting: "Detecting…", detectModels: "Detect models",
    modelsTitle: "Models & aliases", modelsDesc: "All served models stay here. Choose which ones appear in the chat interface.", newAlias: "New alias",
    customAlias: "CUSTOM ALIAS", servedModel: "SERVED MODEL", modelId: "Model ID", baseModel: "Recommended base model", servedIdentifier: "Served model identifier", aliasBaseModel: "Alias base model", aliasBaseModelDesc: "Choose the served model used by this alias for the current chat.", defaultAliasBaseActive: "Default alias base model",
    description: "Description", systemPrompt: "System prompt", systemPromptPlaceholder: "Applied to every conversation with this model…", deleteAlias: "Delete alias",
    showMain: "Show in main interface", showMainDesc: "Also show this model in the Reasoning section and model picker.", noModel: "No model selected.", imageGenerationModel:"Image generation model", imageGenerationModelDesc:"Use the OpenAI-compatible Images API and save generated images to private storage.", imageInputModel:"Image input model", imageInputModelDesc:"Allow image attachments to be sent to this model.", imageGenerationBadge:"Image generation model", imageGenerationNoInputBadge:"Image generation model without image input", modelAttachmentUnsupported:"The selected model does not support one or more attached files.",
    reasoningTitle: "Reasoning effort", reasoningDesc: "Configure native effort levels and prompt templates separately for each visible model.", addTemplate: "Add template",
    nativeSupport: "Native reasoning support", noEffortMetadata: "No native reasoning controls advertised. Custom prompt templates remain available.", builtIn: "Built-in",
    customTemplate: "Custom template", nativeEffort: "Native reasoning setting sent to API", doNotSend: "Do not send", additionalPrompt: "Additional system prompt",
    promptHandling: "System prompt handling", replace: "Replace", prepend: "Prepend", append: "Append", noPresets: "No presets yet. Add one to control this model's reasoning.",
    language: "Language", general: "General", generalTitle: "General settings", generalDesc: "Choose interface and inference behavior.", appearance: "Appearance", appearanceTitle: "Appearance", appearanceDesc: "Customize colors, greetings, and response display.", interfaceLanguage: "Interface language", languageHelp: "The selected language is saved for future visits.", english: "English", korean: "Korean", onDemand: "On demand", onDemandHelp: "Load the selected model through /api/inference/load before each inference request.", showModelIdentifiers: "Show model identifiers", showModelIdentifiersHelp: "Show served identifiers below model names in model lists.", renderStrikethrough: "Render strikethrough", renderStrikethroughHelp: "Render text surrounded by one or two tildes as strikethrough. When off, the tildes remain visible.", appVersion: "Version", saved: "Saved.", detectSaved: "models and capabilities detected. Save changes to apply.", detectFirst: "Detect a server model first.", useAsDefault: "Use as default", defaultModelActive: "Default model", defaultReasoningActive: "Default reasoning", modelSettingsTransfer: "Model and reasoning settings", modelSettingsTransferDesc: "Export these settings as two-space JSON, or import a compatible file and apply it immediately.", exportModelSettings: "Export JSON", importModelSettings: "Import JSON", importedModelSettings: "Imported and applied model settings.", invalidModelSettings: "This is not a valid NeuralNetUI model settings file.",
    attachImages: "Upload images or PDFs", loadFromStorage: "Choose files from storage", uploadingImages: "Preparing and uploading files…", removeImage: "Remove attachment", loadEarlier: "Load earlier messages",
    imagesAttached: "files attached", imageChat: "File chat", imageUploadFailed: "File upload failed.", maxImages: "You have reached the configured attachment limit.",
    thinking: "Thinking…", compactingNow: "Compacting context…", compactionThought: "Compaction reasoning", compactionSummary: "Summary kept in context", editResponse: "Edit response", saveEdit: "Save", thoughtFor: "Thought for", useWrapping: "Use wrapping", copied: "Copied",
    addMenu: "Add", tools: "Tools", internetGroup: "Internet", awarenessGroup: "Ambient awareness", agentGroup: "Agent", interactionGroup: "Interaction", internetSearch: "Internet search", internetSearchDesc: "Let the model search DuckDuckGo", pageVisit: "Visit pages", pageVisitDesc: "Let the model read public web pages", browserTool: "Browser", browserToolDesc: "Render JavaScript pages, interact, and take screenshots", hostComputerTool: "Host computer", hostComputerToolDesc: "Let the model control files, shells, programs, uploads, and the host screen", storageAccess: "Storage access", storageAccessDesc: "Let the model privately access your stored files", storageRead:"Read", storageReadDesc:"Search and load files", storageWrite:"Write", storageWriteDesc:"Create text or Markdown files", storageWriteLimit:"files per session", browserView: "Show browser", browserViewTitle: "Live browser", browserWaiting: "The model has not opened a browser page yet.", browserHeaded: "Headed Chromium", browserFallback: "Compatibility mode", browserAddress: "Address", browserText: "Type into the focused field", browserSendText: "Type", browserBack: "Back", browserForward: "Forward", browserReload: "Reload", browserNewTab: "New tab", browserCloseTab: "Close tab", browserUntitledTab: "New tab", browserComplete: "I finished interacting", browserCompleteHelp: "The model is waiting for you to finish this browser step.", currentTime: "Current time", currentTimeDesc: "Provide local time and time zone to the model", locationTool: "Current location", locationToolDesc: "Use browser location and detailed reverse geocoding", multipleChoice: "Multiple choice", multipleChoiceDesc: "Let the model ask selectable questions", artifact: "Artifact", artifactDesc: "Render HTML, CSV, JSON, XML, or Markdown in an interactive viewer", usingTool: "Using a tool…", toolCall: "Tool call", toolResult: "Tool result", submitChoices: "Submit answers", otherChoice: "Or type a direct answer…", choiceNext: "Next", choiceBack: "Previous question", choiceProgress: "Question", choiceWaiting: "Answer the request above to continue", locationPermission: "Waiting for browser location permission…", hostApprovalTitle: "Host action approval", mcpApprovalTitle:"MCP tool approval", hostApprove: "Allow", hostReject: "Deny", hostRedirect: "Deny and redirect", hostRedirectPlaceholder: "Tell the model what to do instead…", hostRiskLevel: "Risk level",
    account: "Account", users: "Users", signOut: "Sign out", changePassword: "Change password", currentPassword: "Current password", newPassword: "New password", passwordChanged: "Password changed. Please sign in again.",
    toolsSettings: "Harness settings", toolsSettingsTitle: "Tool and file limits", toolsSettingsDesc: "Control tool iterations, interactive tools, downloads, PDF processing, and temporary upload cleanup.", maxToolRounds: "Maximum tool rounds", maxBrowserTabs: "Browser tabs per session", maxMultipleChoiceQuestions: "Questions per multiple-choice call", maxAttachments: "Attachments per message", textDownloadLimit: "Text download limit (MB)", textCharacterLimit: "Text characters sent to model", imageDownloadLimit: "Image URL limit (MB)", imageUploadLimit: "Image upload limit (MB)", pdfSizeLimit: "PDF limit (MB)", pdfPageLimit: "PDF pages processed", pdfTextLimit: "PDF characters sent to model", pdfVisionPages: "Scanned PDF vision pages", pdfTimeout: "PDF processing timeout (seconds)", temporaryFileTtl: "Temporary file cleanup (minutes)", orphanTtl: "Unattached upload retention (hours)", toolLoopGroup: "Tool loop", interactiveToolGroup: "Interactive tools", attachmentGroup: "Attachments and downloads", pdfGroup: "PDF processing", cleanupGroup: "Temporary file cleanup", toolsSafetyHelp: "Tool and file limit values are validated against server safety boundaries when saved.",
    userManagement: "User management", userManagementDesc: "Administrators can create accounts, change display names and roles, and delete accounts.", username: "Username", password: "Password", role: "Role", standardUser: "User", administrator: "Administrator", addUser: "Add user", saveDisplayName: "Save user changes", deleteUser: "Delete user", confirmDeleteUser: "Permanently delete this user and all of their data?", userDeleted: "User deleted.", publicModel: "Public custom model", publicModelDesc: "Allow every user to use this custom model.",
    contextWindow: "Context window", contextWindowHelp: "Set a per-model fallback limit. When the API also advertises a limit, the smaller value is used.", aliasContextWindowHelp: "Leave empty to inherit the base model. A value here overrides the base model setting while respecting the server limit.", inheritedContextWindow: "Inherited from base model", apiContextWindow: "API-detected context", effectiveContextWindow: "Effective maximum", contextUsed: "context tokens used", contextUnavailable: "Set this model's context window in Settings.",
    visionSettings: "Image input", visionSettingsDesc: "Limit the image copy sent to this model. Stored originals are never changed.", visionUseOriginal: "Limit image resolution", visionUseOriginalDesc: "Turn on to proportionally reduce images before inference; turn off to use originals.", visionMaxResolution: "Maximum long edge (px)", visionMaxResolutionHelp: "Images are proportionally reduced to this long-edge limit before inference.",
    loginAccentTitle: "Sign-in screen accent", loginAccentHelp: "Accent for the sign-in screen, shared by everyone. Each account's own accent applies once they are signed in.",
    applyToEveryone: "Apply to everyone", applyingToEveryone: "Applying…", appliedToEveryone: "Applied to every account.",
    servedReasoningLocked: "Reasoning templates for served models are an administrator's to change. Add a custom model to keep templates of your own.",
    accentTitle: "Accent colour", accentHelp: "Buttons, switches and selected states use this colour. Text and input fields stay white and grey.", accentBlue: "Blue", accentViolet: "Violet", accentTeal: "Teal", accentAmber: "Amber", accentRose: "Rose", accentGraphite: "Graphite", accentCustom: "Custom", accentHex: "Hex value",
    streamRevealTitle: "Response appearance", streamRevealHelp: "Choose whether each newly received text fragment appears immediately or fades in.", streamInstant: "Plain", streamInstantDesc: "Every token appears immediately with a fixed 0 ms duration.", streamFade: "Soft fade", streamFadeDesc: "Each incoming token fades in independently without flashing existing content.", streamFadeDuration: "Fade duration per token", streamFadeDurationHelp: "Longer durations make each incoming token settle more gently.",
    nativePresetNote: "Built-in native levels cannot be renamed or removed, so they are offered only in the chat reasoning picker.",
    hideActivity: "Hide tool and thinking history", showActivity: "Show tool and thinking history", scrollToBottom: "Resume automatic scrolling",
    temporaryChat: "Temporary chat", saveChat: "Save this chat", savingChat: "Saving…", chatSaved: "Saved to your history.", chatSaveFailed: "This chat could not be saved.",
    returnToRegularChat: "Return to regular chat", temporaryGreeting: "Hello, traveler", temporaryChatHint: "Chats are not saved",
    reasoningNotesTitle: "Reasoning descriptions", reasoningNotesHelp: "Show a short line under each reasoning choice in the chat picker, and word it however you like.", reasoningNotesReset: "Leave a field empty to use the built-in wording.",
    experimental: "Experimental", experimentalTitle: "Experimental features", experimentalDesc: "Unfinished capabilities. Switch one on to offer it in the chat tool menu.", experimentalBrowser: "Browser tool", experimentalBrowserDesc: "Let the model and you share an isolated headed Chromium session. Open its live split view to click, scroll, type, or complete a human-only step.", experimentalHost: "Host computer tool", experimentalHostDesc: "Superadmin-only control of files, PowerShell/Bash, background programs, temporary uploads, and the current screen. Available only when NeuralNetUI is not running in a container.", experimentalHelp: "While a feature is off, the tool is hidden from the chat menu and refused by the server even if a client asks for it.",
    outputTokens: "output tokens", reasoningTokens: "reasoning", tokensPerSecond: "tok/s", timeToFirstToken: "Time to first token",
  },
  ko: {
    newChat: "새 채팅", search: "검색", storageManager: "저장소 관리", searchChats: "채팅 검색…", histories: "채팅 기록", exportChat: "채팅 내보내기", deleteChat: "대화 삭제", deleteAllChats: "전체 대화 삭제", confirmDeleteChat: "이 대화를 삭제할까요?", confirmDeleteAllChats: "모든 대화 기록을 삭제할까요?",
    historyEmpty: "대화를 시작하면 여기에 표시됩니다.", settingsConnections: "설정 및 연결", selectModel: "모델 선택",
    availableModels: "사용 가능한 모델", checkingModelServers: "모델 서버 확인 중", noOnlineModels: "온라인 상태인 모델 서버가 없습니다.", modelServerOffline: "모델을 서빙하는 서버가 오프라인입니다", modelServerError: "모델을 서빙하는 서버에서 오류가 발생했습니다", serverOffline: "서버 오프라인", modelWeightHint: "토큰을 {weight}배 더 빨리 소모합니다", showModelWeights: "모델 가중치 표시", showModelWeightsDesc: "플랜 가중치가 1이 아닌 모델에 가중치 딱지를 표시합니다. 전역 설정이며 관리자를 포함한 모든 사용자에게 적용됩니다.", showModelConnectionNames:"모델 서버 이름 표시", showModelConnectionNamesDesc:"모델 선택 드롭다운에 연결 서버 이름을 표시합니다. 기본값은 꺼짐이며 모든 사용자에게 적용되는 전역 설정입니다.", unloadModel: "로드된 모델 언로드", unloadingModel: "언로드 중…", modelUnloaded: "모델을 언로드했습니다.", modelUnloadFailed: "모델을 언로드하지 못했습니다.", welcome: "무엇을 함께 살펴볼까요?",
    messagePlaceholder: "보낼 메시지", reasoningPreset: "Reasoning 프리셋", native: "내장", template: "템플릿", default: "기본값",
    sendPriorReasoning: "생각 기록 기억하기", sendPriorReasoningDesc: "다음 요청에 이전 생각 기록을 함께 보냅니다",
    disclaimer: "응답이 부정확할 수 있습니다. 중요한 정보는 확인해 주세요.", stop: "생성 중단", send: "메시지 전송", addToQueue: "대기열에 추가", queuedMessages: "대기 중인 메시지", removeQueuedMessage: "대기열에서 제거",
    cancel: "취소", close: "닫기", closeMenu: "메뉴 닫기", forkSend: "분기 후 전송", editBranch: "편집 후 분기", reasoning: "Reasoning", copy: "복사", regenerate: "응답 재생성", regenerateRequest: "이 메시지부터 재생성", deleteMessage: "메시지 삭제", confirmDeleteMessage: "이 메시지와 연결된 모델 응답을 함께 삭제할까요?", previousRevision: "이전 수정본", nextRevision: "다음 수정본",
    confirmDelete: "삭제", irreversibleAction: "이 작업은 되돌릴 수 없습니다.", deleteWhileGenerating: "응답 생성이 끝난 뒤에 메시지를 삭제할 수 있습니다.", editPrompt: "프롬프트 편집", editMessage: "메시지 편집",
    exportConversation: "대화 내보내기", exportDescription: "모든 브랜치를 JSON으로, 선택한 브랜치를 Markdown으로 내보냅니다.",
    exportAllChats: "전체 채팅 내보내기", exportAllDescription: "저장된 모든 채팅을 분기까지 포함해 하나의 ZIP 파일로 내려받습니다.", exportAllChatsAction: "ZIP · 전체 채팅", exportingAllChats: "압축하는 중…", exportAllFailed: "채팅을 내보내지 못했습니다.",
    duplicateChat: "복제하기", duplicateChatFailed: "채팅을 복제하지 못했습니다.", duplicatedChat: "모든 분기를 포함해 채팅을 복제했습니다.",
    deleteThisBranch: "이 분기만", deleteEveryBranch: "모든 분기", deleteScopeHelp: "이 요청은 다른 분기에도 있습니다. 지금 보고 있는 분기의 내용만 지울지, 모든 분기의 같은 요청을 지울지 선택하세요.",
    includeReasoning: "Reasoning 포함", includeReasoningDesc: "내보내기에 모델의 reasoning 내용을 포함합니다.", allBranches: "모든 브랜치",
    workspace: "워크스페이스", settings: "설정", connection: "연결", models: "모델", reasoningLevel: "추론 수준", saveChanges: "변경사항 저장", saving: "저장 중…",
    serverTitle: "모델 서버 연결", serverDesc: "서버를 추가하고 드래그해 우선순위를 정합니다. 중복 모델 identifier는 가장 위 서버를 사용합니다.", baseUrl: "기본 URL", connectionName: "연결 이름", driver: "드라이버", addConnection: "연결 추가", removeConnection: "연결 삭제", confirmRemoveConnection: "이 연결을 삭제할까요?", removeConnectionDetail: "설정을 저장하면 이 서버의 모델이 모델 선택 메뉴에서 사라집니다.", connectionEnabled: "연결 사용", serverStateOnline: "온라인", serverStateOffline: "오프라인", serverStateError: "온라인이지만 오류 발생", serverStateDisabled: "비활성화", detectFailedTitle: "모델 감지 실패", detectFailedNotice: "모델 감지에 실패했습니다.", detectFailedDetail: "서버 응답", priorityHelp: "최우선", moveUp: "위로 이동", moveDown: "아래로 이동",
    baseUrlHelp: "일반적으로 /v1을 포함한 API 버전 경로를 입력합니다.", apiKey: "API 키", savedKey: "저장된 키 ••••••••", requiredKey: "현재 서버에 API 키가 필요합니다",
    apiKeyHelp: "키는 이 서버에만 저장되며 브라우저로 다시 전송되지 않습니다.", displayName: "표시 이름",
    discover: "모델 및 기능 감지", discoverDesc: "GET /models를 호출하고 서버가 반환한 모든 모델을 보존합니다.", detecting: "감지 중…", detectModels: "모델 감지",
    modelsTitle: "모델 및 별칭", modelsDesc: "서빙되는 모든 모델을 보존하고 채팅 화면에 표시할 모델만 선택합니다.", newAlias: "새 별칭",
    customAlias: "커스텀 별칭", servedModel: "서빙 모델", modelId: "모델 ID", baseModel: "권고 기반 모델", servedIdentifier: "서빙 모델 식별자", aliasBaseModel: "Alias 기반 모델", aliasBaseModelDesc: "현재 채팅에서 이 Alias가 사용할 서빙 모델을 선택합니다.", defaultAliasBaseActive: "기본 Alias 기반 모델",
    description: "설명", systemPrompt: "시스템 프롬프트", systemPromptPlaceholder: "이 모델의 모든 대화에 적용됩니다…", deleteAlias: "별칭 삭제",
    showMain: "메인 인터페이스에 표시", showMainDesc: "모델 선택기와 추론 수준 섹션에도 이 모델을 표시합니다.", noModel: "선택된 모델이 없습니다.", imageGenerationModel:"이미지 생성 모델", imageGenerationModelDesc:"OpenAI 호환 Images API를 사용하고 생성 이미지를 개인 저장소에 저장합니다.", imageInputModel:"이미지 입력 모델", imageInputModelDesc:"이 모델에 이미지 파일을 첨부해 전송할 수 있습니다.", imageGenerationBadge:"이미지 생성 모델", imageGenerationNoInputBadge:"이미지 입력을 지원하지 않는 이미지 생성 모델", modelAttachmentUnsupported:"선택한 모델이 첨부된 파일 형식 일부를 지원하지 않습니다.",
    reasoningTitle: "추론 수준", reasoningDesc: "표시된 모델별로 내장 effort와 프롬프트 템플릿을 설정하고 채팅 메뉴에 표시할 순서를 정합니다.", addTemplate: "템플릿 추가",
    nativeSupport: "Native Reasoning 지원", noEffortMetadata: "서버가 내장 추론 제어를 제공하지 않습니다. 커스텀 프롬프트 템플릿은 사용할 수 있습니다.", builtIn: "내장",
    customTemplate: "커스텀 템플릿", nativeEffort: "API로 전송할 추론 설정", doNotSend: "전송하지 않음", additionalPrompt: "추가 시스템 프롬프트",
    promptHandling: "시스템 프롬프트 처리", replace: "대체", prepend: "앞에 추가", append: "뒤에 추가", noPresets: "아직 프리셋이 없습니다. 템플릿을 추가해 주세요.",
    language: "언어", general: "일반", generalTitle: "일반 설정", generalDesc: "인터페이스와 추론 동작을 설정합니다.", appearance: "모양", appearanceTitle: "모양", appearanceDesc: "색상, 환영 메시지, 응답 표시 방식을 설정합니다.", interfaceLanguage: "인터페이스 언어", languageHelp: "선택한 언어는 저장되어 다음 접속에도 유지됩니다.", english: "영어", korean: "한국어", onDemand: "On demand", onDemandHelp: "추론 요청 전에 /api/inference/load를 호출해 선택한 모델을 로드합니다.", showModelIdentifiers: "모델 identifier 표시", showModelIdentifiersHelp: "모델 목록에서 모델 이름 아래에 서빙 identifier를 표시합니다.", renderStrikethrough: "취소선 렌더링", renderStrikethroughHelp: "물결표 한 개 또는 두 개로 감싼 텍스트를 취소선으로 표시합니다. 끄면 물결표를 그대로 표시합니다.", appVersion: "버전", saved: "저장했습니다.", detectSaved: "개 모델과 기능을 감지했습니다. 저장을 눌러 적용하세요.", detectFirst: "먼저 서버 모델을 감지해 주세요.", useAsDefault: "기본으로 사용", defaultModelActive: "기본 모델", defaultReasoningActive: "기본 추론 강도", modelSettingsTransfer: "모델 및 추론 강도 설정", modelSettingsTransferDesc: "2칸 들여쓰기 JSON으로 내보내거나 호환 파일을 가져와 즉시 적용합니다.", exportModelSettings: "JSON 내보내기", importModelSettings: "JSON 가져오기", importedModelSettings: "모델 설정을 가져와 적용했습니다.", invalidModelSettings: "올바른 NeuralNetUI 모델 설정 파일이 아닙니다.",
    attachImages: "이미지 또는 PDF 업로드", loadFromStorage: "저장소에서 파일 불러오기", uploadingImages: "파일 준비 및 업로드 중…", removeImage: "첨부 제거", loadEarlier: "이전 메시지 불러오기",
    imagesAttached: "개 파일 첨부", imageChat: "파일 대화", imageUploadFailed: "파일 업로드에 실패했습니다.", maxImages: "설정된 첨부 개수 제한에 도달했습니다.",
    thinking: "생각 중…", compactingNow: "컨텍스트 압축 중…", compactionThought: "압축 모델의 사고", compactionSummary: "맥락으로 유지되는 요약", editResponse: "응답 편집", saveEdit: "저장", thoughtFor: "동안 생각함", useWrapping: "줄 바꿈 사용", copied: "복사됨",
    addMenu: "추가", tools: "도구", internetGroup: "인터넷", awarenessGroup: "주변 인식", agentGroup: "에이전트", interactionGroup: "상호 작용", internetSearch: "인터넷 검색", internetSearchDesc: "모델이 DuckDuckGo를 검색하도록 허용", pageVisit: "페이지 방문", pageVisitDesc: "모델이 공개 웹 페이지를 읽도록 허용", browserTool: "브라우저", browserToolDesc: "JS 페이지 렌더링, 인터랙션 및 스크린샷 허용", hostComputerTool: "호스트 컴퓨터", hostComputerToolDesc: "모델의 파일·셸·프로그램·업로드·호스트 화면 제어 허용", storageAccess: "저장소 접근", storageAccessDesc: "모델의 개인 저장소 접근 권한", storageRead:"읽기", storageReadDesc:"파일 검색 및 불러오기", storageWrite:"쓰기", storageWriteDesc:"텍스트·Markdown 파일 생성", storageWriteLimit:"세션당 파일", browserView: "브라우저 화면 보기", browserViewTitle: "실시간 브라우저", browserWaiting: "아직 모델이 브라우저 페이지를 열지 않았습니다.", browserHeaded: "화면형 Chromium", browserFallback: "호환 모드", browserAddress: "주소", browserText: "선택한 입력란에 입력", browserSendText: "입력", browserBack: "뒤로", browserForward: "앞으로", browserReload: "새로고침", browserNewTab: "새 탭", browserCloseTab: "탭 닫기", browserUntitledTab: "새 탭", browserComplete: "조작 완료", browserCompleteHelp: "모델이 브라우저 조작 완료를 기다리는 중입니다.", currentTime: "현재 시간", currentTimeDesc: "현지 시간과 시간대를 모델에 제공", locationTool: "현재 위치", locationToolDesc: "브라우저 위치와 상세 역지오코딩 사용", multipleChoice: "다중 선택", multipleChoiceDesc: "모델이 설정된 개수만큼 선택형 질문을 요청", artifact: "아티팩트", artifactDesc: "HTML·CSV·JSON·XML·Markdown을 전용 뷰어로 렌더링", usingTool: "도구 사용 중…", toolCall: "도구 호출", toolResult: "도구 결과", submitChoices: "답변 제출", otherChoice: "또는 직접 답변…", choiceNext: "다음", choiceBack: "이전 질문", choiceProgress: "질문", choiceWaiting: "위 요청에 응답하면 모델이 계속 작업합니다", locationPermission: "브라우저 위치 권한을 기다리는 중…", hostApprovalTitle: "호스트 작업 승인", mcpApprovalTitle:"MCP 도구 승인", hostApprove: "허용", hostReject: "거부", hostRedirect: "거부 후 다른 작업 지시", hostRedirectPlaceholder: "대신 수행할 작업을 모델에 알려주세요…", hostRiskLevel: "위험도",
    account: "계정", users: "사용자", signOut: "로그아웃", changePassword: "비밀번호 변경", currentPassword: "현재 비밀번호", newPassword: "새 비밀번호", passwordChanged: "비밀번호를 변경했습니다. 다시 로그인해 주세요.",
    toolsSettings: "하네스 설정", toolsSettingsTitle: "도구 및 파일 제한", toolsSettingsDesc: "도구 반복, 인터랙티브 도구, 다운로드, PDF 처리 및 임시 업로드 정리 기준을 설정합니다.", maxToolRounds: "최대 도구 호출 라운드", maxBrowserTabs: "브라우저 세션당 탭 수", maxMultipleChoiceQuestions: "다중 선택 호출당 질문 수", maxAttachments: "메시지당 첨부 개수", textDownloadLimit: "텍스트 다운로드 제한 (MB)", textCharacterLimit: "모델에 전달할 텍스트 글자 수", imageDownloadLimit: "이미지 URL 제한 (MB)", imageUploadLimit: "이미지 업로드 제한 (MB)", pdfSizeLimit: "PDF 제한 (MB)", pdfPageLimit: "처리할 PDF 페이지 수", pdfTextLimit: "모델에 전달할 PDF 글자 수", pdfVisionPages: "스캔 PDF 비전 페이지 수", pdfTimeout: "PDF 처리 제한 시간 (초)", temporaryFileTtl: "임시 파일 정리 시간 (분)", orphanTtl: "미첨부 업로드 보관 시간", toolLoopGroup: "도구 반복", interactiveToolGroup: "인터랙티브 도구", attachmentGroup: "첨부 및 다운로드", pdfGroup: "PDF 처리", cleanupGroup: "임시 파일 정리", toolsSafetyHelp: "도구 및 파일 제한 값은 저장 시 서버의 안전 범위 안에서 검증됩니다.",
    userManagement: "사용자 관리", userManagementDesc: "관리자는 계정을 만들고, 다른 사용자의 표시 이름과 권한을 변경하거나 계정을 삭제할 수 있습니다.", username: "사용자 이름", password: "비밀번호", role: "역할", standardUser: "일반 사용자", administrator: "관리자", addUser: "사용자 추가", saveDisplayName: "사용자 변경 저장", deleteUser: "사용자 삭제", confirmDeleteUser: "이 사용자와 모든 데이터를 영구적으로 삭제할까요?", userDeleted: "사용자를 삭제했습니다.", publicModel: "커스텀 모델 공개", publicModelDesc: "모든 사용자가 이 커스텀 모델을 사용할 수 있습니다.",
    contextWindow: "컨텍스트 윈도우", contextWindowHelp: "모델별 대체 한도를 설정합니다. API도 한도를 반환하면 둘 중 작은 값을 사용합니다.", aliasContextWindowHelp: "비워 두면 기반 모델 값을 상속합니다. 값을 입력하면 서버 한도 안에서 기반 모델 설정을 오버라이드합니다.", inheritedContextWindow: "기반 모델에서 상속", apiContextWindow: "API 감지 컨텍스트", effectiveContextWindow: "적용 최대값", contextUsed: "컨텍스트 토큰 사용", contextUnavailable: "설정에서 이 모델의 컨텍스트 윈도우를 지정해 주세요.",
    visionSettings: "이미지 입력", visionSettingsDesc: "이 모델에 전달되는 이미지 사본의 해상도만 제한합니다. 저장된 원본은 변경하지 않습니다.", visionUseOriginal: "이미지 해상도 제한", visionUseOriginalDesc: "켜면 추론 전에 이미지를 비율에 맞춰 축소하고, 끄면 원본을 사용합니다.", visionMaxResolution: "긴 변 최대 해상도 (px)", visionMaxResolutionHelp: "추론 전에 비율을 유지한 채 이 긴 변 한도까지 축소합니다.",
    loginAccentTitle: "로그인 화면 액센트 색상", loginAccentHelp: "로그인 화면에 모두에게 같이 적용되는 색상입니다. 계정별 액센트 색상은 로그인 후에 적용됩니다.",
    applyToEveryone: "전체 적용", applyingToEveryone: "적용하는 중…", appliedToEveryone: "모든 계정에 적용했습니다.",
    servedReasoningLocked: "서빙 모델의 추론 템플릿은 관리자만 변경할 수 있습니다. 직접 관리하려면 커스텀 모델을 추가하세요.",
    accentTitle: "액센트 색상", accentHelp: "버튼, 스위치, 선택 상태에 이 색을 사용합니다. 텍스트와 입력 필드는 흰색과 회색을 유지합니다.", accentBlue: "블루", accentViolet: "바이올렛", accentTeal: "틸", accentAmber: "앰버", accentRose: "로즈", accentGraphite: "그라파이트", accentCustom: "커스텀", accentHex: "HEX 값",
    streamRevealTitle: "응답 표시 방식", streamRevealHelp: "새로 들어오는 각 토큰을 즉시 표시하거나 개별적으로 페이드 인합니다.", streamInstant: "기본", streamInstantDesc: "모든 토큰을 0ms 고정으로 즉시 표시합니다.", streamFade: "부드러운 페이드", streamFadeDesc: "기존 내용은 그대로 두고 새 토큰만 각각 부드럽게 나타납니다.", streamFadeDuration: "토큰별 페이드 시간", streamFadeDurationHelp: "값이 클수록 새 토큰이 더 천천히 선명해집니다.",
    nativePresetNote: "기본 제공 Native 추론 수준은 이름 변경과 삭제가 불가능하므로 채팅의 추론 선택 창에서만 제공됩니다.",
    hideActivity: "도구 / 사고 기록 숨기기", showActivity: "도구 / 사고 기록 표시", scrollToBottom: "자동 스크롤 다시 시작",
    temporaryChat: "임시 채팅", saveChat: "이 채팅 저장", savingChat: "저장 중…", chatSaved: "채팅 기록에 저장했습니다.", chatSaveFailed: "채팅을 저장하지 못했습니다.",
    returnToRegularChat: "일반 채팅으로 돌아가기", temporaryGreeting: "안녕하세요, 여행자", temporaryChatHint: "채팅이 저장되지 않습니다",
    reasoningNotesTitle: "추론 강도 설명", reasoningNotesHelp: "채팅의 추론 선택 창에서 각 항목 아래에 짧은 설명을 표시하고, 문구를 직접 바꿉니다.", reasoningNotesReset: "비워 두면 기본 문구를 사용합니다.",
    experimental: "실험적 기능", experimentalTitle: "실험적 기능", experimentalDesc: "아직 완성되지 않은 기능입니다. 켜면 채팅의 도구 메뉴에 나타납니다.", experimentalBrowser: "브라우저 도구", experimentalBrowserDesc: "모델과 사용자가 격리된 화면형 Chromium 세션을 공유합니다. 실시간 스플릿 뷰에서 클릭, 스크롤, 입력 및 사람만 가능한 단계를 처리할 수 있습니다.", experimentalHost: "호스트 컴퓨터 도구", experimentalHostDesc: "Superadmin만 파일, PowerShell/Bash, 백그라운드 프로그램, 임시 업로드 및 현재 화면을 제어할 수 있습니다. NeuralNetUI가 컨테이너 밖에서 실행될 때만 제공됩니다.", experimentalHelp: "기능이 꺼져 있으면 채팅 메뉴에서 도구가 숨겨지고, 클라이언트가 요청해도 서버가 거부합니다.",
    outputTokens: "출력 토큰", reasoningTokens: "reasoning", tokensPerSecond: "토큰/초", timeToFirstToken: "첫 토큰 도착 시간",
  },
} as const;
type CopySet = typeof translations.en | typeof translations.ko;
const copyFor = (locale: Locale): CopySet => translations[locale];

function attachmentAllowedForModel(model:ModelConfig|undefined,attachment:Pick<StoredAttachment,"mimeType">){
  if(!model)return false;
  if(attachment.mimeType.startsWith("image/"))return model.imageInput!==false&&(!model.imageGeneration||["image/png","image/jpeg","image/webp"].includes(attachment.mimeType));
  if(attachment.mimeType==="application/pdf")return model.imageGeneration!==true;
  return false;
}

function ModelImageBadge({model,c}:{model:ModelConfig;c:CopySet}){
  if(model.imageGeneration!==true)return null;
  const input=model.imageInput!==false,label=input?c.imageGenerationBadge:c.imageGenerationNoInputBadge;
  return <b className={`model-image-badge ${input?"":"no-input"}`} title={label} aria-label={label}>{input?<ImageIcon size={12}/>:<ImageOff size={12}/>}</b>;
}

function formatThoughtDuration(totalSeconds: number, locale: Locale) {
  const total = Math.max(1, Math.round(totalSeconds)); const minutes = Math.floor(total / 60); const seconds = total % 60;
  if (locale === "ko") return `${minutes ? `${minutes}분 ` : ""}${seconds}초 동안 생각함`;
  return `Thought for ${minutes ? `${minutes} min ` : ""}${seconds} sec`;
}

function formatCompactionDuration(totalSeconds: number, locale: Locale) {
  const total = Math.max(1, Math.round(totalSeconds)); const minutes = Math.floor(total / 60); const seconds = total % 60;
  if (locale === "ko") return `${minutes ? `${minutes}분 ` : ""}${seconds}초 동안 컨텍스트 압축함`;
  return `Compacted context for ${minutes ? `${minutes} min ` : ""}${seconds} sec`;
}

type TokenUsage = { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; totalTokens?: number };

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function readTokenUsage(payload: Record<string, unknown>): TokenUsage | undefined {
  const usage = payload.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const completionDetails = record.completion_tokens_details && typeof record.completion_tokens_details === "object" ? record.completion_tokens_details as Record<string, unknown> : undefined;
  const outputDetails = record.output_tokens_details && typeof record.output_tokens_details === "object" ? record.output_tokens_details as Record<string, unknown> : undefined;
  return {
    inputTokens: tokenCount(record.prompt_tokens ?? record.input_tokens),
    outputTokens: tokenCount(record.completion_tokens ?? record.output_tokens),
    reasoningTokens: tokenCount(completionDetails?.reasoning_tokens ?? outputDetails?.reasoning_tokens),
    totalTokens: tokenCount(record.total_tokens),
  };
}

function formatTokens(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US").format(value);
}

function formatLatency(seconds: number) {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
}

function normalizeConversationRevisions(record: Conversation): Conversation {
  const branches = record.branches.map((branch) => ({ ...branch, messages: branch.messages.map((message) => ({ ...message })) }));
  const groupByMessageId = new Map<string, string>();
  for (const branch of branches) {
    for (const message of branch.messages) {
      const knownGroup = message.revisionGroupId || groupByMessageId.get(message.id);
      if (knownGroup) { message.revisionGroupId = knownGroup; groupByMessageId.set(message.id, knownGroup); }
    }
    if (!branch.forkedFromMessageId || !branch.parentBranchId) continue;
    const parent = branches.find((candidate) => candidate.id === branch.parentBranchId); if (!parent) continue;
    const sourceIndex = parent.messages.findIndex((message) => message.id === branch.forkedFromMessageId); if (sourceIndex < 0) continue;
    const source = parent.messages[sourceIndex]; const revision = branch.messages[sourceIndex];
    if (!revision || revision.id === source.id || revision.role !== source.role) continue;
    const groupId = source.revisionGroupId || groupByMessageId.get(source.id) || source.id;
    revision.revisionGroupId = groupId; groupByMessageId.set(revision.id, groupId);
  }
  return { ...record, branches };
}

async function createThumbnail(file: File) {
  const bitmap = await createImageBitmap(file);
  const maxSide = 360;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas is unavailable.");
  context.fillStyle = "#111412"; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height); bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Thumbnail creation failed.")), "image/jpeg", .78));
  return { thumbnail: new File([blob], `${file.name}.thumbnail.jpg`, { type: "image/jpeg" }), width: Math.round(width / scale), height: Math.round(height / scale) };
}

export default function Home() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [config, setConfig] = useState<PublicConfig>(emptyConfig);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [aliasBaseSelections, setAliasBaseSelections] = useState<Record<string, string>>({});
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [histories, setHistories] = useState<ConversationSummary[]>([]);
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [serverStates, setServerStates] = useState<Record<string, ServerState>>({});
  const [serverStatesChecked, setServerStatesChecked] = useState(false);
  const [checkingModelServers, setCheckingModelServers] = useState(false);
  const [serverCheckTick, setServerCheckTick] = useState(0);
  // Model servers are checked only when the workspace loads, when the picker opens and when typing resumes
  // after a minute without keyboard input, so an idle tab never polls the servers' model listings.
  const bumpServerCheck = useCallback(() => setServerCheckTick((tick) => tick + 1), []);
  useKeyboardReturn(60_000, bumpServerCheck, Boolean(auth?.authenticated));
  useEffect(() => { if (modelMenuOpen) { setCheckingModelServers(true); bumpServerCheck(); } }, [modelMenuOpen, bumpServerCheck]);
  // Keyed on what the connections are rather than the config object, which is replaced on every refresh; the
  // placeholder config shown before the workspace loads (it has no account) is never checked.
  const serverCheckKey = config.account ? JSON.stringify(config.connections.map(({ id, driver, baseUrl, disabled }) => [id, driver, baseUrl, disabled === true])) : "[]";
  useEffect(() => {
    if (!auth?.authenticated || serverCheckKey === "[]") return;
    const controller = new AbortController();
    fetch("/api/models/status", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : undefined)
      .then((body: { statuses?: Record<string, ServerState> } | undefined) => { if (body) { setServerStates(body.statuses || {}); setServerStatesChecked(true); } })
      .catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) setCheckingModelServers(false); });
    return () => controller.abort();
  }, [serverCheckTick, auth?.authenticated, serverCheckKey]);
  const [unloadingModel, setUnloadingModel] = useState(false);
  const [modelControlNotice, setModelControlNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [applyingDefault, setApplyingDefault] = useState<"" | "model" | "reasoning">("");
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingWait, setPendingWait] = useState<{ messageId: string; phase: ChatWaitPhase; progress?: number } | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [storagePickerOpen, setStoragePickerOpen] = useState(false);
  const [chatManagerOpen, setChatManagerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ConversationSummary | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [temporaryMode, setTemporaryMode] = useState(false);
  const [hiddenActivityChats, setHiddenActivityChats] = useState<Record<string, boolean>>({});
  const activityHidden = Boolean(conversation?.id && hiddenActivityChats[conversation.id]);
  const [promoting, setPromoting] = useState(false);
  // Names the temporary chat that is still open, so the server keeps it and sweeps any other.
  const temporaryIdRef = useRef("");
  useEffect(() => { setCollapsed(localStorage.getItem("neural-sidebar-collapsed") === "true"); }, []);
  const appearance: AppearancePreferences = config.preferences.appearance || DEFAULT_APPEARANCE;
  const { mounted: modelMenuMounted, closing: modelMenuClosing } = usePopoverPresence(modelMenuOpen);
  const [accentPreview, setAccentPreview] = useState("");
  const signedIn = auth?.authenticated === true;
  useEffect(() => {
    const root = document.documentElement;
    const accent = accentPreview || (signedIn ? accentColorOf(appearance) : auth?.loginAccent || accentColorOf(appearance));
    for (const [name, value] of Object.entries(accentVariables(accent))) root.style.setProperty(name, value);
  }, [accentPreview, signedIn, auth?.loginAccent, appearance.accentPalette, appearance.accentColor]);
  const [sendReasoning, setSendReasoning] = useState(false);
  const [draftAttachments, setDraftAttachments] = useState<StoredAttachment[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [internetSearchEnabled, setInternetSearchEnabled] = useState(false);
  const [pageVisitEnabled, setPageVisitEnabled] = useState(false);
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [browserViewOpen, setBrowserViewOpen] = useState(false);
  const browserToolAvailable = config.experimental?.browserTool === true;
  useEffect(() => { if (!browserToolAvailable) { setBrowserEnabled(false); setBrowserViewOpen(false); } }, [browserToolAvailable]);
  const [hostComputerEnabled, setHostComputerEnabled] = useState(false);
  const hostComputerToolAvailable = config.account?.role === "superadmin" && config.hostComputerAvailable === true && config.experimental?.hostComputerTool === true;
  useEffect(() => { if (!hostComputerToolAvailable) setHostComputerEnabled(false); }, [hostComputerToolAvailable]);
  const [storageAccessEnabled, setStorageAccessEnabled] = useState(true);
  const [storageReadEnabled,setStorageReadEnabled]=useState(true);
  const [storageWriteEnabled,setStorageWriteEnabled]=useState(false);
  const [storageWriteMaxFiles,setStorageWriteMaxFiles]=useState(5);
  const [currentTimeEnabled, setCurrentTimeEnabled] = useState(true);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [multipleChoiceEnabled, setMultipleChoiceEnabled] = useState(true);
  const [artifactEnabled, setArtifactEnabled] = useState(true);
  const [mcpConnectionIds, setMcpConnectionIds] = useState<string[]>([]);
  const [mcpToolNames,setMcpToolNames]=useState<Record<string,string[]>>({});
  const pendingToolsRef = useRef<Partial<EnabledTools>>({});
  const toolSaveTimerRef = useRef<number | undefined>(undefined);
  /** Composer tool switches are account preferences: apply locally, then save the batched change. */
  const persistedTool = (key: Exclude<keyof EnabledTools,"mcpConnectionIds"|"mcpToolNames"|"storageWriteMaxFiles">, set: (value: boolean) => void) => (value: boolean) => {
    set(value);
    pendingToolsRef.current = { ...pendingToolsRef.current, [key]: value };
    window.clearTimeout(toolSaveTimerRef.current);
    toolSaveTimerRef.current = window.setTimeout(() => {
      const patch = pendingToolsRef.current; pendingToolsRef.current = {};
      void fetch("/api/preferences/tools", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(() => undefined);
    }, 250);
  };
  const persistedStorageWriteLimit=(value:number)=>{
    const next=Math.max(1,Math.min(20,Math.floor(value)||1));setStorageWriteMaxFiles(next);
    pendingToolsRef.current={...pendingToolsRef.current,storageWriteMaxFiles:next};window.clearTimeout(toolSaveTimerRef.current);
    toolSaveTimerRef.current=window.setTimeout(()=>{const patch=pendingToolsRef.current;pendingToolsRef.current={};void fetch("/api/preferences/tools",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)}).catch(()=>undefined);},250);
  };
  const persistedMcpConnections = (ids: string[]) => {
    const next = [...new Set(ids)].filter(id => config.mcpConnections.some(connection => connection.id === id && connection.enabled));
    setMcpConnectionIds(next);
    pendingToolsRef.current = { ...pendingToolsRef.current, mcpConnectionIds: next };
    window.clearTimeout(toolSaveTimerRef.current);
    toolSaveTimerRef.current = window.setTimeout(() => { const patch = pendingToolsRef.current; pendingToolsRef.current = {}; void fetch("/api/preferences/tools", { method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch) }).catch(()=>undefined); },250);
  };
  const [renderedMessageCount, setRenderedMessageCount] = useState(60);
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const abandonRef = useRef(false);
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);
  const autoFollowThreadRef = useRef(true);
  const [threadAutoFollow, setThreadAutoFollow] = useState(true);
  const selectedModelIdRef = useRef("");
  const pendingConversationIdRef = useRef("");
  const handledLocationCallsRef = useRef(new Set<string>());

  function replaceQueue(next: QueuedPrompt[]) {
    queuedPromptsRef.current = next;
    setQueuedPrompts(next);
  }

  function removeQueuedPrompt(id: string, deleteAttachments = true) {
    const queued = queuedPromptsRef.current.find((item) => item.id === id);
    replaceQueue(queuedPromptsRef.current.filter((item) => item.id !== id));
    if (deleteAttachments) queued?.attachments.filter(attachment=>!attachment.fromStorage).forEach((attachment) => fetch(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined));
  }

  function clearQueuedPrompts() {
    const queued = queuedPromptsRef.current;
    replaceQueue([]);
    queued.forEach((prompt) => prompt.attachments.filter(attachment=>!attachment.fromStorage).forEach((attachment) => fetch(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined)));
  }

  // A focused number field would otherwise step its value while the wheel scrolls the page past it.
  useEffect(() => {
    const guard = (event: globalThis.WheelEvent) => {
      const field = document.activeElement;
      if (field instanceof HTMLInputElement && field.type === "number" && event.target === field) field.blur();
    };
    document.addEventListener("wheel", guard, { passive: true, capture: true });
    return () => document.removeEventListener("wheel", guard, { capture: true });
  }, []);

  useEffect(() => { fetch("/api/auth/status").then((response) => response.json()).then(setAuth).catch(() => setAuth({ setupRequired: false, authenticated: false, user: null })); }, []);

  useEffect(() => {
    if (!auth?.authenticated) return;
    const openedId = decodeURIComponent(window.location.pathname).match(/^\/chat\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
    Promise.all([fetch("/api/config").then((r) => r.json()), fetch(`/api/conversations${openedId ? `?keepTemporary=${encodeURIComponent(openedId)}` : ""}`).then((r) => r.json())])
      .then(async ([next, stored]: [PublicConfig, { conversations: ConversationSummary[] }]) => {
        setConfig(next); setSendReasoning(next.preferences.sendReasoningToModel);
        const tools = { ...DEFAULT_ENABLED_TOOLS, ...next.preferences.enabledTools };
        setInternetSearchEnabled(tools.internetSearch); setPageVisitEnabled(tools.pageVisit); setBrowserEnabled(tools.browser); setHostComputerEnabled(tools.hostComputer);
        setStorageAccessEnabled(tools.storageAccess);setStorageReadEnabled(tools.storageRead);setStorageWriteEnabled(tools.storageWrite);setStorageWriteMaxFiles(tools.storageWriteMaxFiles); setCurrentTimeEnabled(tools.currentTime); setLocationEnabled(tools.location); setMultipleChoiceEnabled(tools.multipleChoice);setArtifactEnabled(tools.artifact); setMcpConnectionIds(next.mcpEntitlement.enabled?tools.mcpConnectionIds.filter(id=>next.mcpConnections.some(connection=>connection.id===id&&connection.enabled)):[]);setMcpToolNames({});
        setHistories(stored.conversations || []);
        const visible = next.models.filter((model) => model.visible !== false&&(next.planModelIds.includes(model.id)||next.planModelIds.includes(model.sourceModel)));
        const first = visible.find((model) => model.id === next.preferences.defaultModelId) || visible[0];
        const firstPreset = first?.reasoningPresets.find((preset) => preset.id === next.preferences.defaultReasoningPresetId) || first?.reasoningPresets[0];
        if (first) { selectedModelIdRef.current = first.id; setSelectedModelId(first.id); setSelectedPresetId(firstPreset?.id || ""); }
        const routeId = decodeURIComponent(window.location.pathname).match(/^\/chat\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
        if (routeId) await loadConversation(routeId, false, true);
        else newChat(true);
      }).catch(() => setError("설정 또는 대화 기록을 불러오지 못했습니다."));
  }, [auth?.authenticated]);

  useEffect(() => {
    if (!auth?.authenticated) return;
    const navigateHistory = () => {
      const routeId = decodeURIComponent(window.location.pathname).match(/^\/chat\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
      if (routeId) void loadConversation(routeId, false, true);
      else newChat(true);
    };
    window.addEventListener("popstate", navigateHistory);
    return () => window.removeEventListener("popstate", navigateHistory);
  }, [auth?.authenticated]);

  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let restingHeight = Math.max(window.innerHeight, viewport?.height || 0);
    let frame = 0;
    const updateViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = viewport?.height || window.innerHeight;
        const top = viewport?.offsetTop || 0;
        const composerFocused = document.activeElement instanceof HTMLTextAreaElement && document.activeElement.closest(".composer");
        if (!composerFocused) restingHeight = Math.max(restingHeight, window.innerHeight, height + top);
        const keyboardInset = Math.max(0, restingHeight - height - top);
        root.style.setProperty("--app-height", `${Math.round(height)}px`);
        root.style.setProperty("--viewport-top", `${Math.round(top)}px`);
        root.style.setProperty("--keyboard-inset", `${Math.round(keyboardInset)}px`);
        root.classList.toggle("keyboard-open", Boolean(composerFocused) && keyboardInset > 80);
      });
    };
    const onFocusChange = () => window.setTimeout(updateViewport, 40);
    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    document.addEventListener("focusin", onFocusChange);
    document.addEventListener("focusout", onFocusChange);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      document.removeEventListener("focusin", onFocusChange);
      document.removeEventListener("focusout", onFocusChange);
      root.classList.remove("keyboard-open");
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--viewport-top");
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);

  useEffect(() => {
    function closeSelectors(event: globalThis.PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".model-switcher")) setModelMenuOpen(false);
      if (!target?.closest(".preset-switcher")) setPresetMenuOpen(false);
    }
    function closeSelectorsOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") { setModelMenuOpen(false); setPresetMenuOpen(false); }
    }
    document.addEventListener("pointerdown", closeSelectors);
    document.addEventListener("keydown", closeSelectorsOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeSelectors);
      document.removeEventListener("keydown", closeSelectorsOnEscape);
    };
  }, []);

  useEffect(() => {
    if (!autoFollowThreadRef.current) return;
    const frame = requestAnimationFrame(() => {
      const element = threadRef.current;
      if (element && autoFollowThreadRef.current) element.scrollTo({ top: element.scrollHeight });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);
  const locale = config.preferences.language || "en";
  const c = copyFor(locale);
  // The document was served as Korean whatever the person had chosen, so an English interface was
  // announced in a Korean voice. The chosen language owns the document's own language too.
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const { dialog: messageDialog, confirm: askConfirm, choose, notify } = useMessageDialog(locale === "ko");
  const planAllowsModel=(model:ModelConfig)=>config.planModelIds.includes(model.id)||config.planModelIds.includes(model.sourceModel);
  const configuredVisibleModels = config.models.filter((model) => model.visible !== false && planAllowsModel(model));
  const connectedBaseModels = connectedModels(configuredVisibleModels.filter(model => !model.isAlias), config.connections, serverStates);
  // Alias definitions keep the author's recommendation; only this runtime copy follows the account/chat choice.
  const visibleModels = configuredVisibleModels.map(model => {
    if (!model.isAlias) return model;
    const baseId = aliasBaseSelections[model.id] || config.preferences.aliasBaseModelIds?.[model.id];
    const base = connectedBaseModels.find(candidate => candidate.id === baseId) || aliasBaseModel(model, configuredVisibleModels);
    return base ? aliasWithBaseModel(model, base) : model;
  });
  // Disconnected and disabled servers leave the model picker entirely. Servers answering with an
  // API error remain selectable because the host is still reachable and may recover per request.
  const pickerModels = connectedModels(visibleModels, config.connections, serverStates);
  const onlineModels = pickerModels;
  const serversOffline = serverStatesChecked && config.connections.length > 0 && !pickerModels.length;
  const selectedModel = pickerModels.find((model) => model.id === selectedModelId) || pickerModels[0];
  // A selection whose server is offline or switched off moves to the default model, or else the first online one.
  const replacementModel = selectedModelId ? onlineReplacement(selectedModelId, onlineModels, config.preferences.defaultModelId) : undefined;
  useEffect(() => {
    if (!replacementModel) return;
    selectedModelIdRef.current = replacementModel.id; setSelectedModelId(replacementModel.id);
    setSelectedPresetId((current) => replacementModel.reasoningPresets.some((preset) => preset.id === current) ? current : replacementModel.reasoningPresets.find((preset) => preset.id === config.preferences.defaultReasoningPresetId)?.id || replacementModel.reasoningPresets[0]?.id || "");
  }, [replacementModel, config.preferences.defaultReasoningPresetId]);
  const selectedPreset = selectedModel?.reasoningPresets.find((preset) => preset.id === selectedPresetId) || selectedModel?.reasoningPresets[0];
  const selectedAliasDefinition = selectedModel?.isAlias ? configuredVisibleModels.find(model => model.id === selectedModel.id) : undefined;
  const selectedAliasBase = selectedAliasDefinition ? aliasBaseModel(selectedAliasDefinition, connectedBaseModels, aliasBaseSelections[selectedAliasDefinition.id] || config.preferences.aliasBaseModelIds?.[selectedAliasDefinition.id]) : undefined;
  const isAdmin = config.account?.role === "admin" || config.account?.role === "superadmin";
  const showModelWeights = config.showModelWeights === true;
  const canManageInference = isAdmin;
  const activeBranch = conversation?.branches.find((branch) => branch.id === conversation.activeBranchId);
  const pendingChoice = pendingMultipleChoiceEvent(messages);
  const pendingHostApproval = useMemo(() => {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const events = messages[messageIndex].toolEvents || [];
      for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
        const event = events[eventIndex];
        if ((event.name === "host_computer" || event.name.startsWith("mcp_")) && event.status === "waiting") return event;
      }
    }
    return undefined;
  }, [messages]);
  const pendingBrowserHandoff = useMemo(() => {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const events = messages[messageIndex].toolEvents || [];
      for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
        const event = events[eventIndex];
        const args = event.arguments && typeof event.arguments === "object" ? event.arguments as Record<string, unknown> : {};
        if (event.name === "browser" && event.status === "waiting" && String(args.action || "").toLowerCase() === "request_user") return event;
      }
    }
    return undefined;
  }, [messages]);
  useEffect(() => { if (!browserEnabled) setBrowserViewOpen(false); }, [browserEnabled]);
  useEffect(() => { if (pendingBrowserHandoff) setBrowserViewOpen(true); }, [pendingBrowserHandoff?.id]);
  const contextBreakdown = useMemo(() => contextUsage(messages, sendReasoning, draft, selectedModel?.systemPrompt || "", draftAttachments.length), [messages, sendReasoning, draft, selectedModel?.systemPrompt, draftAttachments.length]);
  const messageRevisions = useMemo(() => {
    const groups = new Map<string, Map<string, MessageRevision>>();
    for (const branch of conversation?.branches || []) {
      for (const message of branch.messages) {
        const groupId = message.revisionGroupId || message.id;
        const group = groups.get(groupId) || new Map<string, MessageRevision>();
        const existing = group.get(message.id);
        if (!existing || branch.updatedAt.localeCompare(existing.updatedAt) > 0) group.set(message.id, { messageId: message.id, branchId: branch.id, updatedAt: branch.updatedAt });
        groups.set(groupId, group);
      }
    }
    return new Map([...groups].map(([groupId, revisions]) => [groupId, [...revisions.values()]]));
  }, [conversation]);
  const userFirstName = config.profile.name.trim().split(/\s+/)[0];
  const temporaryActive = temporaryMode || conversation?.temporary === true;
  const [greeting, setGreeting] = useState("");
  const [mainVisit, setMainVisit] = useState(0);
  const lastGreetings = useRef(new Map<string, string>());
  const mainVisible = messages.length === 0;
  useEffect(() => {
    if (!config.account || !mainVisible || temporaryActive) return;
    const at = new Date();
    const key = `neural-greeting:${config.account.id}:${locale}:${timeBandFor(at.getHours())}`;
    let previous = lastGreetings.current.get(key);
    try { previous = sessionStorage.getItem(key) || previous; } catch { /* Storage can be disabled. */ }
    const next = greetingFor(locale, userFirstName, at, { overrides: appearance.greetings, previous });
    lastGreetings.current.set(key, next);
    try { sessionStorage.setItem(key, next); } catch { /* In-memory rotation still works. */ }
    setGreeting(next);
  }, [config.account?.id, userFirstName, locale, mainVisible, temporaryActive, mainVisit, appearance.greetings]);

  async function refreshHistories() {
    const keep = temporaryIdRef.current ? `?keepTemporary=${encodeURIComponent(temporaryIdRef.current)}` : "";
    const result = await fetch(`/api/conversations${keep}`).then((r) => r.json());
    setHistories(result.conversations || []);
  }

  async function persist(next: Conversation, create = false) {
    try {
      const saved = await saveConversationRequest(next, create);
      temporaryIdRef.current = saved.temporary ? saved.id : "";
      setConversation(saved);
      if (create) navigateToChat(saved.id, true);
      await refreshHistories().catch(() => undefined);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save conversation.");
      const previousBranch = conversation?.branches.find(branch => branch.id === conversation.activeBranchId);
      setMessages(previousBranch?.messages || []);
      return false;
    }
  }

  function chooseModel(model: ModelConfig) {
    selectedModelIdRef.current = model.id; setSelectedModelId(model.id); setSelectedPresetId(model.reasoningPresets[0]?.id || ""); setModelMenuOpen(false);
  }

  /** Applies one choice to every account. Administrators only; the server enforces that too. */
  async function applyDefaultToEveryone(kind: "model" | "reasoning") {
    const id = kind === "model" ? selectedModel?.id : selectedPreset?.id;
    if (!id || applyingDefault) return;
    setApplyingDefault(kind);
    try {
      const response = await fetch("/api/config/defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setConfig(body);
      // The reasoning picker has no notice line; there the button turning into the active state is the receipt.
      if (kind === "model") setModelControlNotice({ message: c.appliedToEveryone, error: false });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to apply the default.");
    } finally { setApplyingDefault(""); }
  }

  async function setDefaultSelection(kind: "model" | "reasoning") {
    if (kind === "model" && !selectedModel) return;
    if (kind === "reasoning" && !selectedPreset) return;
    const preferences = {
      ...config.preferences,
      ...(kind === "model" ? { defaultModelId: selectedModel?.id } : { defaultReasoningPresetId: selectedPreset?.id }),
    };
    const next = { ...config, preferences };
    setConfig(next);
    try {
      const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setConfig(body);
    } catch (caught) {
      setConfig(config);
      setError(caught instanceof Error ? caught.message : "Unable to save the default selection.");
    }
  }

  function chooseAliasBase(base: ModelConfig) {
    if (!selectedAliasDefinition) return;
    setAliasBaseSelections(current => ({ ...current, [selectedAliasDefinition.id]: base.id }));
    const runtime = aliasWithBaseModel(selectedAliasDefinition, base);
    setSelectedPresetId(current => runtime.reasoningPresets.some(preset => preset.id === current)
      ? current
      : runtime.reasoningPresets.find(preset => preset.id === config.preferences.defaultReasoningPresetId)?.id || runtime.reasoningPresets[0]?.id || "");
  }

  async function setDefaultAliasBase() {
    if (!selectedAliasDefinition || !selectedAliasBase) return;
    const previous = config;
    const aliasBaseModelIds = { ...(config.preferences.aliasBaseModelIds || {}), [selectedAliasDefinition.id]: selectedAliasBase.id };
    setConfig(current => ({ ...current, preferences: { ...current.preferences, aliasBaseModelIds } }));
    try {
      const response = await fetch("/api/preferences/alias-bases", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aliasId: selectedAliasDefinition.id, baseModelId: selectedAliasBase.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setConfig(body);
    } catch (caught) {
      setConfig(previous);
      setError(caught instanceof Error ? caught.message : "Unable to save the alias base model.");
    }
  }

  async function unloadModel() {
    if (unloadingModel) return;
    setUnloadingModel(true); setModelControlNotice(null);
    try {
      const response = await fetch("/api/inference/unload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: selectedModel?.id, aliasBaseModelId: selectedAliasBase?.id }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || c.modelUnloadFailed);
      setModelControlNotice({ message: c.modelUnloaded, error: false });
    } catch (caught) {
      setModelControlNotice({ message: caught instanceof Error ? caught.message : c.modelUnloadFailed, error: true });
    } finally {
      setUnloadingModel(false);
    }
  }

  /** Promotes the open temporary chat, letting the harness title it from the first exchange. */
  async function promoteTemporaryChat() {
    const id = conversation?.id;
    if (!id || conversation?.temporary !== true) { temporaryIdRef.current = ""; setTemporaryMode(false); return; }
    setPromoting(true); setError("");
    try {
      const response = await fetch(`/api/conversations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promote: true }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || c.chatSaveFailed);
      temporaryIdRef.current = ""; setTemporaryMode(false);
      setConversation((current) => current && current.id === id ? { ...current, temporary: false, ...(body.title ? { title: body.title } : {}) } : current);
      await refreshHistories();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : c.chatSaveFailed);
    } finally { setPromoting(false); }
  }

  function handleThreadScroll() {
    const element = threadRef.current;
    if (element) {
      const following = isNearScrollBottom(element);
      autoFollowThreadRef.current = following;
      setThreadAutoFollow(following);
    }
  }

  function resumeThreadAutoFollow() {
    autoFollowThreadRef.current = true;
    setThreadAutoFollow(true);
    const element = threadRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }

  function navigateToChat(id: string, replace = false) {
    const method = replace ? "replaceState" : "pushState";
    window.history[method]({}, "", `/chat/${encodeURIComponent(id)}`);
  }

  function newChat(replaceUrl = false, temporary = false) {
    setMainVisit(value => value + 1);
    abandonRef.current = true; abortRef.current?.abort();
    clearQueuedPrompts();
    draftAttachments.filter(attachment=>!attachment.fromStorage).forEach((attachment) => fetch(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined));
    const abandoned = temporaryIdRef.current;
    pendingConversationIdRef.current = uid("conversation");
    window.history[replaceUrl ? "replaceState" : "pushState"]({}, "", "/");
    autoFollowThreadRef.current = true;
    setThreadAutoFollow(true);
    temporaryIdRef.current = ""; setTemporaryMode(temporary); setPromoting(false);
    setDraftAttachments([]); setRenderedMessageCount(60); setIsGenerating(false); setPendingWait(null); setConversation(null); setMessages([]); setMcpToolNames({}); setDraft(""); setError(""); setMobileOpen(false);
    // Leaving a temporary chat discards it; the refresh tells the server it is no longer open.
    if (abandoned) void refreshHistories();
  }

  function resetWorkspaceForAuthChange() {
    abandonRef.current = true; abortRef.current?.abort(); clearQueuedPrompts();
    setConfig(structuredClone(emptyConfig)); selectedModelIdRef.current = ""; setSelectedModelId(""); setSelectedPresetId("");
    setConversation(null); setMessages([]); setHistories([]); setDraft(""); setDraftAttachments([]); setIsGenerating(false); setPendingWait(null); setError("");
    // The settings preview holds the departing account's accent; drop it so the sign-in screen shows its own.
    setSearching(false); setStorageOpen(false); setStoragePickerOpen(false); setChatManagerOpen(false); setExportOpen(false); setMobileOpen(false); setAccentPreview("");
  }

  async function loadConversation(id: string, navigate = true, allowNew = false, selectedBranchId?: string) {
    const abandoned = temporaryIdRef.current;
    try {
      abandonRef.current = true; abortRef.current?.abort(); clearQueuedPrompts();
      const response = await fetch(`/api/conversations/${id}`); const body = await response.json();
      if (!response.ok) {
        if (response.status === 404 && allowNew) { newChat(true); return; }
        throw new Error(body.error);
      }
      const next = normalizeConversationRevisions(body as Conversation);
      const branch = next.branches.find((item: ChatBranch) => item.id === next.activeBranchId) || next.branches[0];
      autoFollowThreadRef.current = true;
      setThreadAutoFollow(true);
      if (selectedBranchId && next.branches.some(item => item.id === selectedBranchId)) { next.activeBranchId = selectedBranchId; await saveConversationRequest(next, false); }
      temporaryIdRef.current = next.temporary ? next.id : ""; setTemporaryMode(next.temporary === true); setPromoting(false);
      setConversation(next); setMessages((selectedBranchId ? next.branches.find(item => item.id === selectedBranchId) : branch)?.messages || []);if(conversation?.id!==next.id)setMcpToolNames({}); selectedModelIdRef.current = next.modelId; setSelectedModelId(next.modelId);
      setRenderedMessageCount(60);
      setSelectedPresetId(next.reasoningPresetId || ""); setMobileOpen(false); setError("");
      pendingConversationIdRef.current = next.id; if (navigate) navigateToChat(next.id);
      if (abandoned && abandoned !== next.id) void refreshHistories();
      if (!selectedBranchId || selectedBranchId === branch?.id) void watchChatJob(next, branch?.id || next.activeBranchId, true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "대화를 불러오지 못했습니다."); }
  }

  // The copy is a new chat in every identifier the database keys on, so both chats can be
  // opened, branched and deleted independently of each other.
  async function duplicateHistory(id: string, title: string) {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const response = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error(c.duplicateChatFailed);
      const source: Conversation = await response.json();
      const copy = duplicateConversation(source, { id: uid("conversation"), title, stamp: now(), newId: (kind) => uid(kind) });
      const created = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(copy) });
      if (!created.ok) { const body = await created.json().catch(() => ({})); throw new Error(body.error || c.duplicateChatFailed); }
      await refreshHistories();
      setRenameTarget(null);
      await notify({ tone: "success", title: c.duplicateChat, message: c.duplicatedChat, detail: copy.title });
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.duplicateChatFailed); setRenameTarget(null); }
    finally { setDuplicating(false); }
  }

  async function deleteHistory(id: string) {
    if (!await askConfirm({ tone: "danger", title: c.deleteChat, message: c.confirmDeleteChat, confirmLabel: c.confirmDelete })) return;
    try {
      if (id === conversation?.id) { await fetch(`/api/chat/${id}`, { method: "DELETE" }).catch(() => undefined); newChat(); }
      const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || c.deleteChat); }
      setHistories((current) => current.filter((item) => item.id !== id));
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.deleteChat); }
  }

  async function deleteAllHistories() {
    if (!histories.length) return;
    if (!await askConfirm({ tone: "danger", title: c.deleteAllChats, message: c.confirmDeleteAllChats, detail: c.irreversibleAction, confirmLabel: c.confirmDelete })) return;
    try {
      if (conversation?.id) await fetch(`/api/chat/${conversation.id}`, { method: "DELETE" }).catch(() => undefined);
      newChat();
      const response = await fetch("/api/conversations", { method: "DELETE" });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || c.deleteAllChats); }
      setHistories([]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.deleteAllChats); }
  }

  async function managedChatsChanged() {
    const activeId=conversation?.id;const response=await fetch("/api/conversations",{cache:"no-store"});const body=await response.json().catch(()=>({}));if(!response.ok)return;
    const next:ConversationSummary[]=body.conversations||[];setHistories(next);
    if(activeId&&!next.some(item=>item.id===activeId)){await fetch(`/api/chat/${activeId}`,{method:"DELETE"}).catch(()=>undefined);newChat();}
  }

  async function switchBranch(branchId: string) {
    if (!conversation) return;
    const branch = conversation.branches.find((item) => item.id === branchId); if (!branch) return;
    const next = { ...conversation, activeBranchId: branchId, updatedAt: now() };
    setMessages(branch.messages); setRenderedMessageCount(60); await persist(next);
  }

  function createConversation(firstMessage: StoredMessage, model: ModelConfig, preset?: ReasoningPreset): Conversation {
    const stamp = now(); const branchId = uid("branch");
    return {
      id: pendingConversationIdRef.current || uid("conversation"), title: firstMessage.content.trim() ? titleFrom(firstMessage.content) : c.imageChat, modelId: model.id,
      reasoningPresetId: preset?.id, activeBranchId: branchId, temporary: temporaryMode, createdAt: stamp, updatedAt: stamp,
      branches: [{ id: branchId, name: "Main", messages: [firstMessage], createdAt: stamp, updatedAt: stamp }],
    };
  }

  async function refreshModelContextWindow(modelId: string, aliasBaseModelId?: string) {
    try {
      const response = await fetch("/api/models/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, aliasBaseModelId }),
      });
      if (!response.ok) return;
      const body = await response.json() as { modelId?: string; apiContextWindowTokens?: number | null };
      if (!body.modelId) return;
      setConfig((current) => ({
        ...current,
        models: current.models.map((model) => model.id === body.modelId
          ? { ...model, apiContextWindowTokens: typeof body.apiContextWindowTokens === "number" ? body.apiContextWindowTokens : undefined }
          : model),
      }));
    } catch { /* context refresh must not interrupt a completed response */ }
  }

  async function submitToolInput(toolCallId: string, value: unknown) {
    if (!conversation?.id && !pendingConversationIdRef.current) return false;
    const conversationId = conversation?.id || pendingConversationIdRef.current;
    try {
      const response = await fetch(`/api/chat/${conversationId}/input`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toolCallId, value }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); setError(body.error || "도구 입력을 전달하지 못했습니다."); return false; }
      return true;
    } catch {
      setError("도구 입력을 전달하지 못했습니다."); return false;
    }
  }

  function provideBrowserLocation(conversationId: string, toolCallId: string) {
    if (handledLocationCallsRef.current.has(toolCallId)) return;
    handledLocationCallsRef.current.add(toolCallId);
    const send = (value: unknown) => fetch(`/api/chat/${conversationId}/input`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toolCallId, value }) }).catch(() => undefined);
    if (!navigator.geolocation) { void send({ error: "Geolocation is not supported by this browser." }); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => void send({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
      (failure) => void send({ error: failure.message || "Location permission was denied." }),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 15_000 },
    );
  }

  async function watchChatJob(working: Conversation, branchId: string, silent404 = false): Promise<Conversation | null> {
    abandonRef.current = false;
    const controller = new AbortController(); abortRef.current = controller;
    const branch = working.branches.find((item) => item.id === branchId) || working.branches[0];
    let baseMessages = branch?.messages || []; let terminal: ChatJobSnapshot | undefined;
    try {
      while (!controller.signal.aborted && !abandonRef.current && !terminal) {
        try {
          const response = await fetch(`/api/chat/${working.id}`, { signal: controller.signal, cache: "no-store" });
          if (response.status === 404) {
            const savedResponse = await fetch(`/api/conversations/${working.id}`, { signal: controller.signal, cache: "no-store" });
            if (!savedResponse.ok) { if (!silent404) setError("실행 중인 채팅 작업을 찾지 못했습니다."); return null; }
            const recovered = normalizeConversationRevisions(await savedResponse.json() as Conversation);
            setConversation(recovered); setMessages(recovered.branches.find(item => item.id === branchId)?.messages || []);
            return recovered;
          }
          if (!response.ok || !response.body) throw new Error("채팅 작업에 다시 연결하지 못했습니다.");
          setIsGenerating(true);
          const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read(); if (done) break;
            buffer += decoder.decode(value, { stream: true }); const records = buffer.split(/\r?\n\r?\n/); buffer = records.pop() || "";
            for (const record of records) for (const line of record.split(/\r?\n/)) {
              if (!line.startsWith("data:")) continue; const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue;
              const next = JSON.parse(data) as ChatJobSnapshot;
              baseMessages = [...baseMessages.filter((message) => message.id !== next.message.id), next.message];
              setMessages(baseMessages);
              setPendingWait(next.waitPhase ? { messageId: next.message.id, phase: next.waitPhase, progress: next.waitProgress } : null);
              setConversation((current) => current ? { ...current, branches: current.branches.map((item) => item.id === next.branchId ? { ...item, messages: baseMessages } : item) } : current);
              const waitingLocation = next.message.toolEvents?.find((event) => event.name === "get_current_location" && event.status === "waiting");
              if (waitingLocation) provideBrowserLocation(next.conversationId, waitingLocation.id);
              if (["completed", "stopped", "error"].includes(next.status)) { terminal = next; break; }
            }
            if (terminal) break;
          }
        } catch (caught) {
          if (controller.signal.aborted || abandonRef.current) return null;
          await new Promise((resolve) => window.setTimeout(resolve, 900));
        }
      }
      if (!terminal) return null;
      window.dispatchEvent(new Event(USAGE_REFRESH_EVENT));
      if (terminal.error) setError(terminal.error);
      const response = await fetch(`/api/conversations/${working.id}`, { cache: "no-store" });
      if (!response.ok) return working;
      const latest = normalizeConversationRevisions(await response.json() as Conversation);
      const latestBranch = latest.branches.find((item) => item.id === branchId) || latest.branches[0];
      setConversation(latest); setMessages(latestBranch?.messages || []); await refreshHistories(); return latest;
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setIsGenerating(false); setPendingWait(null); }
    }
  }

  async function runCompletion(working: Conversation, branchId: string, requestMessages: StoredMessage[], create = false, revisionGroupId?: string, options?: CompletionOptions): Promise<Conversation | null> {
    const requestedModelId = options?.modelId || selectedModelIdRef.current;
    const liveModel = visibleModels.find((model) => model.id === requestedModelId);
    const liveAliasDefinition = liveModel?.isAlias ? configuredVisibleModels.find(model => model.id === liveModel.id) : undefined;
    const runtimeAliasBaseModelId = options?.aliasBaseModelId || (liveAliasDefinition ? aliasBaseModel(liveAliasDefinition, connectedBaseModels, aliasBaseSelections[liveAliasDefinition.id] || config.preferences.aliasBaseModelIds?.[liveAliasDefinition.id])?.id : undefined);
    if (liveModel) {
      const requestedPresetId = options?.reasoningPresetId || selectedPresetId;
      const livePreset = liveModel.reasoningPresets.find((preset) => preset.id === requestedPresetId) || liveModel.reasoningPresets[0];
      working = { ...working, modelId: liveModel.id, reasoningPresetId: livePreset?.id };
    }
    const placeholder: StoredMessage = { id: uid("assistant"), revisionGroupId, role: "assistant", content: "", reasoning: "", createdAt: now() };
    setMessages([...requestMessages, placeholder]); setPendingWait({ messageId: placeholder.id, phase: "preparing-response" }); setIsGenerating(true); setError("");
    try {
      if (!await persist(working, create)) {
        const lastUser = requestMessages.at(-1);
        if (lastUser?.role === "user") {
          setDraft(current => current || lastUser.content);
          setDraftAttachments(current => current.length ? current : lastUser.attachments || []);
        }
        setIsGenerating(false); setPendingWait(null); return null;
      }
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: working.id, branchId, assistantMessageId: placeholder.id, revisionGroupId, modelId: working.modelId, aliasBaseModelId: runtimeAliasBaseModelId, reasoningPresetId: working.reasoningPresetId, sendReasoning: options?.sendReasoning ?? sendReasoning,
          tools: options?.tools || { internetSearch: internetSearchEnabled, pageVisit: pageVisitEnabled, browser: browserToolAvailable && browserEnabled, storageAccess:storageAccessEnabled, storageRead:storageReadEnabled, storageWrite:storageWriteEnabled, storageWriteMaxFiles, hostComputer: hostComputerToolAvailable && hostComputerEnabled, currentTime: currentTimeEnabled, location: locationEnabled, multipleChoice: multipleChoiceEnabled,artifact:artifactEnabled, mcpConnectionIds,mcpToolNames },
          clientContext: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language, language: config.preferences.language },
          messages: requestMessages.map((message) => ({ role: message.role, content: message.content, reasoning_content: message.reasoning, toolEvents: message.toolEvents, attachments: message.attachments?.map(({ id }) => ({ id })) })) }),
      });
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error || `요청에 실패했습니다 (${response.status})`); }
      const completed = await watchChatJob(working, branchId); if (completed) void refreshModelContextWindow(working.modelId, runtimeAliasBaseModelId); return completed;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "채팅 요청에 실패했습니다."); setMessages(requestMessages); setIsGenerating(false); setPendingWait(null); return null;
    }
  }

  async function runCompletionAndDrain(working: Conversation, branchId: string, requestMessages: StoredMessage[], create = false, revisionGroupId?: string, options?: CompletionOptions) {
    let latest = await runCompletion(working, branchId, requestMessages, create, revisionGroupId, options);
    while (latest && !abandonRef.current && queuedPromptsRef.current.length) {
      const queued = queuedPromptsRef.current[0];
      removeQueuedPrompt(queued.id, false);
      const model = visibleModels.find((item) => item.id === queued.modelId) || visibleModels[0];
      if (!model) {
        queued.attachments.filter(attachment=>!attachment.fromStorage).forEach((attachment) => fetch(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined));
        setError(c.noModel);
        continue;
      }
      const preset = model.reasoningPresets.find((item) => item.id === queued.reasoningPresetId) || model.reasoningPresets[0];
      const branch = latest.branches.find((item) => item.id === latest?.activeBranchId) || latest.branches[0];
      if (!branch) break;
      const stamp = now();
      const userMessage: StoredMessage = { id: queued.id, role: "user", content: queued.content, attachments: queued.attachments, createdAt: stamp };
      const nextMessages = [...branch.messages, userMessage];
      const next: Conversation = { ...latest, modelId: model.id, reasoningPresetId: preset?.id, updatedAt: stamp,
        branches: latest.branches.map((item) => item.id === branch.id ? { ...item, messages: nextMessages, updatedAt: stamp } : item) };
      latest = await runCompletion(next, branch.id, nextMessages, false, undefined, { ...queued, modelId: model.id, reasoningPresetId: preset?.id });
    }
    return latest;
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const requestModel = visibleModels.find((model) => model.id === selectedModelIdRef.current) || selectedModel;
    const requestPreset = requestModel?.reasoningPresets.find((preset) => preset.id === selectedPresetId) || requestModel?.reasoningPresets[0];
    const text = draft.trim();
    const hasMessage = Boolean(text || draftAttachments.length);
    if(requestModel&&draftAttachments.some(attachment=>!attachmentAllowedForModel(requestModel,attachment))){setError(c.modelAttachmentUnsupported);return;}
    if (isGenerating) {
      if (!hasMessage || pendingChoice) {
        const id = conversation?.id || pendingConversationIdRef.current;
        if (id) await fetch(`/api/chat/${id}`, { method: "DELETE" }).catch(() => undefined);
        return;
      }
      if (!requestModel) { setError(c.noModel); return; }
      if (uploadingImages) return;
      const queued: QueuedPrompt = { id: uid("user"), content: text, attachments: draftAttachments, modelId: requestModel.id, aliasBaseModelId: requestModel.isAlias ? selectedAliasBase?.id : undefined, reasoningPresetId: requestPreset?.id, sendReasoning,
        tools: { internetSearch: internetSearchEnabled, pageVisit: pageVisitEnabled, browser: browserEnabled, storageAccess:storageAccessEnabled, storageRead:storageReadEnabled, storageWrite:storageWriteEnabled, storageWriteMaxFiles, hostComputer: hostComputerToolAvailable && hostComputerEnabled, currentTime: currentTimeEnabled, location: locationEnabled, multipleChoice: multipleChoiceEnabled,artifact:artifactEnabled, mcpConnectionIds,mcpToolNames } };
      replaceQueue([...queuedPromptsRef.current, queued]); setDraft(""); setDraftAttachments([]); return;
    }
    if (!hasMessage || uploadingImages) return;
    if (!requestModel) { setError(c.noModel); return; }
    const attachments = draftAttachments;
    const userMessage: StoredMessage = { id: uid("user"), role: "user", content: text, attachments, createdAt: now() }; setDraft(""); setDraftAttachments([]);
    const options: CompletionOptions = { modelId: requestModel.id, aliasBaseModelId: requestModel.isAlias ? selectedAliasBase?.id : undefined, reasoningPresetId: requestPreset?.id, sendReasoning,
      tools: { internetSearch: internetSearchEnabled, pageVisit: pageVisitEnabled, browser: browserEnabled, storageAccess:storageAccessEnabled, storageRead:storageReadEnabled, storageWrite:storageWriteEnabled, storageWriteMaxFiles, hostComputer: hostComputerToolAvailable && hostComputerEnabled, currentTime: currentTimeEnabled, location: locationEnabled, multipleChoice: multipleChoiceEnabled,artifact:artifactEnabled, mcpConnectionIds,mcpToolNames } };
    if (!conversation) {
      const next = createConversation(userMessage, requestModel, requestPreset); await runCompletionAndDrain(next, next.activeBranchId, [userMessage], true, undefined, options); return;
    }
    const branch = activeBranch || conversation.branches[0]; if (!branch) return;
    const requestMessages = [...branch.messages, userMessage]; const stamp = now();
    const next: Conversation = { ...conversation, modelId: requestModel.id, reasoningPresetId: requestPreset?.id, updatedAt: stamp,
      branches: conversation.branches.map((item) => item.id === branch.id ? { ...item, messages: requestMessages, updatedAt: stamp } : item) };
    await runCompletionAndDrain(next, branch.id, requestMessages, false, undefined, options);
  }

  async function forkFromMessage(messageId: string, editedText: string) {
    if (!conversation || isGenerating) return;
    const source = activeBranch || conversation.branches[0]; const index = source.messages.findIndex((message) => message.id === messageId);
    if (index < 0 || source.messages[index].role !== "user") return;
    const stamp = now(); const newBranchId = uid("branch");
    const original = source.messages[index]; const revisionGroupId = original.revisionGroupId || original.id;
    const edited: StoredMessage = { id: uid("user"), revisionGroupId, role: "user", content: editedText.trim(), attachments: original.attachments, createdAt: stamp };
    const path = [...source.messages.slice(0, index), edited];
    const branch: ChatBranch = { id: newBranchId, name: `${locale === "ko" ? "요청 수정" : "Request edit"} ${conversation.branches.length + 1}`, parentBranchId: source.id,
      forkedFromMessageId: messageId, messages: path, createdAt: stamp, updatedAt: stamp };
    const next: Conversation = { ...conversation, activeBranchId: newBranchId, updatedAt: stamp, branches: [...conversation.branches, branch] };
    setMessages(path); await runCompletionAndDrain(next, newBranchId, path);
  }

  async function editAssistantMessage(messageId: string, editedText: string) {
    if (!conversation || isGenerating) return;
    const source = activeBranch || conversation.branches[0]; if (!source) return;
    const content = editedText.trim(); if (!content) return;
    const index = source.messages.findIndex((message) => message.id === messageId); if (index < 0 || source.messages[index].role !== "assistant") return;
    const stamp = now(); const newBranchId = uid("branch"); const original = source.messages[index]; const revisionGroupId = original.revisionGroupId || original.id;
    const edited: StoredMessage = { ...replaceAssistantContent(original, content), id: uid("assistant"), revisionGroupId, createdAt: stamp };
    const path = [...source.messages.slice(0, index), edited];
    const branch: ChatBranch = { id: newBranchId, name: `${locale === "ko" ? "응답 수정" : "Response edit"} ${conversation.branches.length + 1}`, parentBranchId: source.id,
      forkedFromMessageId: messageId, messages: path, createdAt: stamp, updatedAt: stamp };
    const next: Conversation = { ...conversation, activeBranchId: newBranchId, updatedAt: stamp, branches: [...conversation.branches, branch] };
    setMessages(path); await persist(next);
  }

  async function editArtifact(messageId:string,eventId:string,artifact:ArtifactDocument){
    if(!conversation||isGenerating)return;const source=activeBranch||conversation.branches[0];if(!source)return;
    const nextMessages=source.messages.map(message=>message.id!==messageId?message:{...message,toolEvents:message.toolEvents?.map(tool=>tool.id!==eventId?tool:{...tool,result:{...(tool.result&&typeof tool.result==="object"?tool.result as Record<string,unknown>:{}),artifact}})});
    const stamp=now(),next:Conversation={...conversation,updatedAt:stamp,branches:conversation.branches.map(branch=>branch.id===source.id?{...branch,messages:nextMessages,updatedAt:stamp}:branch)};
    setMessages(nextMessages);await persist(next);
  }

  async function regenerateAssistantMessage(messageId: string) {
    if (!conversation || isGenerating) return;
    const source = activeBranch || conversation.branches[0]; if (!source) return;
    const index = source.messages.findIndex((message) => message.id === messageId); if (index < 0 || source.messages[index].role !== "assistant") return;
    const stamp = now(); const newBranchId = uid("branch"); const original = source.messages[index]; const revisionGroupId = original.revisionGroupId || original.id;
    const path = source.messages.slice(0, index);
    const branch: ChatBranch = { id: newBranchId, name: `${locale === "ko" ? "응답 재생성" : "Regenerated response"} ${conversation.branches.length + 1}`, parentBranchId: source.id,
      forkedFromMessageId: messageId, messages: path, createdAt: stamp, updatedAt: stamp };
    const next: Conversation = { ...conversation, activeBranchId: newBranchId, updatedAt: stamp, branches: [...conversation.branches, branch] };
    setMessages(path); await runCompletionAndDrain(next, newBranchId, path, false, revisionGroupId);
  }

  async function regenerateUserMessage(messageId: string) {
    if (!conversation || isGenerating) return;
    const source = activeBranch || conversation.branches[0]; if (!source) return;
    const index = source.messages.findIndex((message) => message.id === messageId); if (index < 0 || source.messages[index].role !== "user") return;
    const following = source.messages[index + 1]?.role === "assistant" ? source.messages[index + 1] : undefined;
    const stamp = now(); const newBranchId = uid("branch"); const path = source.messages.slice(0, index + 1);
    const branch: ChatBranch = { id: newBranchId, name: `${locale === "ko" ? "요청 재생성" : "Regenerated request"} ${conversation.branches.length + 1}`, parentBranchId: source.id,
      forkedFromMessageId: following?.id || messageId, messages: path, createdAt: stamp, updatedAt: stamp };
    const next: Conversation = { ...conversation, activeBranchId: newBranchId, updatedAt: stamp, branches: [...conversation.branches, branch] };
    setMessages(path); await runCompletionAndDrain(next, newBranchId, path, false, following?.revisionGroupId || following?.id);
  }

  async function deleteUserMessage(messageId: string) {
    if (!conversation) return;
    if (isGenerating) { await notify({ tone: "info", title: c.deleteMessage, message: c.deleteWhileGenerating }); return; }
    const source = activeBranch || conversation.branches[0]; if (!source) return;
    const message = source.messages.find((item) => item.id === messageId); if (message?.role !== "user") return;
    // The same request can exist as several revisions. Deleting one of them is not the same act as
    // deleting the request itself, so the person says which they meant.
    const groupId = revisionGroupOf(conversation, messageId);
    const shared = branchesHoldingRevision(conversation, groupId).length > 1;
    const scope = shared
      ? await choose({ tone: "danger", title: c.deleteMessage, message: c.confirmDeleteMessage, detail: c.deleteScopeHelp, choices: [{ id: "branch", label: c.deleteThisBranch, quiet: true }, { id: "all", label: c.deleteEveryBranch }] })
      : await askConfirm({ tone: "danger", title: c.deleteMessage, message: c.confirmDeleteMessage, confirmLabel: c.confirmDelete }) ? "branch" : "";
    if (!scope) return;
    const stamp = now();
    const next = scope === "all" ? deleteMessageEverywhere(conversation, groupId, stamp) : deleteMessageFromBranch(conversation, source.id, messageId, stamp);
    const nextBranch = next.branches.find((branch) => branch.id === next.activeBranchId) || next.branches[0];
    setMessages(nextBranch?.messages || []); await persist(next);
  }

  async function toggleSendReasoning(value: boolean) {
    setSendReasoning(value);
    const next = { ...config, preferences: { ...config.preferences, sendReasoningToModel: value } };
    setConfig(next);
    await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
  }

  async function uploadImages(files: File[]) {
    const remaining = config.toolSettings.maxAttachmentsPerMessage - draftAttachments.length;
    if (remaining <= 0) { setError(c.maxImages); return; }
    const imageTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);
    const selected = files.filter((file) => {
      const mimeType=file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")?"application/pdf":file.type;
      return (mimeType==="application/pdf"||imageTypes.has(mimeType))&&attachmentAllowedForModel(selectedModel,{mimeType});
    }).slice(0, remaining);
    if (!selected.length) { if(files.length)setError(c.modelAttachmentUnsupported); return; }
    setUploadingImages(true); setError("");
    try {
      const prepared = await Promise.all(selected.map(async (file) => file.type.startsWith("image/") ? { file, ...(await createThumbnail(file)) } : { file }));
      const form = new FormData();
      form.append("retained", "true");
      prepared.forEach((item, index) => {
        form.append("files", item.file);
        if ("thumbnail" in item && item.thumbnail) form.append(`thumbnail-${index}`, item.thumbnail);
        if ("width" in item) form.append(`dimensions-${index}`, JSON.stringify({ width: item.width, height: item.height }));
      });
      const response = await fetch("/api/uploads", { method: "POST", body: form }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || c.imageUploadFailed);
      setDraftAttachments((current) => [...current, ...body.attachments.map((attachment:StoredAttachment)=>({...attachment,fromStorage:true}))].slice(0, config.toolSettings.maxAttachmentsPerMessage));
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.imageUploadFailed); }
    finally { setUploadingImages(false); }
  }

  async function removeDraftAttachment(attachment: StoredAttachment) {
    setDraftAttachments((current) => current.filter((item) => item.id !== attachment.id));
    if(!attachment.fromStorage)await fetch(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined);
  }

  function attachStoredFiles(files:StorageFile[]){
    const supported=files.filter(file=>attachmentAllowedForModel(selectedModel,file));
    if(supported.length!==files.length)setError(c.modelAttachmentUnsupported);
    setDraftAttachments(current=>{const ids=new Set(current.map(file=>file.id));const available=config.toolSettings.maxAttachmentsPerMessage-current.length;return[...current,...supported.filter(file=>!ids.has(file.id)).slice(0,available).map(file=>({...file,fromStorage:true}))];});
    setStoragePickerOpen(false);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const mobileInput = typeof window !== "undefined" && hasMobileComposerInput(window, navigator.userAgent);
    if (shouldSubmitComposerOnEnter({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, mobileInput })) {
      event.preventDefault();
      void sendMessage();
    }
  }

  if (!auth) return <div className="auth-shell"><LoaderCircle className="spin" size={28} /></div>;
  if (!auth.authenticated) return <AuthScreen setup={auth.setupRequired} onAuthenticated={async () => setAuth(await fetch("/api/auth/status").then((response) => response.json()))} />;

  const visibleHistory = histories;
  const hiddenMessageCount = Math.max(0, messages.length - renderedMessageCount);
  const renderedMessages = hiddenMessageCount ? messages.slice(-renderedMessageCount) : messages;
  function loadEarlierMessages() {
    const element = threadRef.current; const previousHeight = element?.scrollHeight || 0;
    setRenderedMessageCount((count) => Math.min(messages.length, count + 60));
    requestAnimationFrame(() => { if (element) element.scrollTop += element.scrollHeight - previousHeight; });
  }
  return (
    <AliasBaseContext.Provider value={selectedAliasDefinition ? { models: connectedBaseModels, selected: selectedAliasBase, defaultId: config.preferences.aliasBaseModelIds?.[selectedAliasDefinition.id], connections: config.connections, showIdentifiers: config.preferences.showModelIdentifiers !== false, showConnectionNames: config.showModelConnectionNames === true, weights: config.modelWeights, onSelect: chooseAliasBase, onDefault: () => void setDefaultAliasBase() } : undefined}>
    <McpToolsContext.Provider value={{connections:config.mcpEntitlement.enabled?config.mcpConnections.filter(connection=>connection.enabled):[],selectedIds:mcpConnectionIds,setSelectedIds:persistedMcpConnections,selectedTools:mcpToolNames,setSelectedTools:(id,names)=>setMcpToolNames(current=>({...current,[id]:names}))}}>
    <StorageToolsContext.Provider value={{read:storageReadEnabled,write:storageWriteEnabled,maxFiles:storageWriteMaxFiles,setRead:persistedTool("storageRead",setStorageReadEnabled),setWrite:persistedTool("storageWrite",setStorageWriteEnabled),setMaxFiles:persistedStorageWriteLimit}}>
    <main className={`app-shell ${messages.length ? "chat-active" : "chat-idle"} ${temporaryActive ? "temporary-chat" : ""} ${browserEnabled && browserViewOpen ? "browser-split-open" : ""}`}>
      <button className="mobile-menu" aria-label={locale === "ko" ? "메뉴 열기" : "Open menu"} onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
      <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-visible" : ""}`}>
        <section className="side-panel">
          <div className="sidebar-head">
            <button className="sidebar-toggle" title={collapsed ? (locale === "ko" ? "사이드바 펼치기" : "Expand sidebar") : (locale === "ko" ? "사이드바 접기" : "Collapse sidebar")} aria-label={collapsed ? (locale === "ko" ? "사이드바 펼치기" : "Expand sidebar") : (locale === "ko" ? "사이드바 접기" : "Collapse sidebar")} onClick={() => { setCollapsed(!collapsed); localStorage.setItem("neural-sidebar-collapsed", String(!collapsed)); }}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
            <button className="sidebar-close" title={locale === "ko" ? "메뉴 닫기" : "Close menu"} aria-label={locale === "ko" ? "메뉴 닫기" : "Close menu"} onClick={() => setMobileOpen(false)}><X size={18} /></button>
          </div>
          <div className="new-chat-halo"><button className="pill-button primary-nav" title={c.newChat} aria-label={c.newChat} onClick={() => newChat()}><MessageSquarePlus size={19} /> <span>{c.newChat}</span></button></div>
          <button className="pill-button" title={c.search} aria-label={c.search} onClick={() => setSearching(true)}><Search size={18} /> <span>{c.search}</span></button>
          <button className="pill-button" title={c.storageManager} aria-label={c.storageManager} onClick={() => { setStorageOpen(true); setMobileOpen(false); }}><HardDrive size={18} /> <span>{c.storageManager}</span></button>
          <div className="history-heading"><p className="section-label">{c.histories}</p><div>{(conversation || histories.length > 0) && <button onClick={() => setExportOpen(true)} title={conversation ? c.exportChat : c.exportAllChats} aria-label={conversation ? c.exportChat : c.exportAllChats}><Download size={15} /></button>}{histories.length > 0 && <button onClick={() => void deleteAllHistories()} title={c.deleteAllChats} aria-label={c.deleteAllChats}><Trash2 size={15} /></button>}</div></div>
          <div className="history-list">
            {visibleHistory.map((item) => <div className={`history-row ${item.id === conversation?.id ? "active" : ""}`} key={item.id}><button className="history-item" onClick={() => loadConversation(item.id)}><span>{item.title}</span></button><div className="history-row-actions"><button className="history-rename" onClick={() => setRenameTarget(item)} title={locale === "ko" ? "제목 변경" : "Rename chat"} aria-label={`${locale === "ko" ? "제목 변경" : "Rename chat"}: ${item.title}`}><Pencil size={13}/></button><button className="history-delete" onClick={() => void deleteHistory(item.id)} title={c.deleteChat} aria-label={`${c.deleteChat}: ${item.title}`}><Trash2 size={13} /></button></div></div>)}
            {!visibleHistory.length && <p className="history-empty">{c.historyEmpty}</p>}
            <button className="chat-manager-launch" onClick={()=>{setChatManagerOpen(true);setMobileOpen(false);}}><span>{locale==="ko"?"채팅 관리하기":"Manage chats"}</span></button>
          </div>
        </section>
        <div className="profile-card"><button className="profile-card-main" title={c.settings} aria-label={c.settings} onClick={() => { setSettingsOpen(true); setMobileOpen(false); }}><span className="avatar"><UserRound size={19} /></span><span><strong>{config.profile.name}</strong><small>{c.settingsConnections}</small></span></button><UsageDonut ko={locale==="ko"} collapsed={collapsed}/><button className="profile-settings-button" title={c.settings} aria-label={c.settings} onClick={() => { setSettingsOpen(true); setMobileOpen(false); }}><Settings size={18}/></button></div>
      </aside>
      {mobileOpen && <button className="mobile-scrim" aria-label={c.closeMenu} onClick={() => setMobileOpen(false)} />}

      <section className="chat-surface">
        <div className="ambient-glow" />
        <div className="model-switcher">
          <button className="model-trigger" onClick={() => { if (!modelMenuOpen) setModelControlNotice(null); setModelMenuOpen((value) => !value); }}><span>{serversOffline ? c.serverOffline : selectedModel?.name || c.selectModel}</span><ChevronDown size={16} className={modelMenuOpen ? "rotate" : ""} /></button>
          {modelMenuMounted && <div className={`popover model-popover ${modelMenuClosing ? "closing" : ""}`}><div className="popover-heading"><span>{c.availableModels}</span>{checkingModelServers ? <LoaderCircle className="spin" size={13} aria-label={c.checkingModelServers} /> : <small>{onlineModels.length}</small>}</div>{!checkingModelServers && serversOffline && <p className="model-popover-empty">{c.noOnlineModels}</p>}{pickerModels.map((model) => { const weight = showModelWeights ? config.modelWeights?.[model.id] : undefined; const weightHint = weight ? c.modelWeightHint.replace("{weight}", formatModelWeight(weight)) : ""; const state = modelServerState(model, config.connections, serverStates); const offline = state === "offline"; const stateHint = offline ? c.modelServerOffline : state === "error" ? c.modelServerError : undefined; const connectionName = config.showModelConnectionNames ? connectionForModel(config.connections as ConnectionConfig[], model)?.name : undefined; const location = [connectionName, model.description].filter(Boolean).join(" · "); return <button className={`model-option ${offline ? "offline" : state === "error" ? "server-error" : ""}`} key={model.id} aria-disabled={offline || undefined} data-tooltip={stateHint} aria-description={stateHint} onClick={() => { if (!offline) chooseModel(model); }}><span className="selection-dot">{model.id === selectedModel?.id && <Check size={13} />}</span><span><strong>{model.name}</strong>{config.preferences.showModelIdentifiers !== false && <small>{model.sourceModel}</small>}{location && <em>{location}</em>}</span>{(model.isAlias || model.imageGeneration || weight) && <span className="model-option-badges">{model.isAlias && <b>ALIAS</b>}<ModelImageBadge model={model} c={c}/>{weight && <b className="model-weight-badge" data-tooltip={weightHint} aria-label={weightHint}>x{formatModelWeight(weight)}</b>}</span>}</button>; })}<div className="model-popover-actions"><button className="default-choice-action" disabled={!selectedModel || config.preferences.defaultModelId === selectedModel.id} onClick={() => void setDefaultSelection("model")}><Check size={14} />{config.preferences.defaultModelId === selectedModel?.id ? c.defaultModelActive : c.useAsDefault}</button>{isAdmin && <button className="default-choice-action" disabled={!selectedModel || applyingDefault === "model"} onClick={() => void applyDefaultToEveryone("model")}>{applyingDefault === "model" ? <LoaderCircle className="spin" size={14} /> : <Users size={14} />}{applyingDefault === "model" ? c.applyingToEveryone : c.applyToEveryone}</button>}{canManageInference && <button className="unload-model-action" disabled={unloadingModel} title={c.unloadModel} onClick={() => void unloadModel()}>{unloadingModel ? <LoaderCircle className="spin" size={14} /> : <Power size={14} />}{unloadingModel ? c.unloadingModel : c.unloadModel}</button>}</div>{canManageInference && modelControlNotice && <p className={`model-control-notice ${modelControlNotice.error ? "error" : ""}`} role="status">{modelControlNotice.message}</p>}</div>}
        </div>

        <div className="surface-actions">
          {temporaryActive
            ? conversation?.temporary !== true && messages.length === 0
              ? <button className="surface-action active icon-only" title={c.returnToRegularChat} aria-label={c.returnToRegularChat} onClick={() => setTemporaryMode(false)}><MessageSquareDashed size={16} /></button>
              : <button className="surface-action active" disabled={promoting || conversation?.temporary !== true} title={c.saveChat} aria-label={c.saveChat} onClick={() => void promoteTemporaryChat()}><Save size={16} /><span>{promoting ? c.savingChat : c.saveChat}</span></button>
            : <button className="surface-action icon-only" title={c.temporaryChat} aria-label={c.temporaryChat} onClick={() => newChat(false, true)}><MessageSquareDashed size={16} /></button>}
          {browserEnabled && <button type="button" className={`surface-action icon-only ${browserViewOpen ? "active" : ""}`} title={c.browserView} aria-label={c.browserView} aria-pressed={browserViewOpen} onClick={() => setBrowserViewOpen((value) => !value)}><Monitor size={16} /></button>}
          {messages.length > 0 && conversation && <button type="button" className={`surface-action icon-only ${activityHidden ? "active" : ""}`} title={activityHidden ? c.showActivity : c.hideActivity} aria-label={activityHidden ? c.showActivity : c.hideActivity} aria-pressed={activityHidden} onClick={() => setHiddenActivityChats((current) => ({ ...current, [conversation.id]: !current[conversation.id] }))}>{activityHidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>}
        </div>

        <div className="conversation-stage">
          {!messages.length ? <div className="idle-center"><div className="welcome"><h1>{temporaryActive ? c.temporaryGreeting : greeting}</h1><p>{temporaryActive ? c.temporaryChatHint : c.welcome}</p></div><Composer c={c} appearance={appearance} draft={draft} setDraft={setDraft} sendMessage={sendMessage} keyDown={handleComposerKeyDown} isGenerating={isGenerating} queuedPrompts={queuedPrompts} onRemoveQueuedPrompt={removeQueuedPrompt} selectedModel={selectedModel} models={config.models} selectedPreset={selectedPreset} contextBreakdown={contextBreakdown} harnessSettings={config.harnessSettings} presetOpen={presetMenuOpen} setPresetOpen={setPresetMenuOpen} setPreset={setSelectedPresetId} defaultReasoningPresetId={config.preferences.defaultReasoningPresetId} setDefaultReasoning={() => void setDefaultSelection("reasoning")} admin={isAdmin} applyingReasoningDefault={applyingDefault === "reasoning"} applyReasoningToEveryone={() => void applyDefaultToEveryone("reasoning")} sendReasoning={sendReasoning} toggleSendReasoning={toggleSendReasoning} error={error} clearError={() => setError("")} attachments={draftAttachments} maxAttachments={config.toolSettings.maxAttachmentsPerMessage} uploadingImages={uploadingImages} onFiles={uploadImages} onOpenStorage={()=>setStoragePickerOpen(true)} onRemoveAttachment={removeDraftAttachment} internetSearchEnabled={internetSearchEnabled} setInternetSearchEnabled={persistedTool("internetSearch", setInternetSearchEnabled)} pageVisitEnabled={pageVisitEnabled} setPageVisitEnabled={persistedTool("pageVisit", setPageVisitEnabled)} browserToolAvailable={browserToolAvailable} browserEnabled={browserEnabled} setBrowserEnabled={persistedTool("browser", setBrowserEnabled)} hostComputerToolAvailable={hostComputerToolAvailable} hostComputerEnabled={hostComputerEnabled} setHostComputerEnabled={persistedTool("hostComputer", setHostComputerEnabled)} storageAccessEnabled={storageAccessEnabled} setStorageAccessEnabled={persistedTool("storageAccess", setStorageAccessEnabled)} currentTimeEnabled={currentTimeEnabled} setCurrentTimeEnabled={persistedTool("currentTime", setCurrentTimeEnabled)} locationEnabled={locationEnabled} setLocationEnabled={persistedTool("location", setLocationEnabled)} multipleChoiceEnabled={multipleChoiceEnabled} setMultipleChoiceEnabled={persistedTool("multipleChoice", setMultipleChoiceEnabled)} artifactEnabled={artifactEnabled} setArtifactEnabled={persistedTool("artifact",setArtifactEnabled)} pendingChoice={pendingChoice} pendingHostApproval={pendingHostApproval} onChoiceSubmit={submitToolInput} /></div> : <>
            <div className="thread-shell">
              <div className={`thread ${activityHidden ? "activity-hidden" : ""}`} ref={threadRef} onScroll={handleThreadScroll} aria-live="polite">
                {hiddenMessageCount > 0 && <button className="load-earlier" onClick={loadEarlierMessages}>{c.loadEarlier} · {hiddenMessageCount}</button>}
                {renderedMessages.map((message) => <Message c={c} locale={locale} key={message.id} message={message} waitProgress={pendingWait?.messageId === message.id ? pendingWait.progress : undefined} waitPhase={isGenerating && pendingWait?.messageId === message.id ? pendingWait.phase : undefined} renderStrikethrough={config.preferences.renderStrikethrough !== false} appearance={appearance} pending={isGenerating && message.id === messages[messages.length - 1]?.id} revisions={messageRevisions.get(message.revisionGroupId || message.id) || []} onFork={forkFromMessage} onEditAssistant={editAssistantMessage} onEditArtifact={(eventId,artifact)=>void editArtifact(message.id,eventId,artifact)} onRegenerate={regenerateAssistantMessage} onRegenerateUser={regenerateUserMessage} onDeleteUser={deleteUserMessage} onRevision={(branchId) => void switchBranch(branchId)} />)}
              </div>
              {!threadAutoFollow && <button type="button" className="scroll-resume thread-scroll-resume" title={c.scrollToBottom} aria-label={c.scrollToBottom} onClick={resumeThreadAutoFollow}><ArrowDown size={18} /></button>}
            </div>
            <Composer c={c} appearance={appearance} draft={draft} setDraft={setDraft} sendMessage={sendMessage} keyDown={handleComposerKeyDown} isGenerating={isGenerating} queuedPrompts={queuedPrompts} onRemoveQueuedPrompt={removeQueuedPrompt} selectedModel={selectedModel} models={config.models} selectedPreset={selectedPreset} contextBreakdown={contextBreakdown} harnessSettings={config.harnessSettings} presetOpen={presetMenuOpen} setPresetOpen={setPresetMenuOpen} setPreset={setSelectedPresetId} defaultReasoningPresetId={config.preferences.defaultReasoningPresetId} setDefaultReasoning={() => void setDefaultSelection("reasoning")} admin={isAdmin} applyingReasoningDefault={applyingDefault === "reasoning"} applyReasoningToEveryone={() => void applyDefaultToEveryone("reasoning")} sendReasoning={sendReasoning} toggleSendReasoning={toggleSendReasoning} error={error} clearError={() => setError("")} attachments={draftAttachments} maxAttachments={config.toolSettings.maxAttachmentsPerMessage} uploadingImages={uploadingImages} onFiles={uploadImages} onOpenStorage={()=>setStoragePickerOpen(true)} onRemoveAttachment={removeDraftAttachment} internetSearchEnabled={internetSearchEnabled} setInternetSearchEnabled={persistedTool("internetSearch", setInternetSearchEnabled)} pageVisitEnabled={pageVisitEnabled} setPageVisitEnabled={persistedTool("pageVisit", setPageVisitEnabled)} browserToolAvailable={browserToolAvailable} browserEnabled={browserEnabled} setBrowserEnabled={persistedTool("browser", setBrowserEnabled)} hostComputerToolAvailable={hostComputerToolAvailable} hostComputerEnabled={hostComputerEnabled} setHostComputerEnabled={persistedTool("hostComputer", setHostComputerEnabled)} storageAccessEnabled={storageAccessEnabled} setStorageAccessEnabled={persistedTool("storageAccess", setStorageAccessEnabled)} currentTimeEnabled={currentTimeEnabled} setCurrentTimeEnabled={persistedTool("currentTime", setCurrentTimeEnabled)} locationEnabled={locationEnabled} setLocationEnabled={persistedTool("location", setLocationEnabled)} multipleChoiceEnabled={multipleChoiceEnabled} setMultipleChoiceEnabled={persistedTool("multipleChoice", setMultipleChoiceEnabled)} artifactEnabled={artifactEnabled} setArtifactEnabled={persistedTool("artifact",setArtifactEnabled)} pendingChoice={pendingChoice} pendingHostApproval={pendingHostApproval} onChoiceSubmit={submitToolInput} />
          </>}
        </div>
      </section>

      {browserEnabled && browserViewOpen && <BrowserSplitView c={c} conversationId={conversation?.id} pendingHandoff={pendingBrowserHandoff} onComplete={async () => { if (!pendingBrowserHandoff) return false; return submitToolInput(pendingBrowserHandoff.id, { completed: true }); }} onClose={() => setBrowserViewOpen(false)} />}

      {searching && <HistorySearch ko={locale === "ko"} onClose={() => setSearching(false)} onSelect={(id, branchId) => { setSearching(false); void loadConversation(id, true, false, branchId); }} />}
      {storageOpen && <StorageManager ko={locale === "ko"} onClose={() => setStorageOpen(false)} onOpenConversation={id=>void loadConversation(id)} onConversationsChanged={()=>void managedChatsChanged()} />}
      {storagePickerOpen && <StorageManager ko={locale === "ko"} selectMode maxSelectable={Math.max(0,config.toolSettings.maxAttachmentsPerMessage-draftAttachments.length)} onSelect={attachStoredFiles} onClose={() => setStoragePickerOpen(false)} />}
      {chatManagerOpen&&<ChatManager
        ko={locale==="ko"}
        onClose={()=>setChatManagerOpen(false)}
        onOpenConversation={id=>{setChatManagerOpen(false);void loadConversation(id);}}
        onDeleted={()=>void managedChatsChanged()}
      />}
      {renameTarget && <TextDialog ko={locale === "ko"} title={locale === "ko" ? "채팅 제목 변경" : "Rename chat"} value={renameTarget.title} saveLabel={c.saveEdit} cancelLabel={c.cancel} secondary={{ label: c.duplicateChat, icon: <Copy size={15} />, busy: duplicating, onAction: (title) => { const target = renameTarget; void duplicateHistory(target.id, title); } }} onClose={() => setRenameTarget(null)} onSave={title => { const target = renameTarget; void (async () => { try { const response = await fetch(`/api/conversations/${target.id}`, {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({title})}); if (!response.ok) throw new Error(locale === "ko" ? "제목 변경 실패" : "Rename failed"); setConversation(current => current?.id === target.id ? {...current,title} : current); await refreshHistories(); setRenameTarget(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "Rename failed"); setRenameTarget(null); } })(); }} />}
      {settingsOpen && <SettingsPanel initial={config} serverStates={serverStates} onAccentPreview={setAccentPreview} onClose={() => { setSettingsOpen(false); setAccentPreview(""); }} onLogout={async () => { resetWorkspaceForAuthChange(); await fetch("/api/auth/logout", { method: "POST" }); setSettingsOpen(false); setAuth(await fetch("/api/auth/status").then((response) => response.json()).catch(() => ({ setupRequired: false, authenticated: false, user: null }))); }} onSaved={(next) => { setConfig(next); setMcpConnectionIds(current=>next.mcpEntitlement.enabled?current.filter(id=>next.mcpConnections.some(connection=>connection.id===id&&connection.enabled)):[]); setSendReasoning(next.preferences.sendReasoningToModel); const visible = next.models.filter((item) => item.visible !== false); const model = visible.find((item) => item.id === selectedModelIdRef.current) || visible.find((item) => item.id === next.preferences.defaultModelId) || visible[0]; const preset = model?.reasoningPresets.find((item) => item.id === selectedPresetId) || model?.reasoningPresets.find((item) => item.id === next.preferences.defaultReasoningPresetId) || model?.reasoningPresets[0]; selectedModelIdRef.current = model?.id || ""; setSelectedModelId(model?.id || ""); setSelectedPresetId(preset?.id || ""); }} />}
      {exportOpen && <ExportDialog c={c} conversation={conversation || undefined} initialIncludeReasoning={config.preferences.exportReasoning} onClose={() => setExportOpen(false)} onPreference={(value) => { const next = { ...config, preferences: { ...config.preferences, exportReasoning: value } }; setConfig(next); fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }); }} />}
      {messageDialog}
    </main>
    </StorageToolsContext.Provider>
    </McpToolsContext.Provider>
    </AliasBaseContext.Provider>
  );
}

type BrowserSurfaceTab = { id: string; title: string; url: string; label: string; note: string; active: boolean };
type BrowserSurfaceState = { available: boolean; sessionId?: string; activeTabId?: string; tabs: BrowserSurfaceTab[]; maxTabs: number; url?: string; title?: string; width: number; height: number; headed: boolean };

function BrowserSplitView({ c, conversationId, pendingHandoff, onComplete, onClose }: { c: CopySet; conversationId?: string; pendingHandoff?: ToolEvent; onComplete: () => Promise<boolean>; onClose: () => void }) {
  const [surface, setSurface] = useState<BrowserSurfaceState>({ available: false, tabs: [], maxTabs: 0, width: 1280, height: 800, headed: true });
  const [address, setAddress] = useState("");
  const [textInput, setTextInput] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);
  const [frameNonce, setFrameNonce] = useState(0);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!conversationId) { setSurface((current) => ({ ...current, available: false, sessionId: undefined, activeTabId: undefined, tabs: [], url: undefined, title: undefined })); return; }
    let cancelled = false; let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/browser-view?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
        const next = await response.json() as BrowserSurfaceState & { error?: string };
        if (!response.ok) throw new Error(next.error || "Browser view failed.");
        if (!cancelled) {
          setSurface(next);
          if (next.available) setFrameNonce(Date.now());
          setNotice("");
        }
      } catch (error) { if (!cancelled) setNotice(error instanceof Error ? error.message : "Browser view failed."); }
      if (!cancelled) timer = window.setTimeout(poll, 400);
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [conversationId]);

  useEffect(() => { if (!addressFocused && surface.url) setAddress(surface.url); }, [addressFocused, surface.url]);

  async function act(payload: Record<string, unknown>) {
    if (!conversationId || !surface.sessionId) return false;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/browser-view?conversationId=${encodeURIComponent(conversationId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, sessionId: surface.sessionId }) });
      const next = await response.json() as BrowserSurfaceState & { error?: string };
      if (!response.ok) throw new Error(next.error || "Browser interaction failed.");
      setSurface(next); setFrameNonce(Date.now());
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "Browser interaction failed."); return false; }
    finally { setBusy(false); }
  }

  function browserPoint(event: ReactPointerEvent<HTMLImageElement> | ReactWheelEvent<HTMLImageElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(bounds.width / surface.width, bounds.height / surface.height);
    const renderedWidth = surface.width * scale; const renderedHeight = surface.height * scale;
    const left = bounds.left + (bounds.width - renderedWidth) / 2; const top = bounds.top + (bounds.height - renderedHeight) / 2;
    return {
      x: Math.max(0, Math.min(surface.width, (event.clientX - left) / renderedWidth * surface.width)),
      y: Math.max(0, Math.min(surface.height, (event.clientY - top) / renderedHeight * surface.height)),
    };
  }

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (!surface.available || event.target instanceof HTMLInputElement || ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    event.preventDefault();
    const modifiers = [event.altKey && "Alt", event.ctrlKey && "Control", event.metaKey && "Meta", event.shiftKey && "Shift"].filter((item): item is string => Boolean(item));
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) void act({ action: "insert_text", text: event.key });
    else void act({ action: "key", key: event.key, modifiers });
  }

  const handoffArgs = pendingHandoff?.arguments && typeof pendingHandoff.arguments === "object" ? pendingHandoff.arguments as Record<string, unknown> : {};
  const tabName = (tab: BrowserSurfaceTab) => tab.label || tab.title || (() => { try { return new URL(tab.url).hostname; } catch { return c.browserUntitledTab; } })();
  return <aside className="browser-split" aria-label={c.browserViewTitle} tabIndex={0} ref={panelRef} onKeyDown={keyDown}>
    <header className="browser-split-head"><span><Monitor size={16} /><strong>{c.browserViewTitle}</strong><small>{surface.headed ? c.browserHeaded : c.browserFallback}</small></span><button type="button" title={c.close} aria-label={c.close} onClick={onClose}><X size={17} /></button></header>
    <div className="browser-tabs" role="tablist" aria-label={c.browserViewTitle}>
      {surface.tabs.map((tab) => <div className={`browser-tab ${tab.active ? "active" : ""}`} key={tab.id} title={[tab.label && tab.title ? tab.title : "", tab.url, tab.note].filter(Boolean).join("\n")}>
        <button type="button" role="tab" aria-selected={tab.active} onClick={() => void act({ action: "switch_tab", tabId: tab.id })}><span>{tabName(tab)}</span>{tab.note && <i aria-label={tab.note} />}</button>
        <button type="button" className="browser-tab-close" title={c.browserCloseTab} aria-label={`${c.browserCloseTab}: ${tabName(tab)}`} onClick={() => void act({ action: "close_tab", tabId: tab.id })}><X size={12} /></button>
      </div>)}
      {surface.available && surface.tabs.length < surface.maxTabs && <button type="button" className="browser-new-tab" title={c.browserNewTab} aria-label={c.browserNewTab} onClick={() => void act({ action: "new_tab" })}><Plus size={14} /></button>}
    </div>
    <form className="browser-nav" onSubmit={(event) => { event.preventDefault(); void act({ action: "navigate", url: address }); }}>
      <button type="button" title={c.browserBack} aria-label={c.browserBack} disabled={!surface.available || busy} onClick={() => void act({ action: "back" })}><ChevronLeft size={17} /></button>
      <button type="button" title={c.browserForward} aria-label={c.browserForward} disabled={!surface.available || busy} onClick={() => void act({ action: "forward" })}><ChevronRight size={17} /></button>
      <button type="button" title={c.browserReload} aria-label={c.browserReload} disabled={!surface.available || busy} onClick={() => void act({ action: "reload" })}><RefreshCw size={15} /></button>
      <input aria-label={c.browserAddress} value={address} onFocus={() => setAddressFocused(true)} onBlur={() => setAddressFocused(false)} onChange={(event) => setAddress(event.target.value)} placeholder="https://" disabled={!surface.available} />
      <button type="submit" aria-label={c.browserAddress} disabled={!surface.available || busy || !address.trim()}><ArrowUp size={16} /></button>
    </form>
    <div className="browser-viewport">
      {surface.available && surface.sessionId && conversationId
        ? <img src={`/api/browser-view?conversationId=${encodeURIComponent(conversationId)}&frame=1&sessionId=${encodeURIComponent(surface.sessionId)}&v=${frameNonce}`} alt={surface.title || c.browserViewTitle} draggable={false} onPointerDown={(event) => { panelRef.current?.focus(); pointerStart.current = browserPoint(event); event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerUp={(event) => { const start = pointerStart.current; pointerStart.current = null; if (!start) return; const end = browserPoint(event); if (Math.hypot(end.x - start.x, end.y - start.y) > 6) void act({ action: "drag", ...start, endX: end.x, endY: end.y }); else void act({ action: "click", ...end }); }} onWheel={(event) => { event.preventDefault(); const point = browserPoint(event); void act({ action: "scroll", ...point, deltaX: event.deltaX, deltaY: event.deltaY }); }} />
        : <div className="browser-empty"><Monitor size={28} /><p>{c.browserWaiting}</p></div>}
    </div>
    {notice && <p className="browser-notice" role="status">{notice}</p>}
    <form className="browser-text-entry" onSubmit={(event) => { event.preventDefault(); const value = textInput; if (!value) return; void act({ action: "insert_text", text: value }).then((sent) => { if (sent) setTextInput(""); }); }}><Keyboard size={16} /><input aria-label={c.browserText} placeholder={c.browserText} value={textInput} onChange={(event) => setTextInput(event.target.value)} disabled={!surface.available} /><button disabled={!surface.available || busy || !textInput}>{c.browserSendText}</button></form>
    {pendingHandoff && <div className="browser-handoff"><span><strong>{c.browserCompleteHelp}</strong>{typeof handoffArgs.message === "string" && handoffArgs.message.trim() ? <small>{handoffArgs.message}</small> : null}</span><button type="button" disabled={busy} onClick={() => { setBusy(true); void onComplete().finally(() => setBusy(false)); }}><Check size={15} />{c.browserComplete}</button></div>}
  </aside>;
}

function AuthScreen({ setup, onAuthenticated }: { setup: boolean; onAuthenticated: () => Promise<void> }) {
  const [username, setUsername] = useState(""); const [displayName, setDisplayName] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, displayName: displayName || username, password }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "로그인하지 못했습니다.");
      await onAuthenticated();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "요청에 실패했습니다."); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell"><section className="auth-card"><div className="auth-mark"><ShieldCheck size={25} /></div><span>NEURAL CHAT</span><h1>{setup ? "최고 관리자 계정 만들기" : "로그인"}</h1><p>{setup ? "처음 생성한 계정은 최고 관리자가 되며 기존 대화와 업로드를 인계받습니다." : "계속하려면 계정에 로그인하세요."}</p><form onSubmit={submit}>{setup && <label><span>표시 이름</span><input autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /></label>}<label><span>사용자 이름</span><input autoFocus={!setup} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label><label><span>비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={setup ? "new-password" : "current-password"} minLength={8} required /></label>{error && <div className="auth-error">{error}</div>}<button disabled={busy}>{busy && <LoaderCircle className="spin" size={16} />}{setup ? "계정 생성" : "로그인"}</button></form></section></main>;
}

function ContextWindowIndicator({ c, locale, model, models, usage, includeReasoning, harnessSettings }: { c: CopySet; locale: Locale; model?: ModelConfig; models: ModelConfig[]; usage: ContextUsage; includeReasoning: boolean; harnessSettings?: HarnessSettings }) {
  const [open, setOpen] = useState(false);
  const maximum = contextUsageDisplayLimitTokens(model, models, harnessSettings);
  const percentage = maximum ? usage.total / maximum * 100 : 0;
  const percentageLabel = percentage > 0 && percentage < .1 ? "<0.1%" : `${percentage.toFixed(1)}%`;
  const estimateLabel = locale === "ko" ? "컨텍스트 사용량 추정" : "Estimated context usage";
  const detail = maximum ? `${estimateLabel}: ${formatTokens(usage.total, locale)} / ${formatTokens(maximum, locale)} · ${percentageLabel}` : `${estimateLabel}: ${formatTokens(usage.total, locale)} · ${c.contextUnavailable}`;
  return <div className={`context-indicator ${open ? "open" : ""}`}>
    <button type="button" className="context-trigger" aria-label={detail} aria-expanded={open} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} onBlur={() => setOpen(false)}>
      <span className="context-donut" style={{ "--context-fill": `${Math.min(100, percentage) * 3.6}deg` } as React.CSSProperties} />
    </button>
    <span className="context-tooltip" role="tooltip">
      <strong>{formatTokens(usage.total, locale)}{maximum ? ` / ${formatTokens(maximum, locale)}` : ""}</strong>
      <small>{maximum ? `${percentageLabel} · ${estimateLabel}` : c.contextUnavailable}</small>
      {open && <span className="context-breakdown">{([
        [locale === "ko" ? "입력" : "Input", usage.input],
        [locale === "ko" ? "응답" : "Response", usage.response],
        [locale === "ko" ? "추론" : "Reasoning", usage.reasoning],
        [locale === "ko" ? "도구" : "Tools", usage.tools],
        ...(usage.summary ? [[locale === "ko" ? "압축 요약" : "Compacted", usage.summary] as const] : []),
      ] as const).map(([label, value]) => <span key={label}><span>{label}</span><b>{formatTokens(value, locale)}</b></span>)}<small>{locale === "ko" ? `대화·작성 중 입력 기준 추정치 · 추론 ${includeReasoning ? "포함" : "제외"}. ${usage.summary ? "압축된 요약이 이전 대화를 대신하고 있습니다." : "실제 전송 시 컨텍스트 정리가 적용될 수 있습니다."}` : `History and draft estimate · reasoning ${includeReasoning ? "included" : "excluded"}. ${usage.summary ? "A compacted summary now stands in for the earlier turns." : "Context handling may reduce the actual request."}`}</small></span>}
    </span>
  </div>;
}

/** Inline padding plus the gaps between the composer's three cells. */
const INLINE_COMPOSER_CHROME = 26;

function Composer(props: { c: CopySet; appearance: AppearancePreferences; draft: string; setDraft: (value: string) => void; sendMessage: (event?: FormEvent) => Promise<void>; keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; isGenerating: boolean; queuedPrompts: QueuedPrompt[]; onRemoveQueuedPrompt: (id: string) => void; selectedModel?: ModelConfig; models: ModelConfig[]; selectedPreset?: ReasoningPreset; contextBreakdown: ContextUsage; harnessSettings?: HarnessSettings; presetOpen: boolean; setPresetOpen: (value: boolean) => void; setPreset: (id: string) => void; defaultReasoningPresetId?: string; setDefaultReasoning: () => void; admin: boolean; applyingReasoningDefault: boolean; applyReasoningToEveryone: () => void; sendReasoning: boolean; toggleSendReasoning: (value: boolean) => void; error: string; clearError: () => void; attachments: StoredAttachment[]; maxAttachments: number; uploadingImages: boolean; onFiles: (files: File[]) => void; onOpenStorage: () => void; onRemoveAttachment: (attachment: StoredAttachment) => void; internetSearchEnabled: boolean; setInternetSearchEnabled: (value: boolean) => void; pageVisitEnabled: boolean; setPageVisitEnabled: (value: boolean) => void; browserToolAvailable: boolean; browserEnabled: boolean; setBrowserEnabled: (value: boolean) => void; hostComputerToolAvailable: boolean; hostComputerEnabled: boolean; setHostComputerEnabled: (value: boolean) => void; storageAccessEnabled:boolean;setStorageAccessEnabled:(value:boolean)=>void; currentTimeEnabled: boolean; setCurrentTimeEnabled: (value: boolean) => void; locationEnabled: boolean; setLocationEnabled: (value: boolean) => void; multipleChoiceEnabled: boolean; setMultipleChoiceEnabled: (value: boolean) => void;artifactEnabled:boolean;setArtifactEnabled:(value:boolean)=>void; pendingChoice?: ToolEvent; pendingHostApproval?: ToolEvent; onChoiceSubmit: (id: string, value: unknown) => Promise<boolean> }) {
  const { c, appearance, draft, setDraft, sendMessage, keyDown, isGenerating, queuedPrompts, onRemoveQueuedPrompt, selectedModel, models, selectedPreset, contextBreakdown, harnessSettings, presetOpen, setPresetOpen, setPreset, defaultReasoningPresetId, setDefaultReasoning, admin, applyingReasoningDefault, applyReasoningToEveryone, sendReasoning, toggleSendReasoning, error, clearError, attachments, maxAttachments, uploadingImages, onFiles, onOpenStorage, onRemoveAttachment, internetSearchEnabled, setInternetSearchEnabled, pageVisitEnabled, setPageVisitEnabled, browserToolAvailable, browserEnabled, setBrowserEnabled, hostComputerToolAvailable, hostComputerEnabled, setHostComputerEnabled, storageAccessEnabled,setStorageAccessEnabled,currentTimeEnabled, setCurrentTimeEnabled, locationEnabled, setLocationEnabled, multipleChoiceEnabled, setMultipleChoiceEnabled,artifactEnabled,setArtifactEnabled, pendingChoice, pendingHostApproval, onChoiceSubmit } = props;
  const aliasBasePicker = useContext(AliasBaseContext);
  const {connections:mcpConnections,selectedIds:mcpConnectionIds,setSelectedIds:setMcpConnectionIds,selectedTools:mcpToolNames,setSelectedTools:setMcpToolNames}=useContext(McpToolsContext);
  const storagePermissions=useContext(StorageToolsContext);
  const fileRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  useEffect(() => {
    if (!addMenuOpen) return;
    const closeOnOutsidePress = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !addMenuRef.current?.contains(event.target)) setAddMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [addMenuOpen]);
  const hasDraftMessage = Boolean(draft.trim() || attachments.length);
  const pendingInput = pendingChoice || pendingHostApproval;
  const showStop = isGenerating && (!hasDraftMessage || Boolean(pendingInput));
  const attachmentControlsDisabled = selectedModel?.imageGeneration === true && selectedModel.imageInput === false;
  const formRef = useRef<HTMLFormElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [shellWidth, setShellWidth] = useState(0);
  const locale: Locale = c === translations.ko ? "ko" : "en";
  const { mounted: addMenuMounted, closing: addMenuClosing } = usePopoverPresence(addMenuOpen);
  const { mounted: presetMounted, closing: presetClosing } = usePopoverPresence(presetOpen);
  const activeToolCount = Number(internetSearchEnabled) + Number(pageVisitEnabled) + Number(browserToolAvailable && browserEnabled) + Number(hostComputerToolAvailable && hostComputerEnabled) + Number(storageAccessEnabled) + Number(currentTimeEnabled) + Number(locationEnabled) + Number(multipleChoiceEnabled)+Number(artifactEnabled) + mcpConnectionIds.length;
  const[toolGroups,setToolGroups]=useState<Record<string,boolean>>({storage:false,internet:true,awareness:true,agent:true,interaction:true,mcp:true});
  const toggleToolGroup=(key:string)=>setToolGroups(current=>({...current,[key]:!current[key]}));
  useEffect(() => {
    const measureShell = () => setShellWidth(formRef.current?.clientWidth || 0);
    measureShell();
    window.addEventListener("resize", measureShell);
    return () => window.removeEventListener("resize", measureShell);
  }, []);
  // The composer holds its pill shape only while everything still fits on one row: nothing may
  // take a row of its own, and the leftover space has to stay wide enough to type in. Both the
  // control widths and the chrome allowance are layout-independent, so the comparison cannot
  // oscillate between the two states.
  const stackedRows = queuedPrompts.length > 0 || attachments.length > 0 || uploadingImages;
  useLayoutEffect(() => {
    const shell = formRef.current; const measure = measureRef.current;
    if (!shell || !measure) return;
    const controls = (leadRef.current?.offsetWidth || 0) + (trailRef.current?.offsetWidth || 0);
    const available = shell.clientWidth - controls - INLINE_COMPOSER_CHROME;
    setExpanded(shouldExpandComposer(stackedRows, draft, available, measure.scrollWidth));
  }, [draft, shellWidth, stackedRows, activeToolCount]);
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(190, Math.max(30, element.scrollHeight))}px`;
  }, [draft, expanded, shellWidth]);
  return <div className="composer-wrap">
    {error && <div className="error-toast"><span>{error}</span><button aria-label={c.cancel} onClick={clearError}><X size={15} /></button></div>}
    {pendingChoice && <MultipleChoiceComposer key={pendingChoice.id} c={c} event={pendingChoice} onSubmit={(value) => onChoiceSubmit(pendingChoice.id, value)} />}
    {pendingHostApproval && (pendingHostApproval.name.startsWith("mcp_")?<McpApprovalComposer key={pendingHostApproval.id} c={c} event={pendingHostApproval} onSubmit={(value)=>onChoiceSubmit(pendingHostApproval.id,value)}/>:<HostApprovalComposer key={pendingHostApproval.id} c={c} event={pendingHostApproval} onSubmit={(value) => onChoiceSubmit(pendingHostApproval.id, value)} />)}
    <form ref={formRef} className={`composer ${expanded ? "expanded" : ""}`} onSubmit={sendMessage}>
      <input ref={fileRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif,application/pdf" multiple onChange={(event) => { onFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
      {queuedPrompts.length > 0 && <div className="queued-prompts"><p><span>{c.queuedMessages}</span><b>{queuedPrompts.length}</b></p>{queuedPrompts.map((prompt, index) => <div key={prompt.id}><b>{index + 1}</b><span><strong>{prompt.content || c.imageChat}</strong>{prompt.attachments.length > 0 && <small>{prompt.attachments.length} {c.imagesAttached}</small>}</span><button type="button" title={c.removeQueuedMessage} aria-label={c.removeQueuedMessage} onClick={() => onRemoveQueuedPrompt(prompt.id)}><X size={13} /></button></div>)}</div>}
      {attachments.length > 0 && <div className="draft-attachments">{attachments.map((attachment) => <div className={`draft-image ${attachment.mimeType === "application/pdf" ? "pdf" : ""}`} key={attachment.id}>{attachment.thumbnailUrl ? <img src={attachment.thumbnailUrl} alt={attachment.name} loading="lazy" decoding="async" /> : <span><FileText size={23} /><small>{attachment.name}</small></span>}<button type="button" title={c.removeImage} onClick={() => onRemoveAttachment(attachment)}><X size={13} /></button></div>)}</div>}
      {uploadingImages && <div className="uploading-images"><LoaderCircle size={14} />{c.uploadingImages}</div>}
      <div className="composer-lead" ref={leadRef}>
        <div className="add-menu-wrap" ref={addMenuRef}>
          <button type="button" className={`icon-button ${addMenuOpen ? "active" : ""}`} title={c.addMenu} onClick={() => setAddMenuOpen((value) => !value)}><Plus size={20} /></button>
          {addMenuMounted && <div className={`popover add-menu-popover ${addMenuClosing ? "closing" : ""}`}>
            <button type="button" className="add-menu-action" onClick={() => { fileRef.current?.click(); setAddMenuOpen(false); }} disabled={attachmentControlsDisabled || uploadingImages || attachments.length >= maxAttachments}><ImagePlus size={17} /><span><strong>{c.attachImages}</strong></span></button>
            <button type="button" className="add-menu-action" onClick={() => { onOpenStorage(); setAddMenuOpen(false); }} disabled={attachmentControlsDisabled || attachments.length >= maxAttachments}><HardDrive size={17}/><span><strong>{c.loadFromStorage}</strong></span></button>
            <section className={`storage-composer-entry ${toolGroups.storage?"open":""}`}><div className="tool-toggle-row"><button type="button" className="storage-session-fold" aria-label={c.storageAccess} aria-expanded={toolGroups.storage} onClick={()=>toggleToolGroup("storage")}><ChevronDown size={14}/></button><HardDrive size={17}/><span><strong>{c.storageAccess}</strong><small>{c.storageAccessDesc}</small></span><button type="button" role="switch" aria-label={c.storageAccess} aria-checked={storageAccessEnabled} className={`toggle ${storageAccessEnabled?"on":""}`} onClick={()=>setStorageAccessEnabled(!storageAccessEnabled)}><i/></button></div>{toolGroups.storage&&<div className="storage-session-tools"><div className="storage-session-tool"><span><strong>{c.storageRead}</strong><small>{c.storageReadDesc}</small></span><button type="button" role="switch" aria-label={c.storageRead} aria-checked={storagePermissions.read} className={`toggle ${storagePermissions.read?"on":""}`} onClick={()=>storagePermissions.setRead(!storagePermissions.read)}><i/></button></div><div className="storage-session-tool"><span><strong>{c.storageWrite}</strong><small>{c.storageWriteDesc}</small></span><label className="storage-write-limit"><input type="number" min={1} max={20} value={storagePermissions.maxFiles} aria-label={c.storageWriteLimit} onChange={event=>storagePermissions.setMaxFiles(Number(event.target.value))}/><small>{c.storageWriteLimit}</small></label><button type="button" role="switch" aria-label={c.storageWrite} aria-checked={storagePermissions.write} className={`toggle ${storagePermissions.write?"on":""}`} onClick={()=>storagePermissions.setWrite(!storagePermissions.write)}><i/></button></div></div>}</section>
            <p>{c.tools}</p>
            <section className="composer-tool-group"><button type="button" aria-expanded={toolGroups.internet} onClick={()=>toggleToolGroup("internet")}><span>{c.internetGroup}</span><ChevronDown size={14}/></button>{toolGroups.internet&&<div><div className="tool-toggle-row"><Globe2 size={17} /><span><strong>{c.internetSearch}</strong><small>{c.internetSearchDesc}</small></span><button type="button" role="switch" aria-label={c.internetSearch} aria-checked={internetSearchEnabled} className={`toggle ${internetSearchEnabled ? "on" : ""}`} onClick={() => setInternetSearchEnabled(!internetSearchEnabled)}><i /></button></div><div className="tool-toggle-row"><Link2 size={17} /><span><strong>{c.pageVisit}</strong><small>{c.pageVisitDesc}</small></span><button type="button" role="switch" aria-label={c.pageVisit} aria-checked={pageVisitEnabled} className={`toggle ${pageVisitEnabled ? "on" : ""}`} onClick={() => setPageVisitEnabled(!pageVisitEnabled)}><i /></button></div></div>}</section>
            <section className="composer-tool-group"><button type="button" aria-expanded={toolGroups.awareness} onClick={()=>toggleToolGroup("awareness")}><span>{c.awarenessGroup}</span><ChevronDown size={14}/></button>{toolGroups.awareness&&<div><div className="tool-toggle-row"><Clock3 size={17} /><span><strong>{c.currentTime}</strong><small>{c.currentTimeDesc}</small></span><button type="button" role="switch" aria-label={c.currentTime} aria-checked={currentTimeEnabled} className={`toggle ${currentTimeEnabled ? "on" : ""}`} onClick={() => setCurrentTimeEnabled(!currentTimeEnabled)}><i /></button></div><div className="tool-toggle-row"><MapPin size={17} /><span><strong>{c.locationTool}</strong><small>{c.locationToolDesc}</small></span><button type="button" role="switch" aria-label={c.locationTool} aria-checked={locationEnabled} className={`toggle ${locationEnabled ? "on" : ""}`} onClick={() => setLocationEnabled(!locationEnabled)}><i /></button></div></div>}</section>
            {(browserToolAvailable || hostComputerToolAvailable) && <section className="composer-tool-group"><button type="button" aria-expanded={toolGroups.agent} onClick={()=>toggleToolGroup("agent")}><span>{c.agentGroup}</span><ChevronDown size={14}/></button>{toolGroups.agent&&<div>{browserToolAvailable && <div className="tool-toggle-row"><Monitor size={17} /><span><strong>{c.browserTool}</strong><small>{c.browserToolDesc}</small></span><button type="button" role="switch" aria-label={c.browserTool} aria-checked={browserEnabled} className={`toggle ${browserEnabled ? "on" : ""}`} onClick={() => setBrowserEnabled(!browserEnabled)}><i /></button></div>}{hostComputerToolAvailable && <div className="tool-toggle-row"><HardDrive size={17} /><span><strong>{c.hostComputerTool}</strong><small>{c.hostComputerToolDesc}</small></span><button type="button" role="switch" aria-label={c.hostComputerTool} aria-checked={hostComputerEnabled} className={`toggle ${hostComputerEnabled ? "on" : ""}`} onClick={() => setHostComputerEnabled(!hostComputerEnabled)}><i /></button></div>}</div>}</section>}
            <section className="composer-tool-group"><button type="button" aria-expanded={toolGroups.interaction} onClick={()=>toggleToolGroup("interaction")}><span>{c.interactionGroup}</span><ChevronDown size={14}/></button>{toolGroups.interaction&&<div><div className="tool-toggle-row"><ListChecks size={17} /><span><strong>{c.multipleChoice}</strong><small>{c.multipleChoiceDesc}</small></span><button type="button" role="switch" aria-label={c.multipleChoice} aria-checked={multipleChoiceEnabled} className={`toggle ${multipleChoiceEnabled ? "on" : ""}`} onClick={() => setMultipleChoiceEnabled(!multipleChoiceEnabled)}><i /></button></div><div className="tool-toggle-row"><Code2 size={17}/><span><strong>{c.artifact}</strong><small>{c.artifactDesc}</small></span><button type="button" role="switch" aria-label={c.artifact} aria-checked={artifactEnabled} className={`toggle ${artifactEnabled?"on":""}`} onClick={()=>setArtifactEnabled(!artifactEnabled)}><i/></button></div></div>}</section>
            {mcpConnections.length>0&&<section className="composer-tool-group mcp-tool-group"><button type="button" aria-expanded={toolGroups.mcp} onClick={()=>toggleToolGroup("mcp")}><span>MCP</span><ChevronDown size={14}/></button>{toolGroups.mcp&&<div>{mcpConnections.map(connection=><McpComposerConnection key={connection.id} connection={connection} enabled={mcpConnectionIds.includes(connection.id)} selectedNames={mcpToolNames[connection.id]} onEnabled={value=>setMcpConnectionIds(value?[...mcpConnectionIds,connection.id]:mcpConnectionIds.filter(id=>id!==connection.id))} onSelected={names=>setMcpToolNames(connection.id,names)} c={c}/>)}</div>}</section>}
          </div>}
        </div>
        {attachments.length > 0 && <small className="attachment-count">{attachments.length} {c.imagesAttached}</small>}
        {activeToolCount > 0 && <small className="enabled-tools"><Wrench size={11} />{activeToolCount}</small>}
      </div>
      <div className="composer-field">
        <span className="composer-measure" ref={measureRef} aria-hidden="true">{draft || " "}</span>
        <textarea ref={textRef} aria-label={pendingInput ? c.choiceWaiting : c.messagePlaceholder} enterKeyHint="enter" rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={keyDown} onPaste={(event) => {
          const images = clipboardImages(event.clipboardData);
          if (!images.length) return;
          event.preventDefault();
          if (!uploadingImages && !pendingInput && selectedModel?.imageInput !== false) onFiles(images);
        }} placeholder={pendingInput ? c.choiceWaiting : c.messagePlaceholder} disabled={Boolean(pendingInput)} />
      </div>
      <div className="composer-trail" ref={trailRef}>
        <ContextWindowIndicator c={c} locale={locale} model={selectedModel} models={models} usage={contextBreakdown} includeReasoning={sendReasoning} harnessSettings={harnessSettings} />
        <div className="preset-switcher">
          <button type="button" className="preset-trigger" disabled={!selectedModel?.reasoningPresets.length} onClick={() => setPresetOpen(!presetOpen)}><Lightbulb size={16} /><span>{selectedPreset?.name || c.default}</span><ChevronDown size={14} className={presetOpen ? "rotate" : ""} /></button>
          {presetMounted && <div className={`popover preset-popover ${aliasBasePicker ? "with-alias-base" : ""} ${presetClosing ? "closing" : ""}`}>
            <p>{c.reasoningPreset}</p>
            {selectedModel?.reasoningPresets.map((preset) => { const note = appearance.showReasoningNotes ? reasoningNote(preset.effort, appearance, locale) : ""; return <button type="button" key={preset.id} onClick={() => { setPreset(preset.id); setPresetOpen(false); }}><span className="selection-dot">{preset.id === selectedPreset?.id && <Check size={12} />}</span><span>{preset.name}<small>{note || (preset.kind === "builtin" ? `${c.native} · ${preset.effort || c.default}` : `${c.template}${preset.effort ? ` · ${preset.effort}` : ""}`)}</small></span></button>; })}
            {aliasBasePicker && <section className="alias-base-picker"><header><strong>{c.aliasBaseModel}</strong><small>{c.aliasBaseModelDesc}</small></header>{aliasBasePicker.models.map(model => { const weight = aliasBasePicker.weights?.[model.id]; const weightHint = weight ? c.modelWeightHint.replace("{weight}", formatModelWeight(weight)) : ""; const connectionName = aliasBasePicker.showConnectionNames ? connectionForModel(aliasBasePicker.connections as ConnectionConfig[], model)?.name : undefined; const location = [connectionName, model.description].filter(Boolean).join(" · "); return <button type="button" className="model-option" key={model.id} onClick={() => aliasBasePicker.onSelect(model)}><span className="selection-dot">{model.id === aliasBasePicker.selected?.id && <Check size={13} />}</span><span><strong>{model.name}</strong>{aliasBasePicker.showIdentifiers && <small>{model.sourceModel}</small>}{location && <em>{location}</em>}</span>{(model.imageGeneration||weight)&&<span className="model-option-badges"><ModelImageBadge model={model} c={c}/>{weight && <b className="model-weight-badge" data-tooltip={weightHint} aria-label={weightHint}>x{formatModelWeight(weight)}</b>}</span>}</button>; })}<button type="button" className="default-choice-action" disabled={!aliasBasePicker.selected || aliasBasePicker.defaultId === aliasBasePicker.selected.id} onClick={aliasBasePicker.onDefault}><Check size={14} />{aliasBasePicker.defaultId === aliasBasePicker.selected?.id ? c.defaultAliasBaseActive : c.useAsDefault}</button></section>}
            <div className="reasoning-send-toggle"><span><strong>{c.sendPriorReasoning}</strong><small>{c.sendPriorReasoningDesc}</small></span><button type="button" role="switch" aria-label={c.sendPriorReasoning} aria-checked={sendReasoning} className={`toggle ${sendReasoning ? "on" : ""}`} onClick={() => toggleSendReasoning(!sendReasoning)}><i /></button></div>
            <button type="button" className="default-choice-action" disabled={!selectedPreset || defaultReasoningPresetId === selectedPreset.id} onClick={setDefaultReasoning}><Check size={14} />{defaultReasoningPresetId === selectedPreset?.id ? c.defaultReasoningActive : c.useAsDefault}</button>
            {admin && <button type="button" className="default-choice-action" disabled={!selectedPreset || applyingReasoningDefault} onClick={applyReasoningToEveryone}>{applyingReasoningDefault ? <LoaderCircle className="spin" size={14} /> : <Users size={14} />}{applyingReasoningDefault ? c.applyingToEveryone : c.applyToEveryone}</button>}
          </div>}
        </div>
        <button className={`send-button ${showStop ? "stopping" : ""}`} type="submit" disabled={!showStop && (uploadingImages || Boolean(pendingInput))} aria-label={showStop ? c.stop : pendingInput ? c.choiceWaiting : isGenerating ? c.addToQueue : c.send}>{showStop ? <Square size={14} fill="currentColor" /> : <ArrowUp size={20} />}</button>
      </div>
    </form>
    <p className="composer-note">{c.disclaimer}</p>
  </div>;
}

function CodeSnippet({ c, children, fadeDurationMs = 0 }: { c: CopySet; children: ReactNode; fadeDurationMs?: number }) {
  const [wrapping, setWrapping] = useState(false);
  const [copied, setCopied] = useState(false);
  const previousCode = useRef("");
  const codeElement = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
  const code = String(codeElement?.props.children ?? children).replace(/\n$/, "");
  const language = codeElement?.props.className?.match(/language-([^\s]+)/)?.[1];
  const fadeFrom = fadeDurationMs > 0 && code.startsWith(previousCode.current) ? previousCode.current.length : code.length;
  useLayoutEffect(() => { previousCode.current = code; }, [code]);

  async function copySnippet() {
    if (await copyTextToClipboard(code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  return <div className={`code-snippet ${wrapping ? "wrap" : ""}`}>
    <div className="code-snippet-toolbar">
      <span className="code-language">{language || "code"}</span>
      <div className="code-snippet-actions">
        <label><span>{c.useWrapping}</span><button type="button" role="switch" aria-label={c.useWrapping} aria-checked={wrapping} className={`toggle code-wrap-toggle ${wrapping ? "on" : ""}`} onClick={() => setWrapping((value) => !value)}><i /></button></label>
        <button type="button" className="copy-snippet" onClick={() => void copySnippet()} aria-label={c.copy} title={c.copy}>{copied ? <Check size={13} /> : <Copy size={13} />}<span>{copied ? c.copied : c.copy}</span></button>
      </div>
    </div>
    <pre className={fadeFrom < code.length ? "syntax-streaming" : undefined} style={{ "--stream-fade-duration": `${fadeDurationMs}ms` } as CSSProperties}><SyntaxHighlightedCode code={code} language={language} className={codeElement?.props.className} /></pre>
  </div>;
}

function McpComposerConnection({connection,enabled,selectedNames,onEnabled,onSelected,c}:{connection:McpConnection;enabled:boolean;selectedNames?:string[];onEnabled:(value:boolean)=>void;onSelected:(names:string[])=>void;c:CopySet}){
  const[open,setOpen]=useState(false),[tools,setTools]=useState<McpToolInfo[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState("");
  useEffect(()=>{if(!open||tools.length||loading)return;setLoading(true);void fetch(`/api/mcp-connections/${connection.id}/tools`,{cache:"no-store"}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error);const next:McpToolInfo[]=body.tools;setTools(next);if(selectedNames===undefined)onSelected(next.filter(tool=>tool.policy!=="blocked").map(tool=>tool.name));}).catch(caught=>setError(caught instanceof Error?caught.message:String(caught))).finally(()=>setLoading(false));},[open,tools.length,loading,connection.id,onSelected,selectedNames]);
  const selected=selectedNames||tools.filter(tool=>tool.policy!=="blocked").map(tool=>tool.name);
  return <div className={`mcp-composer-entry ${open?"open":""}`}><div className="tool-toggle-row"><Cable size={17}/><span><strong>{connection.name}</strong><small>{connection.description||connection.url}</small></span><button className="mcp-session-fold" type="button" aria-label={c===translations.ko?`${connection.name} 도구 펼치기`:`Expand ${connection.name} tools`} aria-expanded={open} onClick={()=>setOpen(value=>!value)}><ChevronDown size={15}/></button><button type="button" role="switch" aria-label={connection.name} aria-checked={enabled} className={`toggle ${enabled?"on":""}`} onClick={()=>onEnabled(!enabled)}><i/></button></div>{open&&<div className="mcp-session-tools">{loading&&<p><LoaderCircle className="spin" size={14}/>{c===translations.ko?"도구를 불러오는 중":"Loading tools"}</p>}{error&&<p className="error">{error}</p>}{tools.map(tool=>{const active=enabled&&tool.policy!=="blocked"&&selected.includes(tool.name);return <div className="mcp-session-tool" key={tool.name}><span><strong>{tool.name}</strong><small>{tool.policy==="blocked"?(c===translations.ko?"설정에서 차단됨":"Blocked in settings"):tool.description||"MCP"}</small></span><button type="button" role="switch" disabled={!enabled||tool.policy==="blocked"} aria-label={tool.name} aria-checked={active} className={`toggle ${active?"on":""}`} onClick={()=>onSelected(active?selected.filter(name=>name!==tool.name):[...selected,tool.name])}><i/></button></div>})}</div>}</div>;
}

function useLongPress(onLongPress: () => void, disabled = false) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled || event.pointerType === "mouse") return;
      origin.current = { x: event.clientX, y: event.clientY };
      cancel();
      timer.current = setTimeout(() => { navigator.vibrate?.(20); onLongPress(); timer.current = null; }, 520);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 12) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => event.preventDefault(),
  };
}

function MobileMessageActions({ c, locale, role, canCopy, onClose, onRegenerate, onEdit, onCopy, onDelete }: { c: CopySet; locale: Locale; role: StoredMessage["role"]; canCopy: boolean; onClose: () => void; onRegenerate: () => void; onEdit: () => void; onCopy: () => void; onDelete?: () => void }) {
  // The sheet announced itself as a modal dialog without behaving like one. It takes the same
  // trap, Escape and inert background as every other dialog in the app.
  const { ref, close, closing } = useModalTransition(onClose);
  return <div ref={ref} tabIndex={-1} className={`mobile-message-action-layer ${closing ? "modal-closing" : ""}`} role="dialog" aria-modal="true" aria-label={locale === "ko" ? "메시지 작업" : "Message actions"}>
    <button className="mobile-message-action-scrim" tabIndex={-1} aria-label={c.cancel} onClick={() => close()} />
    <section className="mobile-message-action-sheet">
      <header><span>{role === "user" ? (locale === "ko" ? "내 메시지" : "Your message") : (locale === "ko" ? "모델 응답" : "Model response")}</span><button onClick={() => close()} aria-label={c.cancel}><X size={18} /></button></header>
      <button onClick={onRegenerate}><RefreshCw size={18} /><span>{role === "user" ? c.regenerateRequest : c.regenerate}</span></button>
      <button onClick={onEdit}><Pencil size={18} /><span>{role === "user" ? c.editBranch : c.editResponse}</span></button>
      {canCopy && <button onClick={onCopy}><Copy size={18} /><span>{c.copy}</span></button>}
      {onDelete && <button className="danger" onClick={onDelete}><Trash2 size={18} /><span>{c.deleteMessage}</span></button>}
    </section>
  </div>;
}

function MessageTokenStats({ c, locale, message }: { c: CopySet; locale: Locale; message: StoredMessage }) {
  if (message.outputTokens === undefined) return null;
  const rate = message.completionDurationSeconds && message.completionDurationSeconds > 0
    ? message.outputTokens / message.completionDurationSeconds
    : undefined;
  return <small className="message-token-stats">
    <span>{formatTokens(message.outputTokens, locale)} {c.outputTokens}</span>
    {message.reasoningTokens ? <span>({formatTokens(message.reasoningTokens, locale)} {c.reasoningTokens})</span> : null}
    {rate !== undefined ? <><i>·</i><span className="token-rate" tabIndex={0} aria-label={`${rate.toFixed(1)} ${c.tokensPerSecond}${message.timeToFirstTokenSeconds !== undefined ? `, ${c.timeToFirstToken}: ${formatLatency(message.timeToFirstTokenSeconds)}` : ""}`}><span>{rate.toFixed(1)} {c.tokensPerSecond}</span><span className="token-rate-tooltip" role="tooltip"><strong>{rate.toFixed(1)} {c.tokensPerSecond}</strong>{message.timeToFirstTokenSeconds !== undefined && <small>{c.timeToFirstToken}: {formatLatency(message.timeToFirstTokenSeconds)}</small>}</span></span></> : null}
  </small>;
}

function StructuredJson({ value }: { value: unknown }) {
  return <pre className="structured-json"><code>{JSON.stringify(value ?? {}, null, 2)}</code></pre>;
}

function MultipleChoiceComposer({ c, event, onSubmit }: { c: CopySet; event: ToolEvent; onSubmit: (value: unknown) => Promise<boolean> }) {
  const args = event.arguments && typeof event.arguments === "object" ? event.arguments as { questions?: MultipleChoiceQuestion[] } : {};
  const questions = args.questions || [];
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [advancing, setAdvancing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const keyFor = (question: MultipleChoiceQuestion, index: number) => question.id || `question-${index + 1}`;
  const question = questions[currentIndex];
  if (!question) return null;
  const currentKey = keyFor(question, currentIndex);
  const selected = answers[currentKey] || [];
  const directAnswer = other[currentKey] || "";
  const hasAnswer = selected.length > 0 || Boolean(directAnswer.trim());

  function payload(answerValues = answers, otherValues = other) {
    return { answers: questions.map((item, index) => { const key = keyFor(item, index); return { question: item.question, type: item.type, selections: answerValues[key] || [], ...(otherValues[key]?.trim() ? { other: otherValues[key].trim() } : {}) }; }) };
  }
  async function submit(answerValues = answers, otherValues = other) {
    setSubmitting(true);
    if (!await onSubmit(payload(answerValues, otherValues))) setSubmitting(false);
  }
  function moveForward(answerValues = answers, otherValues = other) {
    const values = answerValues[currentKey] || [];
    if (!values.length && !otherValues[currentKey]?.trim()) return;
    if (currentIndex === questions.length - 1) { void submit(answerValues, otherValues); return; }
    setDirection("forward"); setCurrentIndex((value) => value + 1);
  }
  function choose(option: string) {
    const current = answers[currentKey] || [];
    const nextSelections = question.type === "single_select" ? [option] : current.includes(option) ? current.filter((item) => item !== option) : [...current, option];
    const nextAnswers = { ...answers, [currentKey]: nextSelections };
    setAnswers(nextAnswers);
    if (question.type === "single_select") {
      if (currentIndex === questions.length - 1) { void submit(nextAnswers, other); return; }
      setAdvancing(true);
      window.setTimeout(() => { setDirection("forward"); setCurrentIndex((value) => value + 1); setAdvancing(false); }, 160);
    }
  }
  return <section className="choice-composer-card" aria-label={c.multipleChoice}>
    <header>
      <button type="button" aria-label={c.choiceBack} disabled={currentIndex === 0 || submitting} onClick={() => { setDirection("back"); setCurrentIndex((value) => Math.max(0, value - 1)); }}><ChevronLeft size={18} /></button>
      <span>{c.choiceProgress} {currentIndex + 1} / {questions.length}</span>
      <div className="choice-progress" aria-hidden="true">{questions.map((_, index) => <i className={index === currentIndex ? "active" : index < currentIndex ? "done" : ""} key={index} />)}</div>
    </header>
    <fieldset className={`choice-slide slide-${direction}`} key={currentKey} disabled={submitting || advancing}>
      <legend>{question.question}</legend>
      <div className="choice-options">{question.options.map((option, optionIndex) => { const rank = selected.indexOf(option); return <button type="button" key={option} className={rank >= 0 ? "selected" : ""} onClick={() => choose(option)}><i>{rank >= 0 ? question.type === "rank_priorities" ? rank + 1 : <Check size={14} /> : optionIndex + 1}</i><span>{option}</span>{question.type === "single_select" && <ChevronRight size={16} />}</button>; })}</div>
      <label className="choice-other"><Pencil size={15} /><input value={directAnswer} onChange={(changeEvent) => setOther((value) => ({ ...value, [currentKey]: changeEvent.target.value }))} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" && !keyEvent.shiftKey) { keyEvent.preventDefault(); moveForward(); } }} placeholder={c.otherChoice} /></label>
    </fieldset>
    <footer><button type="button" className="choice-submit" disabled={!hasAnswer || submitting || advancing} onClick={() => moveForward()}>{submitting ? <LoaderCircle className="spin" size={15} /> : currentIndex === questions.length - 1 ? <Check size={15} /> : <ChevronRight size={16} />}{currentIndex === questions.length - 1 ? c.submitChoices : c.choiceNext}</button></footer>
  </section>;
}

function MultipleChoiceResponse({ event }: { event: ToolEvent }) {
  const answers = multipleChoiceAnswers(event);
  if (!answers.length) return null;
  return <div className="choice-response-row"><div className="choice-response-bubble">{answers.map((answer, index) => {
    const selections = answer.type === "rank_priorities" ? answer.selections.map((selection, rank) => `${rank + 1}. ${selection}`) : answer.selections;
    const response = [...selections, ...(answer.other ? [answer.other] : [])].join(" · ") || "—";
    return <div key={`${answer.question}-${index}`}><small>{answer.question}</small><strong>{response}</strong></div>;
  })}</div></div>;
}

function HostApprovalComposer({ c, event, onSubmit }: { c: CopySet; event: ToolEvent; onSubmit: (value: unknown) => Promise<boolean> }) {
  const args = event.arguments && typeof event.arguments === "object" ? event.arguments as Record<string, unknown> : {};
  const authorization = args.authorization && typeof args.authorization === "object" ? args.authorization as Record<string, unknown> : {};
  const [redirecting, setRedirecting] = useState(false); const [instruction, setInstruction] = useState(""); const [submitting, setSubmitting] = useState(false);
  const submit = async (decision: "approve" | "reject" | "redirect") => { setSubmitting(true); if (!await onSubmit({ decision, ...(decision === "redirect" ? { instruction: instruction.trim() } : {}) })) setSubmitting(false); };
  return <section className="choice-composer-card host-approval-card" aria-label={c.hostApprovalTitle}>
    <header><span><ShieldAlert size={15} />{c.hostApprovalTitle}</span><strong>{c.hostRiskLevel} {Number(authorization.riskLevel || 5)} / 5</strong></header>
    <div className="host-approval-body"><p>{String(authorization.explanation || "")}</p><details><summary>{c.toolCall}</summary><StructuredJson value={Object.fromEntries(Object.entries(args).filter(([key]) => key !== "authorization"))} /></details></div>
    {redirecting && <label className="choice-other"><Pencil size={15} /><input autoFocus value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={c.hostRedirectPlaceholder} onKeyDown={event => { if (event.key === "Enter" && instruction.trim()) { event.preventDefault(); void submit("redirect"); } }} /></label>}
    <footer className="host-approval-actions"><button type="button" disabled={submitting} onClick={() => void submit("approve")}><Check size={15} />{c.hostApprove}</button><button type="button" disabled={submitting} onClick={() => void submit("reject")}><X size={15} />{c.hostReject}</button><button type="button" disabled={submitting || redirecting && !instruction.trim()} onClick={() => redirecting ? void submit("redirect") : setRedirecting(true)}><Pencil size={15} />{c.hostRedirect}</button></footer>
  </section>;
}

function ToolEventIcon({ name, size = 15 }: { name: string; size?: number }) {
  const Icon = name === "internet_search" ? Search : name === "visit_page" ? Link2 : name === "browser" ? Monitor : name === "host_computer" ? HardDrive : name === "get_current_time" ? Clock3 : name === "get_current_location" ? LocateFixed : name === "ask_multiple_choice" ? ListChecks:name==="create_artifact"?Code2 : Wrench;
  return <Icon size={size} />;
}

function ToolActivity({ c, locale, event }: { c: CopySet; locale: Locale; event: ToolEvent }) {
  const active = event.status === "calling" || event.status === "waiting";
  const resultRecord=event.result&&typeof event.result==="object"?event.result as Record<string,unknown>:undefined;
  const candidate=resultRecord?.attachment&&typeof resultRecord.attachment==="object"?resultRecord.attachment as Partial<StoredAttachment>:undefined;
  const attachment=candidate?.id&&candidate.url&&candidate.name&&candidate.mimeType&&typeof candidate.size==="number"?candidate as StoredAttachment:undefined;
  return <details className={`tool-activity ${event.status}`} open={active}>
    <summary className="tool-activity-summary">
      <ChevronRight size={14} className="tool-chevron" />
      <span className="tool-event-icon"><ToolEventIcon name={event.name} /></span>
      <strong>{getToolStatusLabel(event.name, event.status, locale)}</strong>
      <span className="tool-status-dot" aria-hidden="true" />
    </summary>
    <div className="tool-activity-body">
      <details open><summary>{c.toolCall}</summary><StructuredJson value={event.arguments} /></details>
      {event.status === "waiting" && event.name === "get_current_location" && <p className="location-wait"><LoaderCircle className="spin" size={14} />{c.locationPermission}</p>}
      {attachment && <AttachmentGrid attachments={[attachment]} />}
      {event.result !== undefined && <details open><summary>{c.toolResult}</summary><StructuredJson value={event.result} /></details>}
    </div>
  </details>;
}

function ToolActivityGroup({ c, locale, events }: { c: CopySet; locale: Locale; events: ToolEvent[] }) {
  const state = getToolGroupState(events);
  const label = getToolGroupLabel(events, locale);
  return <details className={`tool-activity-group ${state}`}>
    <summary aria-label={label}>
      <span className="tool-group-icon"><Wrench size={16} /></span>
      <strong>{label}</strong>
      <ChevronDown size={14} className="tool-group-chevron" />
    </summary>
    <div className="tool-activity-list" aria-label={locale === "ko" ? "도구 호출 목록" : "Tool call list"}>
      {events.map((event) => <ToolActivity key={event.id} c={c} locale={locale} event={event} />)}
    </div>
  </details>;
}

function renderedText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return renderedText(node.props.children);
  return "";
}

function McpApprovalComposer({c,event,onSubmit}:{c:CopySet;event:ToolEvent;onSubmit:(value:unknown)=>Promise<boolean>}){
  const args=event.arguments&&typeof event.arguments==="object"?event.arguments as Record<string,unknown>:{};
  const approval=args._mcpApproval&&typeof args._mcpApproval==="object"?args._mcpApproval as Record<string,unknown>:{};
  const[submitting,setSubmitting]=useState(false);const submit=async(decision:"approve"|"reject")=>{setSubmitting(true);if(!await onSubmit({decision}))setSubmitting(false);};
  return <section className="choice-composer-card mcp-approval-card" aria-label={c.mcpApprovalTitle}><header className="mcp-approval-head"><span className="mcp-approval-title"><Cable size={15}/><strong>{c.mcpApprovalTitle}</strong></span><small>{String(approval.connectionName||"MCP")}</small></header><div className="host-approval-body"><p>{c===translations.ko?`“${String(approval.toolName||"")}” 도구 실행을 허용할까요?`:`Allow the “${String(approval.toolName||"")}” tool to run?`}</p>{typeof approval.explanation==="string"&&approval.explanation&&<p className="mcp-approval-explanation">{approval.explanation}</p>}<details><summary>{c.toolCall}</summary><StructuredJson value={Object.fromEntries(Object.entries(args).filter(([key])=>key!=="_mcpApproval"))}/></details></div><footer className="host-approval-actions"><button type="button" disabled={submitting} onClick={()=>void submit("approve")}><Check size={15}/>{c.hostApprove}</button><button type="button" disabled={submitting} onClick={()=>void submit("reject")}><X size={15}/>{c.hostReject}</button></footer></section>;
}

/** Wrap only the appended part of a rendered Markdown block, leaving every settled token alone. */
function fadeAfterOffset(node: ReactNode, offset: number, cursor: { value: number }, durationMs: number, key: { value: number }): ReactNode {
  if (typeof node === "string" || typeof node === "number") {
    const text = String(node), start = cursor.value, end = start + text.length;
    cursor.value = end;
    if (end <= offset || !text) return node;
    const split = Math.max(0, offset - start), prefix = text.slice(0, split), suffix = text.slice(split);
    return <>{prefix}<span key={`stream-${key.value++}`} className="stream-token" style={{ "--stream-fade-duration": `${durationMs}ms` } as CSSProperties}>{suffix}</span></>;
  }
  if (Array.isArray(node)) return Children.map(node, child => fadeAfterOffset(child, offset, cursor, durationMs, key));
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children !== undefined) {
    return cloneElement(node, undefined, fadeAfterOffset(node.props.children, offset, cursor, durationMs, key));
  }
  return node;
}

function StreamingTextElement({ as, children, fadeDurationMs, ...props }: { as: "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li" | "blockquote" | "td" | "th"; children?: ReactNode; fadeDurationMs: number; [key: string]: unknown }) {
  const previous = useRef("");
  const current = renderedText(children);
  const fadeFrom = fadeDurationMs > 0 && current.startsWith(previous.current) ? previous.current.length : current.length;
  useLayoutEffect(() => { previous.current = current; }, [current]);
  const Tag = as;
  const decorated = fadeFrom < current.length ? fadeAfterOffset(children, fadeFrom, { value: 0 }, fadeDurationMs, { value: 0 }) : children;
  return <Tag {...props}>{decorated}</Tag>;
}

/**
 * Keeps react-markdown's custom element types stable across parent scroll-state renders. Replacing
 * the renderer functions would remount large images; authenticated no-store sources would then be
 * downloaded again, which is especially visible under mobile memory pressure.
 */
function ChatMarkdown({ text, c, renderStrikethrough, onImagePreview, fadeDurationMs = 0 }: { text: string; c: CopySet; renderStrikethrough: boolean; onImagePreview: (value: { src: string; alt: string }) => void; fadeDurationMs?: number }) {
  const sourceRef = useRef(text);
  sourceRef.current = text;
  const components = useMemo(() => ({
    a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
    img: ({ src, alt, ...props }) => {
      const source = typeof src === "string" ? src : "";
      const open = () => source && onImagePreview({ src: source, alt: alt || "" });
      return <img {...props} src={source} alt={alt || ""} role="button" tabIndex={0} className="chat-expandable-image" onClick={open} onKeyDown={event => { if (source && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); open(); } }} />;
    },
    pre: ({ children }) => <CodeSnippet c={c} fadeDurationMs={fadeDurationMs}>{children}</CodeSnippet>,
    p: ({ node: _node, children, ...props }) => <StreamingTextElement as="p" fadeDurationMs={fadeDurationMs} {...props}>{children}</StreamingTextElement>,
    h1: ({ node: _node, children, ...props }) => <StreamingTextElement as="h1" fadeDurationMs={fadeDurationMs} {...props}>{children}</StreamingTextElement>,
    h2: ({ node: _node, children, ...props }) => <StreamingTextElement as="h2" fadeDurationMs={fadeDurationMs} {...props}>{children}</StreamingTextElement>,
    h3: ({ node: _node, children, ...props }) => <StreamingTextElement as="h3" fadeDurationMs={fadeDurationMs} {...props}>{children}</StreamingTextElement>,
    h4: ({ node: _node, children, ...props }) => <StreamingTextElement as="h4" fadeDurationMs={fadeDurationMs} {...props}>{children}</StreamingTextElement>,
    h5: ({ node: _node, children, ...props }) => <StreamingTextElement as="h5" fadeDurationMs={fadeDurationMs} {...props}>{children}</StreamingTextElement>,
    h6: ({ node: _node, children, ...props }) => <StreamingTextElement as="h6" fadeDurationMs={fadeDurationMs} {...props}>{children}</StreamingTextElement>,
    li: ({ node: _node, children, ...props }) => <StreamingTextElement as="li" fadeDurationMs={fadeDurationMs} {...props}>{children}</StreamingTextElement>,
    blockquote: ({ node: _node, children, ...props }) => <StreamingTextElement as="blockquote" fadeDurationMs={fadeDurationMs} {...props}>{children}</StreamingTextElement>,
    td: ({ node: _node, children, ...props }) => <StreamingTextElement as="td" fadeDurationMs={fadeDurationMs} {...props}>{children}</StreamingTextElement>,
    th: ({ node: _node, children, ...props }) => <StreamingTextElement as="th" fadeDurationMs={fadeDurationMs} {...props}>{children}</StreamingTextElement>,
    del: ({ node, children, ...props }) => renderStrikethrough ? <del {...props}>{children}</del> : <>{literalStrikethroughSource(sourceRef.current, node, String(children))}</>,
  } satisfies Components), [c, fadeDurationMs, onImagePreview, renderStrikethrough]);
  return <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: true }], remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>{text}</ReactMarkdown>;
}

function Message({ c, locale, message, waitPhase, waitProgress, renderStrikethrough, appearance, pending, revisions, onFork, onEditAssistant,onEditArtifact, onRegenerate, onRegenerateUser, onDeleteUser, onRevision }: { c: CopySet; locale: Locale; message: StoredMessage; waitPhase?: ChatWaitPhase; waitProgress?: number; renderStrikethrough: boolean; appearance: AppearancePreferences; pending: boolean; revisions: MessageRevision[]; onFork: (id: string, text: string) => void; onEditAssistant: (id: string, text: string) => void;onEditArtifact:(eventId:string,artifact:ArtifactDocument)=>void; onRegenerate: (id: string) => void; onRegenerateUser: (id: string) => void; onDeleteUser: (id: string) => void; onRevision: (branchId: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [imagePreview,setImagePreview]=useState<{src:string;alt:string}>();
  const isThinking = pending && Boolean(message.reasoning) && message.reasoningDurationSeconds === undefined;
  const displayedReasoning = formatReasoningForDisplay(message.reasoning || "", message.toolEvents || [], locale);
  const waitingForChoice = (message.toolEvents || []).some((event) => (["ask_multiple_choice", "host_computer"].includes(event.name)||event.name.startsWith("mcp_")) && event.status === "waiting");
  const longPress = useLongPress(() => setMobileActionsOpen(true), pending || editing);
  const copyMessage = async () => { await copyTextToClipboard(message.content); setMobileActionsOpen(false); };
  const editMessage = () => { setMobileActionsOpen(false); setEditing(true); };
  const regenerateMessage = () => { setMobileActionsOpen(false); message.role === "user" ? onRegenerateUser(message.id) : onRegenerate(message.id); };
  const actions = mobileActionsOpen && typeof document !== "undefined"
    ? createPortal(<MobileMessageActions c={c} locale={locale} role={message.role} canCopy={Boolean(message.content)} onClose={() => setMobileActionsOpen(false)} onRegenerate={regenerateMessage} onEdit={editMessage} onCopy={() => void copyMessage()} onDelete={message.role === "user" ? () => { setMobileActionsOpen(false); onDeleteUser(message.id); } : undefined} />, document.body)
    : null;

  if (message.role === "user") return <div className="message-row user-message"><div className="user-message-actions"><div className="user-message-toolbar"><button title={c.regenerateRequest} aria-label={c.regenerateRequest} onClick={() => onRegenerateUser(message.id)}><RefreshCw size={13} /></button>{message.content && <button title={c.copy} aria-label={c.copy} onClick={() => void copyTextToClipboard(message.content)}><Copy size={13} /></button>}<button title={c.editBranch} aria-label={c.editBranch} onClick={() => setEditing(true)}><Pencil size={13} /></button><button className="delete" title={c.deleteMessage} aria-label={c.deleteMessage} onClick={() => onDeleteUser(message.id)}><Trash2 size={13} /></button></div><div className="user-message-stack long-press-target" {...longPress}><div className="user-message-content">{message.attachments?.length ? <AttachmentGrid attachments={message.attachments} /> : null}{message.content && <div className="message-bubble">{message.content}</div>}</div><RevisionNavigator c={c} messageId={message.id} revisions={revisions} onRevision={onRevision} /></div></div>{editing && <TextDialog ko={locale === "ko"} title={c.editMessage} value={message.content} multiline saveLabel={c.forkSend} saveIcon={<GitBranch size={14} />} cancelLabel={c.cancel} preface={message.attachments?.length ? <AttachmentGrid attachments={message.attachments} /> : null} onClose={() => setEditing(false)} onSave={(value) => { if (value !== message.content) onFork(message.id, value); setEditing(false); }} />}{actions}</div>;
  const steps = transcriptSteps(message);
  const liveContentIndex = lastContentStep(steps);
  const wholeReasoning = reasoningStepIsWhole(message);
  const waitStatus = pending && waitPhase ? <div className="chat-wait-status" role="status" aria-live="polite">{waitProgress !== undefined && ["donut", "both"].includes(appearance.lmStudioProgress) ? <svg className="status-donut" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" /><circle cx="10" cy="10" r="8" pathLength="100" strokeDasharray={`${waitProgress} 100`} /></svg> : <LoaderCircle className="spin" size={16} />}<span>{chatWaitLabel(waitPhase, locale)}{waitProgress !== undefined && ["percent", "both"].includes(appearance.lmStudioProgress) && <span className="status-percent"> {waitProgress}%</span>}</span></div> : null;
  return <div className="message-row assistant-message long-press-target" {...longPress}>
    {message.attachments?.length ? <AssistantAttachmentGallery attachments={message.attachments} /> : null}
    {steps.map((step, index) => {
      if (step.kind === "reasoning") return <ReasoningStep key={index} c={c} locale={locale} text={wholeReasoning ? displayedReasoning : step.text} seconds={step.seconds} live={pending && isThinking && index === steps.length - 1} />;
      if (step.kind === "compaction") return <CompactionStep key={index} c={c} locale={locale} step={step} live={pending && index === steps.length - 1 && step.seconds === undefined} />;
      if (step.kind === "tools") {
        const events = stepToolEvents(step.ids, message.toolEvents);
        const tools = events.filter((event) => !["ask_multiple_choice","create_artifact"].includes(event.name));
        const answered = events.filter((event) => event.name === "ask_multiple_choice" && event.status === "completed");
        const artifacts=events.filter(event=>event.name==="create_artifact"&&event.status==="completed");
        return <div key={index} className="transcript-tools">{tools.length ? <ToolActivityGroup c={c} locale={locale} events={tools} /> : null}{answered.map((event) => <MultipleChoiceResponse key={event.id} event={event} />)}{artifacts.map(event=><ArtifactCard key={event.id} event={event} locale={locale} onSave={artifact=>onEditArtifact(event.id,artifact)}/>)}</div>;
      }
      const live = index === liveContentIndex && pending;
      const body = step.text;
      const fadeDurationMs = live && appearance.streamReveal === "fade" ? appearance.streamFadeDurationMs : 0;
      return <div key={index} className="assistant-copy markdown-body">{body ? <ChatMarkdown text={body} c={c} renderStrikethrough={renderStrikethrough} onImagePreview={setImagePreview} fadeDurationMs={fadeDurationMs} /> : null}</div>;
    })}
    {waitStatus}
    {!steps.length && (pending && !waitingForChoice && !waitPhase ? <div className="assistant-copy markdown-body"><span className="typing"><i /><i /><i /></span></div> : null)}
    {editing && <TextDialog ko={locale === "ko"} title={c.editResponse} value={message.content} multiline saveLabel={c.saveEdit} saveIcon={<Check size={14} />} cancelLabel={c.cancel} onClose={() => setEditing(false)} onSave={(value) => { onEditAssistant(message.id, value); setEditing(false); }} />}
    {!pending && <div className="assistant-footer"><div className="assistant-actions"><button className="message-action-button" title={c.regenerate} aria-label={c.regenerate} onClick={() => onRegenerate(message.id)}><RefreshCw size={14} /></button>{message.content && <button className="message-action-button" title={c.copy} aria-label={c.copy} onClick={() => void copyTextToClipboard(message.content)}><Copy size={14} /></button>}<button className="message-action-button" title={c.editResponse} aria-label={c.editResponse} onClick={() => setEditing(true)}><Pencil size={14} /></button></div><RevisionNavigator c={c} messageId={message.id} revisions={revisions} onRevision={onRevision} /><MessageTokenStats c={c} locale={locale} message={message} /></div>}
    {actions}{imagePreview&&<ImageLightbox src={imagePreview.src} alt={imagePreview.alt} onClose={()=>setImagePreview(undefined)}/>}
  </div>;
}

function ReasoningStep({ c, locale, text, seconds, live }: { c: CopySet; locale: Locale; text: string; seconds?: number; live: boolean }) {
  const [open, setOpen] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const autoFollowRef = useRef(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && autoFollowRef.current && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [live, text]);
  function handleScroll() {
    if (!live || !bodyRef.current) return;
    const following = isNearScrollBottom(bodyRef.current, 24);
    autoFollowRef.current = following;
    setAutoFollow(following);
  }
  function resumeAutoFollow() {
    autoFollowRef.current = true;
    setAutoFollow(true);
    if (bodyRef.current) bodyRef.current.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }
  const shown = live || open;
  return <div className={`thinking-block ${live ? "streaming" : ""}`}>
    <button onClick={() => !live && setOpen((value) => !value)} aria-expanded={shown}><Lightbulb size={15} /> {live ? c.thinking : formatThoughtDuration(seconds || 1, locale)} {!live && <ChevronRight size={14} className={open ? "disclosure-open" : ""} />}</button>
    {shown && <div className="thinking-preview-shell"><div ref={bodyRef} className={`thinking-preview ${live ? "live" : ""}`} onScroll={handleScroll}>{text}</div>{live && !autoFollow && <button type="button" className="scroll-resume reasoning-scroll-resume" title={c.scrollToBottom} aria-label={c.scrollToBottom} onClick={resumeAutoFollow}><ArrowDown size={16} /></button>}</div>}
  </div>;
}

/**
 * A compaction stage. Its fold holds the compaction model's own reasoning and the summary it
 * produced, each in its own small window, so the stage reads like a reasoning block.
 */
function CompactionStep({ c, locale, step, live }: { c: CopySet; locale: Locale; step: Extract<MessageStep, { kind: "compaction" }>; live: boolean }) {
  const [open, setOpen] = useState(false);
  const hasOutput = Boolean(step.reasoning || step.summary);
  const shown = live || open && hasOutput;
  return <div className={`thinking-block compaction-block ${live ? "streaming" : ""}`}>
    <button onClick={() => !live && hasOutput && setOpen((value) => !value)} aria-expanded={shown} disabled={!live && !hasOutput}><Minimize2 size={15} /> {live ? c.compactingNow : formatCompactionDuration(step.seconds || 1, locale)} {!live && hasOutput && <ChevronDown size={14} className={open ? "rotate" : ""} />}</button>
    {shown && <div className="compaction-panes">
      {step.reasoning && <div className="compaction-pane"><small>{c.compactionThought}</small><div className="thinking-preview">{step.reasoning}</div></div>}
      {step.summary && <div className="compaction-pane"><small>{c.compactionSummary}</small><div className="thinking-preview">{step.summary}</div></div>}
      {live && !hasOutput && <div className="compaction-pane"><small>{c.compactionSummary}</small><div className="thinking-preview live"><span className="typing"><i /><i /><i /></span></div></div>}
    </div>}
  </div>;
}

function RevisionNavigator({ c, messageId, revisions, onRevision }: { c: CopySet; messageId: string; revisions: MessageRevision[]; onRevision: (branchId: string) => void }) {
  if (revisions.length < 2) return null;
  const index = Math.max(0, revisions.findIndex((revision) => revision.messageId === messageId));
  return <div className="revision-navigator" aria-label={`${index + 1} / ${revisions.length}`}><button title={c.previousRevision} aria-label={c.previousRevision} disabled={index === 0} onClick={() => onRevision(revisions[index - 1].branchId)}><ChevronLeft size={14} /></button><span>{index + 1} / {revisions.length}</span><button title={c.nextRevision} aria-label={c.nextRevision} disabled={index === revisions.length - 1} onClick={() => onRevision(revisions[index + 1].branchId)}><ChevronRight size={14} /></button></div>;
}

function AttachmentGrid({ attachments }: { attachments: StoredAttachment[] }) {
  const[preview,setPreview]=useState<StoredAttachment>();
  return <><div className={`message-attachments count-${Math.min(attachments.length, 4)}`}>{attachments.map((attachment) => <a className={attachment.mimeType === "application/pdf" ? "pdf-attachment" : ""} href={attachment.url} target="_blank" rel="noreferrer" key={attachment.id} title={attachment.name} onClick={event=>{if(attachment.thumbnailUrl){event.preventDefault();setPreview(attachment);}}}>{attachment.thumbnailUrl ? <img src={attachment.thumbnailUrl} alt={attachment.name} loading="lazy" decoding="async" width={attachment.width} height={attachment.height} /> : <span><FileText size={28} /><strong>{attachment.name}</strong><small>{Math.max(.01, attachment.size / 1024 / 1024).toFixed(2)} MB</small></span>}</a>)}</div>{preview&&<ImageLightbox src={preview.url} alt={preview.name} onClose={()=>setPreview(undefined)}/>}</>;
}

function ExportDialog({ c, conversation, initialIncludeReasoning, onClose, onPreference }: { c: CopySet; conversation?: Conversation; initialIncludeReasoning: boolean; onClose: () => void; onPreference: (value: boolean) => void }) {
  const { ref, close, closing } = useModalTransition(onClose);
  const [includeReasoning, setIncludeReasoning] = useState(initialIncludeReasoning);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  function save(content: BlobPart, type: string, filename: string) {
    const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  }
  // With no chat open the whole history is the subject, and one archive is the only shape that
  // keeps every chat separable afterwards.
  async function downloadArchive() {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/conversations?download=archive&reasoning=${includeReasoning ? "1" : "0"}`, { cache: "no-store" });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || c.exportAllFailed); }
      save(await response.blob(), "application/zip", `neuralnetui-chats-${new Date().toISOString().slice(0, 10)}.zip`);
      onPreference(includeReasoning); close();
    } catch (error) { setNotice(error instanceof Error ? error.message : c.exportAllFailed); }
    finally { setBusy(false); }
  }
  function download(format: "json" | "markdown") {
    if (!conversation) return;
    const active = conversation.branches.find((branch) => branch.id === conversation.activeBranchId) || conversation.branches[0];
    let content: string; let type: string; let extension: string;
    if (format === "json") {
      const exported = { ...conversation, branches: conversation.branches.map((branch) => ({ ...branch, messages: branch.messages.map((message) => includeReasoning ? message : (({ reasoning: _, ...rest }) => rest)(message)) })) };
      content = JSON.stringify(exported, null, 2); type = "application/json"; extension = "json";
    } else {
      content = `# ${conversation.title}\n\nBranch: ${active.name}\n\n` + active.messages.map((message) => `${message.role === "user" ? "## User" : "## Assistant"}\n\n${includeReasoning && message.reasoning ? `> Reasoning\n> ${message.reasoning.replaceAll("\n", "\n> ")}\n\n` : ""}${message.content}`).join("\n\n---\n\n");
      type = "text/markdown"; extension = "md";
    }
    save(content, type, `${conversation.title.replace(/[^a-z0-9가-힣_-]+/gi, "-")}.${extension}`); onPreference(includeReasoning); close();
  }
  return <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={`mini-dialog-layer ${closing ? "modal-closing" : ""}`}><button className="settings-backdrop" onClick={() => close()} /><section className="export-dialog"><header><div><Download size={18} /><h3>{conversation ? c.exportConversation : c.exportAllChats}</h3></div><button onClick={() => close()} aria-label={c.close}><X size={18} /></button></header><p>{conversation ? c.exportDescription : c.exportAllDescription}</p><label className="export-reasoning"><span><strong>{c.includeReasoning}</strong><small>{c.includeReasoningDesc}</small></span><button role="switch" aria-checked={includeReasoning} className={`toggle ${includeReasoning ? "on" : ""}`} onClick={() => setIncludeReasoning(!includeReasoning)}><i /></button></label>{notice && <p className="settings-notice" role="alert">{notice}</p>}<div className="export-actions">{conversation
    ? <><button onClick={() => download("markdown")}><FileText size={17} /> Markdown</button><button onClick={() => download("json")}><FileJson size={17} /> JSON · {c.allBranches}</button></>
    : <button disabled={busy} onClick={() => void downloadArchive()}>{busy ? <LoaderCircle className="spin" size={17} /> : <FileJson size={17} />} {busy ? c.exportingAllChats : c.exportAllChatsAction}</button>}</div></section></div>;
}

function SettingsPanel({ initial, serverStates, onClose, onSaved, onLogout, onAccentPreview }: { initial: PublicConfig; serverStates: Record<string, ServerState>; onClose: () => void; onSaved: (config: PublicConfig) => void; onLogout: () => Promise<void>; onAccentPreview: (hex: string) => void }) {
  const { ref: modalRef, close: closeSettings, closing } = useModalTransition(onClose);
  const admin = initial.account?.role === "admin" || initial.account?.role === "superadmin";
  const initialConnectedModels = connectedModels(initial.models, initial.connections, serverStates);
  const firstEditableModel = initialConnectedModels.find((model) => !model.isAlias || model.ownerId === initial.account?.id) || initialConnectedModels[0];
  const [draft, setDraft] = useState<PublicConfig>(structuredClone(initial)); const [tab, setTab] = useState<SettingsTab>("general"); const [activeModelId, setActiveModelId] = useState(firstEditableModel?.id || ""); const [saving, setSaving] = useState(false); const [detectingConnectionId, setDetectingConnectionId] = useState(""); const [notice, setNotice] = useState(""); const [statusNonce, setStatusNonce] = useState(0);
  const [draftServerStates, setDraftServerStates] = useState(serverStates);
  useEffect(() => setDraftServerStates(serverStates), [serverStates]);
  const availableDraftModels = useMemo(() => connectedModels(draft.models, draft.connections, draftServerStates), [draft.models, draft.connections, draftServerStates]);
  const activeModel = availableDraftModels.find((model) => model.id === activeModelId);
  const c = copyFor(draft.preferences.language || "en");
  const { dialog: detectDialog, notify: notifyDetect } = useMessageDialog(draft.preferences.language === "ko");
  // The footer only offers a save while something actually differs from the saved configuration.
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(draft) !== saved;
  const draftAppearance = draft.preferences.appearance || DEFAULT_APPEARANCE;
  useEffect(() => { onAccentPreview(accentColorOf(draftAppearance)); }, [draftAppearance.accentPalette, draftAppearance.accentColor]);
  useEffect(() => {
    if (!availableDraftModels.some(model => model.id === activeModelId)) setActiveModelId(availableDraftModels[0]?.id || "");
  }, [activeModelId, availableDraftModels]);
  function updateModel(patch: Partial<ModelConfig>) { setDraft((current) => {
    const models = current.models.map(model => model.id === activeModelId ? normalizeReasoning({ ...model, ...patch }) : model);
    const connections = reconcileConnectionEdits(current.connections, models);
    return { ...current, connections, models: resolveConnectionModels(connections as ConnectionConfig[], models.filter(model => model.isAlias), models.map(model => model.id)) };
  }); }
  async function save() { setSaving(true); setNotice(""); try { const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setDraft(body); setSaved(JSON.stringify(body)); onSaved(body); setNotice(c.saved); } catch (error) { setNotice(error instanceof Error ? error.message : "Save failed."); } finally { setSaving(false); } }
  async function detect(connectionId: string) {
    const target = draft.connections.find((connection) => connection.id === connectionId); if (!target) return;
    setDetectingConnectionId(connectionId); setNotice("");
    try {
      const response = await fetch("/api/models/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(target) });
      // A failure arrives as a classified code; an unreadable reply from this app itself is reported the same way.
      const body = await response.json().catch(() => undefined) as { models?: ModelConfig[]; error?: string; code?: unknown; status?: number } | undefined;
      if (!response.ok || !Array.isArray(body?.models)) throw { code: isConnectionFailureCode(body?.code) ? body.code : response.ok ? "invalid-json" : "unexpected", status: body?.status, detail: body?.error || `HTTP ${response.status}` };
      const aliases = draft.models.filter((model) => model.isAlias);
      const detected: ModelConfig[] = body!.models!.map((model: ModelConfig) => {
        const baseIdentifier = model.sourceModel.split(":")[0];
        const previous = reconcileConnectionEdits([target], draft.models)[0].models.find((item) => !item.isAlias && item.sourceModel.split(":")[0] === baseIdentifier);
        return previous ? { ...model, name: previous.name, visible: previous.visible, description: previous.description, systemPrompt: previous.systemPrompt, reasoningPresets: normalizeReasoning({ ...model, reasoningPresets: previous.reasoningPresets }).reasoningPresets, contextWindowTokens: previous.contextWindowTokens, visionImageMode: previous.visionImageMode, visionMaxEdgePixels: previous.visionMaxEdgePixels, imageGeneration: previous.imageGeneration, imageInput: previous.imageInput } : model;
      });
      setDraft((current) => { const connections = current.connections.map((connection) => connection.id === connectionId ? { ...connection, models: detected } : connection); return { ...current, connections, models: resolveConnectionModels(connections as ConnectionConfig[], current.models.filter((model) => model.isAlias), current.models.map((model) => model.id)) }; });
      setActiveModelId(detected[0]?.id || aliases[0]?.id || "");
      setNotice(`${detected.length}${c.detectSaved}`);
    } catch (error) {
      const failure = error && typeof error === "object" && "code" in error ? error as { code: Parameters<typeof describeConnectionFailure>[0]; status?: number; detail?: string } : { code: "unreachable" as const, detail: error instanceof Error ? error.message : String(error) };
      setNotice(c.detectFailedNotice);
      void notifyDetect({ tone: "danger", title: c.detectFailedTitle, message: describeConnectionFailure(failure.code, draft.preferences.language === "ko" ? "ko" : "en"), detail: `${target.name} · ${target.baseUrl}${failure.detail ? `
${c.detectFailedDetail}: ${failure.detail}` : ""}` });
    } finally { setDetectingConnectionId(""); setStatusNonce((value) => value + 1); }
  }
  function addAlias() { const base = availableDraftModels.find((model) => !model.isAlias && model.visible !== false); if (!base) { setNotice(c.detectFirst); return; } const alias: ModelConfig = { ...structuredClone(base), id: uid("alias"), name: draft.preferences.language === "ko" ? "새 커스텀 모델" : "New custom model", isAlias: true, visible: true, systemPrompt: "", contextWindowTokens: undefined, apiContextWindowTokens: undefined, ownerId: initial.account?.id, isPublic: false }; setDraft((current) => ({ ...current, models: [...current.models, alias] })); setActiveModelId(alias.id); setTab("models"); }
  function addPreset() { if (!activeModel) return ""; const preset: ReasoningPreset = { id: uid("preset"), name: draft.preferences.language === "ko" ? "새 템플릿" : "New template", kind: "custom", effort: "", systemPrompt: "", systemPromptMode: "append", ownerId: initial.account?.id }; updateModel({ reasoningPresets: [...activeModel.reasoningPresets, preset] }); return preset.id; }
  function openReasoning() { const visible = availableDraftModels.filter((model) => model.visible !== false); if (!activeModel?.visible) setActiveModelId(visible[0]?.id || ""); setTab("reasoning"); }
  function exportSettings() {
    const content = serializeModelSettings(draft.models, { modelId: draft.preferences.defaultModelId, reasoningPresetId: draft.preferences.defaultReasoningPresetId });
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "neuralnetui-model-settings.json"; anchor.click(); URL.revokeObjectURL(url);
  }
  async function importSettings(file: File) {
    setSaving(true); setNotice("");
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error(c.invalidModelSettings);
      let imported: ReturnType<typeof parseModelSettings>;
      try { imported = parseModelSettings(await file.text()); }
      catch { throw new Error(c.invalidModelSettings); }
      const importedModels = imported.models.map((model) => model.isAlias ? model : { ...model, connectionId: draft.models.find((current) => !current.isAlias && (current.id === model.id || current.sourceModel === model.sourceModel))?.connectionId });
      const next: PublicConfig = { ...draft, models: importedModels, preferences: { ...draft.preferences, defaultModelId: imported.defaults.modelId, defaultReasoningPresetId: imported.defaults.reasoningPresetId } };
      const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || c.invalidModelSettings);
      setDraft(body); setSaved(JSON.stringify(body)); onSaved(body);
      const visible = body.models.filter((model: ModelConfig) => model.visible !== false);
      setActiveModelId(visible.find((model: ModelConfig) => model.id === body.preferences.defaultModelId)?.id || visible[0]?.id || "");
      setNotice(c.importedModelSettings);
    } catch (error) { setNotice(error instanceof Error ? error.message : c.invalidModelSettings); }
    finally { setSaving(false); }
  }
  return createPortal(<div ref={modalRef} tabIndex={-1} className={`settings-layer ${closing ? "modal-closing" : ""}`} role="dialog" aria-modal="true" aria-label={c.settings}>
    <button tabIndex={-1} className="settings-backdrop" onClick={() => closeSettings()} aria-label={c.cancel}/>
    <section className="settings-panel">
      <header><div><span>{c.workspace}</span><h2>{c.settings}</h2></div><button aria-label={c.cancel} onClick={() => closeSettings()}><X size={20}/></button></header>
      <div className="settings-body">
        <nav aria-label={c.settings}>
          <button className={tab==="general"?"active":""} onClick={()=>setTab("general")}><Settings2 size={17}/>{c.general}</button>
          <button className={tab==="appearance"?"active":""} onClick={()=>setTab("appearance")}><Palette size={17}/>{c.appearance}</button>
          {admin&&<button className={tab==="connection"?"active":""} onClick={()=>setTab("connection")}><Server size={17}/>{c.connection}</button>}
          {draft.mcpEntitlement.enabled&&<button className={tab==="mcp"?"active":""} onClick={()=>setTab("mcp")}><Cable size={17}/>{draft.preferences.language==="ko"?"MCP 연결":"MCP connections"}</button>}
          {admin&&<button className={tab==="tools"?"active":""} onClick={()=>setTab("tools")}><Wrench size={17}/>{c.toolsSettings}</button>}
          {admin&&<button className={tab==="experimental"?"active":""} onClick={()=>setTab("experimental")}><FlaskConical size={17}/>{c.experimental}</button>}
          <button className={tab==="models"?"active":""} onClick={()=>setTab("models")}><NeuralMark size={18}/>{c.models}</button>
          <button className={tab==="reasoning"?"active":""} onClick={openReasoning}><Lightbulb size={17}/>{c.reasoningLevel}</button>
          {admin&&<button className={tab==="users"?"active":""} onClick={()=>setTab("users")}><Users size={17}/>{c.users}</button>}
          {admin&&<button className={tab==="plans"?"active":""} onClick={()=>setTab("plans")}><Gauge size={17}/>{draft.preferences.language==="ko"?"플랜":"Plans"}</button>}
          {admin&&<button className={tab==="data"?"active":""} onClick={()=>setTab("data")}><DatabaseBackup size={17}/>{draft.preferences.language==="ko"?"데이터 관리":"Data"}</button>}
          <button className={tab==="account"?"active":""} onClick={()=>setTab("account")}><UserRound size={17}/>{c.account}</button>
        </nav>
        <div className="settings-content">
          {tab==="general"&&<GeneralSettings c={c} draft={draft} setDraft={setDraft} admin={admin} onExport={exportSettings} onImport={importSettings} importing={saving}/>}
          {tab==="appearance"&&<AppearanceSettings c={c} draft={draft} setDraft={setDraft} admin={admin}/>}
          {tab==="connection"&&admin&&<ConnectionSettings c={c} draft={draft} setDraft={setDraft} onDetect={detect} detectingConnectionId={detectingConnectionId} statusNonce={statusNonce} initialServerStates={serverStates} onServerStates={setDraftServerStates}/>}
          {tab==="mcp"&&draft.mcpEntitlement.enabled&&<McpSettings ko={draft.preferences.language==="ko"} connections={draft.mcpConnections} entitlement={draft.mcpEntitlement} onChanged={(connections,entitlement)=>{setDraft(current=>({...current,mcpConnections:connections,mcpEntitlement:entitlement}));onSaved({...initial,mcpConnections:connections,mcpEntitlement:entitlement});}}/>}
          {tab==="tools"&&admin&&<><HarnessSettingsPanel draft={draft} setDraft={setDraft}/><ToolsSettings c={c} draft={draft} setDraft={setDraft}/><StorageSettingsPanel draft={draft} setDraft={setDraft}/></>}
          {tab==="experimental"&&admin&&<ExperimentalSettings c={c} draft={draft} setDraft={setDraft}/>}
          {tab==="models"&&<ModelSettings c={c} draft={draft} availableModels={availableDraftModels} setDraft={setDraft} activeModelId={activeModelId} setActiveModelId={setActiveModelId} activeModel={activeModel} updateModel={updateModel} addAlias={addAlias} account={initial.account}/>}
          {tab==="reasoning"&&<ReasoningSettings c={c} draft={draft} availableModels={availableDraftModels} setDraft={setDraft} activeModelId={activeModelId} setActiveModelId={setActiveModelId} activeModel={activeModel} updateModel={updateModel} addPreset={addPreset} account={initial.account}/>}
          {tab==="users"&&admin&&<UsersSettings c={c}/>} {tab==="plans"&&admin&&<PlanSettings models={draft.models} ko={draft.preferences.language==="ko"}/>} {tab==="data"&&admin&&<DataManagementSettings ko={draft.preferences.language==="ko"}/>} {tab==="account"&&<><AccountSettings c={c} account={initial.account} draft={draft} setDraft={setDraft} onLogout={onLogout}/><AccountBackupSettings ko={draft.preferences.language==="ko"}/></>}
        </div>
      </div>
      <footer><span>{notice}</span><div><button className="secondary-button" onClick={() => closeSettings()}>{dirty?c.cancel:c.close}</button>{!["users","plans","data","mcp"].includes(tab)&&<button className="save-button" onClick={save} disabled={saving||!dirty}>{saving?c.saving:c.saveChanges}</button>}</div></footer>
    </section>{detectDialog}
  </div>,document.body);
}

function AssistantAttachmentGallery({attachments}:{attachments:StoredAttachment[]}){
  const[preview,setPreview]=useState<StoredAttachment>();
  const images=attachments.filter(attachment=>attachment.mimeType.startsWith("image/"));
  if(!images.length)return null;
  return <><div className={`assistant-generated-images count-${Math.min(images.length,4)}`}>{images.map(attachment=><button type="button" key={attachment.id} onClick={()=>setPreview(attachment)} aria-label={attachment.name}><img src={attachment.url} alt={attachment.name} loading="lazy" decoding="async" width={attachment.width} height={attachment.height}/></button>)}</div>{preview&&<ImageLightbox src={preview.url} alt={preview.name} onClose={()=>setPreview(undefined)}/>}</>;
}

function ExperimentalSettings({ c, draft, setDraft }: { c: CopySet; draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>> }) {
  const experimental = { ...draft.experimental, openAIProgress: draft.experimental?.openAIProgress ?? false, hostComputerTool: draft.experimental?.hostComputerTool ?? false };
  const toggle = (key: keyof typeof experimental) => setDraft((current) => ({ ...current, experimental: { ...(current.experimental || { browserTool: false, openAIProgress: false, hostComputerTool: false }), [key]: !current.experimental?.[key] } }));
  return <div className="settings-section">
    <SectionTitle icon={<FlaskConical size={19} />} title={c.experimentalTitle} description={c.experimentalDesc} />
    <div className="general-setting-card general-toggle-card">
      <div><strong>{c.experimentalBrowser}</strong><small>{c.experimentalBrowserDesc}</small></div>
      <button role="switch" aria-checked={experimental.browserTool} aria-label={c.experimentalBrowser} className={`toggle ${experimental.browserTool ? "on" : ""}`} onClick={() => toggle("browserTool")}><i /></button>
    </div>
    {draft.account?.role === "superadmin" && <div className="general-setting-card general-toggle-card">
      <div><strong>{c.experimentalHost}</strong><small>{c.experimentalHostDesc}{draft.hostComputerAvailable === false ? (draft.preferences.language === "ko" ? " 현재 서버는 컨테이너 환경으로 감지되어 사용할 수 없습니다." : " This server was detected as containerized, so the tool is unavailable.") : ""}</small></div>
      <button role="switch" disabled={draft.hostComputerAvailable === false} aria-checked={experimental.hostComputerTool} aria-label={c.experimentalHost} className={`toggle ${experimental.hostComputerTool ? "on" : ""}`} onClick={() => toggle("hostComputerTool")}><i /></button>
    </div>}
    <div className="general-setting-card general-toggle-card">
      <div><strong>{draft.preferences.language === "ko" ? "OpenAI 호환 연결 진행률" : "OpenAI-compatible connection progress"}</strong><small>{draft.preferences.language === "ko" ? "LM Studio로 확인되는 서버에 전용 진행률 연동을 사용합니다. 다른 서버는 표준 채팅 API를 유지하며, 진행률을 제공하지 않으면 표시하지 않습니다. 드라이버별 지원 범위는 연결 설정의 드라이버 목록에서 확인할 수 있습니다." : "Use native progress on verified LM Studio servers. Other hosts retain standard chat, and progress the server does not expose is simply not shown. The driver picker in Connections lists what each driver supports."}</small></div>
      <button role="switch" aria-checked={experimental.openAIProgress} aria-label={draft.preferences.language === "ko" ? "OpenAI 호환 연결 진행률" : "OpenAI-compatible connection progress"} className={`toggle ${experimental.openAIProgress ? "on" : ""}`} onClick={() => toggle("openAIProgress")}><i /></button>
    </div>
    <p className="settings-help">{c.experimentalHelp}</p>
  </div>;
}

function ToolsSettings({ c, draft, setDraft }: { c: CopySet; draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>> }) {
  const setValue = (key: keyof ToolSettings, value: number) => setDraft((current) => ({ ...current, toolSettings: { ...current.toolSettings, [key]: value } }));
  // Related limits stay together so the tab reads as four short topics instead of one long grid.
  const groups: Array<{ title: string; fields: Array<{ key: keyof ToolSettings; label: string; min: number; max: number; step?: number }> }> = [
    { title: c.toolLoopGroup, fields: [
      { key: "maxToolRounds", label: c.maxToolRounds, min: 1, max: 10_000 },
    ] },
    { title: c.interactiveToolGroup, fields: [
      { key: "maxBrowserTabs", label: c.maxBrowserTabs, min: 1, max: 20 },
      { key: "maxMultipleChoiceQuestions", label: c.maxMultipleChoiceQuestions, min: 1, max: 10 },
    ] },
    { title: c.attachmentGroup, fields: [
      { key: "maxAttachmentsPerMessage", label: c.maxAttachments, min: 1, max: 50 },
      { key: "imageUploadLimitMb", label: c.imageUploadLimit, min: 1, max: 50 },
      { key: "imageDownloadLimitMb", label: c.imageDownloadLimit, min: 1, max: 50 },
      { key: "textDownloadLimitMb", label: c.textDownloadLimit, min: .0625, max: 10, step: .0625 },
      { key: "textCharacterLimit", label: c.textCharacterLimit, min: 1_000, max: 1_000_000 },
    ] },
    { title: c.pdfGroup, fields: [
      { key: "pdfSizeLimitMb", label: c.pdfSizeLimit, min: 1, max: 100 },
      { key: "pdfPageLimit", label: c.pdfPageLimit, min: 1, max: 500 },
      { key: "pdfTextCharacterLimit", label: c.pdfTextLimit, min: 1_000, max: 1_000_000 },
      { key: "pdfVisionPageLimit", label: c.pdfVisionPages, min: 0, max: 20 },
      { key: "pdfProcessingTimeoutSeconds", label: c.pdfTimeout, min: 5, max: 120 },
    ] },
    { title: c.cleanupGroup, fields: [
      { key: "temporaryFileTtlMinutes", label: c.temporaryFileTtl, min: 5, max: 1_440 },
      { key: "orphanUploadTtlHours", label: c.orphanTtl, min: 1, max: 168 },
    ] },
  ];
  return <div className="settings-section wide tools-settings-section"><SectionTitle icon={<Wrench size={19} />} title={c.toolsSettingsTitle} description={c.toolsSettingsDesc} />{groups.map((group) => <div className="settings-group" key={group.title}><h4>{group.title}</h4><div className="tool-settings-grid">{group.fields.map((field) => <label className="field" key={field.key}><span>{field.label}</span><input type="number" min={field.min} max={field.max} step={field.step || 1} value={draft.toolSettings[field.key]} onChange={(event) => setValue(field.key, Number(event.target.value))} /></label>)}</div></div>)}<p className="settings-help tool-settings-help">{c.toolsSafetyHelp}</p></div>;
}

function GeneralSettings({ c, draft, setDraft, admin, onExport, onImport, importing }: { c: CopySet; draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>>; admin: boolean; onExport: () => void; onImport: (file: File) => Promise<void>; importing: boolean }) {
  const importInputRef = useRef<HTMLInputElement>(null);
  function selectLanguage(language: Locale) { setDraft((current) => ({ ...current, preferences: { ...current.preferences, language } })); }
  function toggleOnDemand() { setDraft((current) => ({ ...current, preferences: { ...current.preferences, onDemand: !current.preferences.onDemand } })); }
  return <div className="settings-section"><SectionTitle icon={<Settings2 size={19} />} title={c.generalTitle} description={c.generalDesc} /><div className="general-setting-card"><div><strong>{c.interfaceLanguage}</strong><small>{c.languageHelp}</small></div><div className="language-options" role="radiogroup" aria-label={c.interfaceLanguage}><button role="radio" aria-checked={draft.preferences.language === "en"} className={draft.preferences.language === "en" ? "active" : ""} onClick={() => selectLanguage("en")}><span>EN</span><div><strong>{c.english}</strong><small>English</small></div>{draft.preferences.language === "en" && <Check size={16} />}</button><button role="radio" aria-checked={draft.preferences.language === "ko"} className={draft.preferences.language === "ko" ? "active" : ""} onClick={() => selectLanguage("ko")}><span>한</span><div><strong>{c.korean}</strong><small>한국어</small></div>{draft.preferences.language === "ko" && <Check size={16} />}</button></div></div>{admin && <div className="general-setting-card general-toggle-card"><div><strong>{c.onDemand}</strong><small>{c.onDemandHelp}</small></div><button role="switch" aria-checked={draft.preferences.onDemand} aria-label={c.onDemand} className={`toggle ${draft.preferences.onDemand ? "on" : ""}`} onClick={toggleOnDemand}><i /></button></div>}<div className="general-setting-card settings-transfer-card"><div><strong>{c.modelSettingsTransfer}</strong><small>{c.modelSettingsTransferDesc}</small></div><div className="settings-transfer-actions"><button type="button" onClick={onExport}><Download size={15} />{c.exportModelSettings}</button><button type="button" disabled={importing} onClick={() => importInputRef.current?.click()}><Upload size={15} />{c.importModelSettings}</button><input ref={importInputRef} type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void onImport(file); }} /></div></div><div className="general-setting-card app-version-card"><div><strong>{c.appVersion}</strong><small>NeuralNetUI</small></div><b>{APP_VERSION}</b></div></div>;
}

/** One accent chooser: six named swatches, a custom entry, and the hex field the custom entry needs. */
function AccentPicker({ c, label, help, palette, color, onChange }: { c: CopySet; label: string; help: string; palette: AccentPaletteId; color: string; onChange: (value: { accentPalette?: AccentPaletteId; accentColor?: string }) => void }) {
  const [hexText, setHexText] = useState(color);
  useEffect(() => { setHexText(color); }, [color]);
  const paletteName: Record<AccentPaletteId, string> = { blue: c.accentBlue, violet: c.accentViolet, teal: c.accentTeal, amber: c.accentAmber, rose: c.accentRose, graphite: c.accentGraphite, custom: c.accentCustom };
  return <div className="general-setting-card">
    <div><strong>{label}</strong><small>{help}</small></div>
    <div className="accent-swatches" role="radiogroup" aria-label={label}>
      {ACCENT_PALETTES.map((entry) => <button key={entry.id} type="button" role="radio" aria-checked={palette === entry.id} aria-label={`${label}: ${paletteName[entry.id]}`} title={paletteName[entry.id]} className={palette === entry.id ? "active" : ""} style={{ "--swatch": entry.hex } as React.CSSProperties} onClick={() => onChange({ accentPalette: entry.id })}><i /></button>)}
      <button type="button" role="radio" aria-checked={palette === "custom"} aria-label={`${label}: ${c.accentCustom}`} title={c.accentCustom} className={`custom ${palette === "custom" ? "active" : ""}`} style={{ "--swatch": color } as React.CSSProperties} onClick={() => onChange({ accentPalette: "custom" })}><i /></button>
    </div>
    {palette === "custom" && <div className="accent-custom-row">
      <input type="color" aria-label={`${label}: ${c.accentCustom}`} value={color} onChange={(event) => onChange({ accentColor: normalizeHexColor(event.target.value) })} />
      <input type="text" aria-label={`${label}: ${c.accentHex}`} maxLength={7} spellCheck={false} value={hexText} onChange={(event) => { setHexText(event.target.value); const valid = normalizeHexColor(event.target.value, ""); if (valid) onChange({ accentColor: valid }); }} onBlur={() => setHexText(color)} />
    </div>}
  </div>;
}

function AppearanceSettings({ c, draft, setDraft, admin }: { c: CopySet; draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>>; admin: boolean }) {
  const appearance = draft.preferences.appearance || DEFAULT_APPEARANCE;
  const locale: Locale = draft.preferences.language === "ko" ? "ko" : "en";
  const loginAppearance = draft.loginAppearance || DEFAULT_LOGIN_APPEARANCE;
  const patchLogin = (value: Partial<LoginAppearance>) => setDraft((current) => ({ ...current, loginAppearance: { ...(current.loginAppearance || DEFAULT_LOGIN_APPEARANCE), ...value } }));
  const togglePreference = (key: "showModelIdentifiers" | "renderStrikethrough") => setDraft((current) => ({
    ...current,
    preferences: { ...current.preferences, [key]: current.preferences[key] === false },
  }));
  const patch = (value: Partial<AppearancePreferences>) => setDraft((current) => ({
    ...current,
    preferences: { ...current.preferences, appearance: { ...(current.preferences.appearance || DEFAULT_APPEARANCE), ...value } },
  }));
  const cards = (label: string, value: string, options: Array<{ id: string; icon: React.ReactNode; title: string; description: string }>, onSelect: (id: string) => void) =>
    <div className="option-cards appearance-cards" role="radiogroup" aria-label={label}>{options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={value === option.id} className={value === option.id ? "active" : ""} onClick={() => onSelect(option.id)}>
      <span className="option-card-icon">{option.icon}</span>
      <div><strong>{option.title}</strong><small>{option.description}</small></div>
      {value === option.id && <Check size={16} />}
    </button>)}</div>;
  return <div className="settings-section">
    <SectionTitle icon={<Palette size={19} />} title={c.appearanceTitle} description={c.appearanceDesc} />
    <div className="general-setting-card general-toggle-card"><div><strong>{c.showModelIdentifiers}</strong><small>{c.showModelIdentifiersHelp}</small></div><button role="switch" aria-checked={draft.preferences.showModelIdentifiers !== false} aria-label={c.showModelIdentifiers} className={`toggle ${draft.preferences.showModelIdentifiers !== false ? "on" : ""}`} onClick={() => togglePreference("showModelIdentifiers")}><i /></button></div>
    <div className="general-setting-card general-toggle-card"><div><strong>{c.renderStrikethrough}</strong><small>{c.renderStrikethroughHelp}</small></div><button role="switch" aria-checked={draft.preferences.renderStrikethrough !== false} aria-label={c.renderStrikethrough} className={`toggle ${draft.preferences.renderStrikethrough !== false ? "on" : ""}`} onClick={() => togglePreference("renderStrikethrough")}><i /></button></div>
    {admin && <div className="general-setting-card general-toggle-card"><div><strong>{c.showModelWeights}</strong><small>{c.showModelWeightsDesc}</small></div><button role="switch" aria-checked={draft.showModelWeights === true} aria-label={c.showModelWeights} className={`toggle ${draft.showModelWeights ? "on" : ""}`} onClick={() => setDraft((current) => ({ ...current, showModelWeights: !current.showModelWeights }))}><i /></button></div>}
    {admin && <div className="general-setting-card general-toggle-card"><div><strong>{c.showModelConnectionNames}</strong><small>{c.showModelConnectionNamesDesc}</small></div><button role="switch" aria-checked={draft.showModelConnectionNames === true} aria-label={c.showModelConnectionNames} className={`toggle ${draft.showModelConnectionNames ? "on" : ""}`} onClick={() => setDraft((current) => ({ ...current, showModelConnectionNames: !current.showModelConnectionNames }))}><i /></button></div>}
    <AccentPicker c={c} label={c.accentTitle} help={c.accentHelp} palette={appearance.accentPalette} color={appearance.accentColor} onChange={patch} />
    {admin && <AccentPicker c={c} label={c.loginAccentTitle} help={c.loginAccentHelp} palette={loginAppearance.accentPalette} color={loginAppearance.accentColor} onChange={patchLogin} />}
    <div className="general-setting-card greeting-settings">
      <div><strong>{locale === "ko" ? "환영 메시지" : "Greetings"}</strong><small>{locale === "ko" ? "메인 화면을 열 때마다 시간대에 맞는 문구를 무작위로 표시합니다." : "Show a random greeting for the time of day whenever the home screen opens."}</small></div>
      <p className="settings-help">{locale === "ko" ? "현재 언어의 문구를 편집합니다. {name}은 이름으로 바뀌며, 비워 두면 기본 문구를 사용합니다." : "Edit greetings for the current language. {name} becomes your name; leave blank to use the default."}</p>
      {BAND_STARTS.map(([band, start], bandIndex) => {
        const names = locale === "ko" ? ["이른 새벽", "아침", "점심", "오후", "저녁", "밤", "늦은 밤"] : ["Early dawn", "Morning", "Midday", "Afternoon", "Evening", "Night", "Late night"];
        const end = BAND_STARTS[(bandIndex + 1) % BAND_STARTS.length][1];
        return <details key={band}><summary>{names[bandIndex]} <span>{String(start).padStart(2, "0")}:00–{String(end).padStart(2, "0")}:00</span></summary>
          <div className="greeting-fields">{greetingsFor(locale, band).map((fallback, index) => <label className="field" key={index}><span>{locale === "ko" ? "문구" : "Greeting"} {index + 1}</span><input maxLength={200} value={appearance.greetings?.[locale]?.[band]?.[index] ?? fallback} onChange={(event) => {
            const lines = [...(appearance.greetings?.[locale]?.[band] || greetingsFor(locale, band))];
            lines[index] = event.target.value;
            patch({ greetings: { ...appearance.greetings, [locale]: { ...appearance.greetings?.[locale], [band]: lines } } });
          }} placeholder={fallback} /></label>)}</div>
        </details>;
      })}
    </div>
    <div className="general-setting-card">
      <div><strong>{c.reasoningNotesTitle}</strong><small>{c.reasoningNotesHelp}</small></div>
      <div className="reasoning-notes-head">
        <button role="switch" aria-checked={appearance.showReasoningNotes} aria-label={c.reasoningNotesTitle} className={`toggle ${appearance.showReasoningNotes ? "on" : ""}`} onClick={() => patch({ showReasoningNotes: !appearance.showReasoningNotes })}><i /></button>
      </div>
      {appearance.showReasoningNotes && <><div className="reasoning-notes">
        {REASONING_NOTE_KEYS.map((key) => <label className="field" key={key}>
          <span>{reasoningOptionName(key === "off" ? "off" : key)}</span>
          <input value={appearance.reasoningNotes?.[key] || ""} maxLength={200} placeholder={defaultReasoningNote(key, locale)} onChange={(event) => {
            const notes = { ...(appearance.reasoningNotes || {}) };
            if (event.target.value.trim()) notes[key] = event.target.value; else delete notes[key];
            patch({ reasoningNotes: notes });
          }} />
        </label>)}
      </div><p className="settings-help">{c.reasoningNotesReset}</p></>}
    </div>
    <div className="general-setting-card">
      <div><strong>{locale === "ko" ? "모델 서버 진행률" : "Model server progress"}</strong><small>{locale === "ko" ? "모델 로드와 프롬프트 처리 상태의 표시 방식입니다. 서버에서 진행률을 제공하지 않으면 로딩 표시를 사용합니다." : "Display model loading and prompt processing progress. Loading indicators are used when the server provides no percentage."}</small></div>
      <SelectMenu label={locale === "ko" ? "진행률 표시" : "Progress display"} value={appearance.lmStudioProgress} options={[
        { value: "text", label: locale === "ko" ? "상태 메시지" : "Status message" },
        { value: "percent", label: locale === "ko" ? "퍼센트" : "Percentage" },
        { value: "donut", label: locale === "ko" ? "도넛" : "Donut" },
        { value: "both", label: locale === "ko" ? "퍼센트와 도넛" : "Percentage and donut" },
      ]} onChange={(value) => patch({ lmStudioProgress: value as AppearancePreferences["lmStudioProgress"] })} />
    </div>
    <div className="general-setting-card">
      <div><strong>{c.streamRevealTitle}</strong><small>{c.streamRevealHelp}</small></div>
      {cards(c.streamRevealTitle, appearance.streamReveal, [
        { id: "instant", icon: <Zap size={17} />, title: c.streamInstant, description: c.streamInstantDesc },
        { id: "fade", icon: <Type size={17} />, title: c.streamFade, description: c.streamFadeDesc },
      ], (id) => patch({ streamReveal: id as AppearancePreferences["streamReveal"] }))}
      {appearance.streamReveal === "fade" && <><p className="settings-help">{c.streamFadeDurationHelp}</p><div className="appearance-slider"><input type="range" min={80} max={800} step={20} aria-label={c.streamFadeDuration} value={appearance.streamFadeDurationMs} onChange={(event) => patch({ streamFadeDurationMs: Number(event.target.value) })} /><b>{appearance.streamFadeDurationMs} ms</b></div></>}
    </div>
  </div>;
}

function ConnectionSettings({ c, draft, setDraft, onDetect, detectingConnectionId, statusNonce, initialServerStates, onServerStates }: { c: CopySet; draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>>; onDetect: (connectionId: string) => void; detectingConnectionId: string; statusNonce: number; initialServerStates: Record<string, ServerState>; onServerStates: (states: Record<string, ServerState>) => void }) {
  const [activeConnectionId, setActiveConnectionId] = useState(draft.connections[0]?.id || "");
  const activeConnection = draft.connections.find((connection) => connection.id === activeConnectionId) || draft.connections[0];
  const activeIndex = activeConnection ? draft.connections.findIndex((connection) => connection.id === activeConnection.id) : -1;
  function replaceConnections(connections: PublicConfig["connections"]) { setDraft(current => { const merged = reconcileConnectionEdits(connections, current.models); return { ...current, connections: merged, models: resolveConnectionModels(merged, current.models.filter(model => model.isAlias), current.models.map(model => model.id)) }; }); }
  function patchConnection(id: string, patch: Partial<PublicConfig["connections"][number]>) { replaceConnections(draft.connections.map((connection) => connection.id === id ? { ...connection, ...patch } : connection)); }
  function addConnection() { const connection = { id: uid("connection"), name: "LM Studio", driver: "lmstudio" as const, baseUrl: "http://localhost:1234", apiKey: "", hasApiKey: false, models: [] }; replaceConnections([...draft.connections, connection]); setActiveConnectionId(connection.id); }
  const { dialog: messageDialog, confirm: askConfirm } = useMessageDialog(draft.preferences.language === "ko");
  const [serverStates, setServerStates] = useState<Record<string, ServerState>>(initialServerStates);
  const [statusTick, setStatusTick] = useState(0);
  // Probe what the draft describes, so an edited address or a new server shows its state before saving. Beyond
  // edits, servers are rechecked after model detection and when typing resumes after a minute, never on a timer.
  const probeKey = JSON.stringify(draft.connections.map(({ id, driver, baseUrl, apiKey, clearApiKey, disabled }) => ({ id, driver, baseUrl, apiKey, clearApiKey, disabled })));
  useKeyboardReturn(60_000, useCallback(() => setStatusTick((tick) => tick + 1), []));
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch("/api/models/status", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connections: JSON.parse(probeKey) }), signal: controller.signal })
        .then((response) => response.ok ? response.json() : undefined)
        .then((body: { statuses?: Record<string, ServerState> } | undefined) => { if (body?.statuses) { setServerStates(body.statuses); onServerStates(body.statuses); } })
        .catch(() => undefined);
    }, 500);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [probeKey, statusTick, statusNonce, onServerStates]);
  const stateOf = (connection: PublicConfig["connections"][number]): ServerState | undefined => connection.disabled ? "disabled" : serverStates[connection.id] === "disabled" ? undefined : serverStates[connection.id];
  const stateLabel = (state?: ServerState) => state === "online" ? c.serverStateOnline : state === "offline" ? c.serverStateOffline : state === "error" ? c.serverStateError : state === "disabled" ? c.serverStateDisabled : undefined;
  async function confirmRemoveConnection(connection: PublicConfig["connections"][number]) {
    if (draft.connections.length < 2) return;
    if (await askConfirm({ tone: "danger", title: c.removeConnection, message: c.confirmRemoveConnection, detail: `${connection.name} · ${c.removeConnectionDetail}`, confirmLabel: c.confirmDelete })) removeConnection(connection.id);
  }
  function removeConnection(id: string) {
    if (draft.connections.length < 2) return;
    const index = draft.connections.findIndex((connection) => connection.id === id);
    const next = draft.connections.filter((connection) => connection.id !== id);
    const merged = reconcileConnectionEdits(next, draft.models);
    const models = resolveConnectionModels(merged, draft.models.filter(model => model.isAlias), draft.models.map(model => model.id));
    setDraft(current => ({ ...current, connections: merged, models }));
    setActiveConnectionId(next[Math.min(Math.max(index, 0), next.length - 1)]?.id || "");
  }
  function moveConnection(sourceId: string, targetId: string) { replaceConnections(moveItemById(draft.connections, sourceId, targetId)); setActiveConnectionId(sourceId); }
  function nudgeConnection(offset: -1 | 1) { if (!activeConnection) return; replaceConnections(nudgeItemById(draft.connections, activeConnection.id, offset)); }
  const actions = <OrderActions c={c} onAdd={addConnection} addLabel={c.addConnection} onUp={() => nudgeConnection(-1)} onDown={() => nudgeConnection(1)} disableUp={activeIndex <= 0} disableDown={activeIndex < 0 || activeIndex === draft.connections.length - 1} />;
  // Each driver carries its own capability table, revealed from the info marker in the picker.
  const locale: Locale = draft.preferences.language === "ko" ? "ko" : "en";
  const driverOptions = ([["openai", "OpenAI API"], ["lmstudio", "LM Studio"], ["nnui", "NNUI Server"]] as Array<[ConnectionDriver, string]>).map(([driver, name]) => {
    const rows = driverCapabilities(driver, locale, { openAIProgress: draft.experimental?.openAIProgress === true });
    return { value: driver, label: name, info: { title: name, rows, summary: `${name} — ${capabilitySummary(rows, locale)}` } };
  });
  return <div className="settings-section wide"><SectionTitle icon={<Server size={19} />} title={c.serverTitle} description={c.serverDesc} />
    <div className="split-model-editor connection-editor">
      <ModelColumn c={c} label={c.connection} items={draft.connections.map((connection) => { const state = stateOf(connection); return { id: connection.id, name: connection.name, detail: `${connection.models.length} ${c.models}`, icon: <Server size={13} />, status: state, statusLabel: stateLabel(state) }; })} active={activeConnection?.id || ""} onChange={setActiveConnectionId} onMove={moveConnection} action={actions} />
      <div className="model-editor-pane">{activeConnection ? <div className="editor-card connection-card">{(() => { const detecting = detectingConnectionId === activeConnection.id; return <>
        <div className="connection-card-head"><strong>{activeIndex + 1}. {activeConnection.name}</strong>{activeIndex === 0 && <em>{c.priorityHelp}</em>}<button role="switch" aria-checked={!activeConnection.disabled} aria-label={c.connectionEnabled} title={c.connectionEnabled} className={`toggle ${activeConnection.disabled ? "" : "on"}`} onClick={() => patchConnection(activeConnection.id, { disabled: !activeConnection.disabled })}><i /></button><button className="connection-remove" aria-label={c.removeConnection} title={c.removeConnection} disabled={draft.connections.length < 2} onClick={() => void confirmRemoveConnection(activeConnection)}><Trash2 size={15} /></button></div>
        <div className="form-grid"><label className="field"><span>{c.connectionName}</span><input value={activeConnection.name} onChange={(event) => patchConnection(activeConnection.id, { name: event.target.value })} /></label><label className="field"><span>{c.driver}</span><SelectMenu label={c.driver} value={activeConnection.driver} options={driverOptions} onChange={(value) => { const driver = value as ConnectionDriver; const defaults: Record<ConnectionDriver, string> = { openai: "http://localhost:8888/v1", lmstudio: "http://localhost:1234", nnui: "http://127.0.0.1:11435" }; const knownDefault = Object.values(defaults).includes(activeConnection.baseUrl); patchConnection(activeConnection.id, { driver, ...(knownDefault ? { baseUrl: defaults[driver] } : {}) }); }} /></label></div>
        <label className="field"><span>{c.baseUrl}</span><input value={activeConnection.baseUrl} onChange={(event) => patchConnection(activeConnection.id, { baseUrl: event.target.value })} placeholder={activeConnection.driver === "lmstudio" ? "http://localhost:1234" : activeConnection.driver === "nnui" ? "http://127.0.0.1:11435" : "http://localhost:8888/v1"} /><small>{activeConnection.driver === "lmstudio" ? "LM Studio REST API /api/v1" : activeConnection.driver === "nnui" ? (locale === "ko" ? "NNUI 공개 API 루트 (/v1은 자동 적용)" : "NNUI public API root (/v1 is applied automatically)") : c.baseUrlHelp}</small></label>
        <label className="field"><span>{draft.preferences.language === "ko" ? "최대 모델 상주 한도" : "Maximum resident models"}</span><input type="number" min={0} max={128} step={1} inputMode="numeric" value={activeConnection.maxResidentModels || 0} onChange={(event) => patchConnection(activeConnection.id, { maxResidentModels: Math.min(128, Math.max(0, Math.floor(Number(event.target.value) || 0))) })} /><small>{draft.preferences.language === "ko" ? "0은 제한 없음입니다. 한도를 설정하면 필요할 때 모델을 로드하고, 사용 중이지 않은 모델 중 사용 횟수가 가장 적은 모델부터 교체합니다. 모델 관리 API가 필요합니다." : "0 means unlimited. A positive limit loads models as needed and replaces the least-used idle model. Requires a model-management API."}</small></label>
        <label className="field"><span>{draft.preferences.language === "ko" ? "다른 세션 실행 중 대기 방식" : "Wait policy while other sessions are running"}</span><SelectMenu label={draft.preferences.language === "ko" ? "다른 세션 실행 중 대기 방식" : "Wait policy while other sessions are running"} value={activeConnection.modelWaitPolicy || "capacity"} options={[{ value: "capacity", label: draft.preferences.language === "ko" ? "교체 후보가 모두 사용 중일 때만 대기" : "Wait only when all eviction candidates are busy" }, { value: "serial", label: draft.preferences.language === "ko" ? "다른 세션이 실행 중이면 항상 대기" : "Always wait for other sessions to finish" }]} onChange={(value) => patchConnection(activeConnection.id, { modelWaitPolicy: value as "capacity" | "serial" })} /><small>{draft.preferences.language === "ko" ? "이 앱의 모든 사용자와 대화에 적용됩니다. Alias는 기반 모델과 상주 공간을 공유합니다." : "Applies across all users and conversations in this app. Aliases share residency with their base model."}</small></label>
        <label className="field"><span>{c.apiKey}</span><div className="field-with-icon"><KeyRound size={16} /><input type="password" value={activeConnection.apiKey} onChange={(event) => patchConnection(activeConnection.id, { apiKey: event.target.value, clearApiKey: false })} placeholder={activeConnection.hasApiKey ? c.savedKey : activeConnection.driver === "openai" ? c.requiredKey : "Optional"} /></div><small>{c.apiKeyHelp}</small></label>
        <button type="button" className="secondary-button" disabled={activeConnection.clearApiKey || !(activeConnection.hasApiKey || activeConnection.apiKey)} onClick={() => patchConnection(activeConnection.id, { apiKey: "", clearApiKey: true, hasApiKey: false })}>{draft.preferences.language === "ko" ? (activeConnection.clearApiKey ? "API 키 사용 안 함" : "저장된 API 키 삭제") : (activeConnection.clearApiKey ? "API key disabled" : "Remove saved API key")}</button>
        <div className="connection-test"><div><strong>{c.discover}</strong><small>{activeConnection.models.length} {c.models} · {c.discoverDesc}</small></div><button onClick={() => onDetect(activeConnection.id)} disabled={Boolean(detectingConnectionId)}><RefreshCw size={16} className={detecting ? "spin" : ""} />{detecting ? c.detecting : c.detectModels}</button></div>
      </>; })()}</div> : <EmptyState text={c.noModel} />}</div>
    </div>
    {messageDialog}
  </div>;
}

type ModelEditorProps = { draft: PublicConfig; activeModelId: string; setActiveModelId: (id: string) => void; activeModel?: ModelConfig };
type ColumnItem = { id: string; name: string; detail?: string; icon: React.ReactNode; hidden?: boolean; status?: ServerState; statusLabel?: string };
function OrderActions({ c, onAdd, addLabel, disableAdd, onUp, onDown, disableUp, disableDown }: { c: CopySet; onAdd?: () => void; addLabel?: string; disableAdd?: boolean; onUp: () => void; onDown: () => void; disableUp: boolean; disableDown: boolean }) { return <span className="order-actions">{onAdd && <button onClick={onAdd} disabled={disableAdd} title={addLabel} aria-label={addLabel}><Plus size={15} /></button>}<button onClick={onUp} title={c.moveUp} aria-label={c.moveUp} disabled={disableUp}><ChevronUp size={15} /></button><button onClick={onDown} title={c.moveDown} aria-label={c.moveDown} disabled={disableDown}><ChevronDown size={15} /></button></span>; }
function ModelColumn({ c, models, connections, items, label, active, onChange, showIdentifiers = false, onMove, action }: { c: CopySet; models?: ModelConfig[]; connections?: PublicConfig["connections"]; items?: ColumnItem[]; label?: string; active: string; onChange: (id: string) => void; showIdentifiers?: boolean; onMove?: (sourceId: string, targetId: string) => void; action?: React.ReactNode }) {
  const rows: ColumnItem[] = items || (models || []).map((model) => ({ id: model.id, name: model.name, detail: [showIdentifiers ? model.sourceModel : "", connections ? connectionForModel(connections as ConnectionConfig[], model)?.name : ""].filter(Boolean).join(" · ") || undefined, icon: model.isAlias ? <Pencil size={14} /> : <NeuralMark size={17} />, hidden: model.visible === false }));
  return <aside className="model-column"><div className="model-column-head"><span>{label || c.models}</span>{action}</div><div className="model-column-list">{rows.map((item) => <button key={item.id} draggable={Boolean(onMove)} className={item.id === active ? "active" : ""} onClick={() => onChange(item.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }} onDragOver={(event) => { if (onMove) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { if (!onMove) return; event.preventDefault(); onMove(event.dataTransfer.getData("text/plain"), item.id); }}><span className="model-type-icon">{item.icon}{item.status && <i className={`server-status-dot ${item.status}`} role="img" aria-label={item.statusLabel} title={item.statusLabel} />}</span><span><strong>{item.name}</strong>{item.detail && <small>{item.detail}</small>}</span>{item.hidden && <i className="hidden-model-dot" />}</button>)}</div></aside>;
}

function ModelSettings({ c, draft, availableModels, setDraft, activeModelId, setActiveModelId, activeModel, updateModel, addAlias, account }: ModelEditorProps & { c: CopySet; availableModels: ModelConfig[]; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>>; updateModel: (patch: Partial<ModelConfig>) => void; addAlias: () => void; account?: AccountInfo }) {
  const [promptOpen, setPromptOpen] = useState(false);
  function removeModel() { if (!activeModel) return; const next = draft.models.filter((model) => model.id !== activeModel.id); setDraft((current) => ({ ...current, models: next })); setActiveModelId(next[0]?.id || ""); }
  const editableModels = availableModels.filter((model) => model.isAlias && (!account || model.ownerId === account.id));
  const privileged = account?.role === "admin" || account?.role === "superadmin";
  const shownModels = account ? privileged ? availableModels.filter((model) => !model.isAlias || model.ownerId === account.id || !model.ownerId) : editableModels : availableModels;
  const effectiveContext = effectiveContextWindowTokens(activeModel, draft.models);
  const advertisedContext = advertisedContextWindowTokens(activeModel, draft.models);
  const inheritedContext = activeModel?.isAlias && activeModel.contextWindowTokens === undefined ? effectiveContext : undefined;
  const activeShownIndex = shownModels.findIndex((model) => model.id === activeModelId);
  function moveModel(sourceId: string, targetId: string) { setDraft((current) => ({ ...current, models: moveItemById(current.models, sourceId, targetId) })); setActiveModelId(sourceId); }
  function nudgeModel(offset: -1 | 1) { const target = shownModels[activeShownIndex + offset]; if (activeModel && target) moveModel(activeModel.id, target.id); }
  function setContextWindow(value: string) {
    const parsed = value.trim() ? Number(value) : undefined;
    updateModel({ contextWindowTokens: parsed && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined });
  }
  function setVisionMaxEdge(value: string) {
    const parsed = value.trim() ? Number(value) : 1024;
    updateModel({ visionMaxEdgePixels: Number.isFinite(parsed) ? Math.max(128, Math.min(8192, Math.floor(parsed))) : 1024 });
  }
  return <div className="settings-section wide">
    <SectionTitle icon={<NeuralMark size={21} />} title={c.modelsTitle} description={c.modelsDesc} />
    <div className="split-model-editor">
      <ModelColumn c={c} models={shownModels} connections={draft.connections} active={activeModelId} onChange={setActiveModelId} showIdentifiers={draft.preferences.showModelIdentifiers !== false} onMove={moveModel} action={<OrderActions c={c} onAdd={addAlias} addLabel={c.newAlias} onUp={() => nudgeModel(-1)} onDown={() => nudgeModel(1)} disableUp={activeShownIndex <= 0} disableDown={activeShownIndex < 0 || activeShownIndex === shownModels.length - 1} />} />
      <div className="model-editor-pane">{activeModel && shownModels.some((model) => model.id === activeModel.id) ? <div className="editor-card">
        {activeModel.isAlias && <div className="model-visibility-row"><div><strong>{c.publicModel}</strong><small>{c.publicModelDesc}</small></div><button role="switch" aria-label={c.publicModel} aria-checked={activeModel.isPublic === true} className={`toggle ${activeModel.isPublic ? "on" : ""}`} onClick={() => updateModel({ isPublic: !activeModel.isPublic })}><i /></button></div>}
        <div className="model-visibility-row"><div><strong>{c.showMain}</strong><small>{c.showMainDesc}</small></div><button role="switch" aria-label={c.showMain} aria-checked={activeModel.visible !== false} className={`toggle ${activeModel.visible !== false ? "on" : ""}`} onClick={() => updateModel({ visible: activeModel.visible === false })}><i /></button></div>
        <div className="type-badge">{activeModel.isAlias ? c.customAlias : c.servedModel}</div>
        <div className="form-grid"><label className="field"><span>{c.displayName}</span><input value={activeModel.name} onChange={(event) => updateModel({ name: event.target.value })} /></label><label className="field"><span>{c.modelId}</span><input value={activeModel.id} disabled={!activeModel.isAlias} onChange={(event) => { const oldId = activeModel.id; setDraft((current) => ({ ...current, models: current.models.map((model) => model.id === oldId ? { ...model, id: event.target.value } : model) })); setActiveModelId(event.target.value); }} /></label></div>
        <label className="field"><span>{activeModel.isAlias ? c.baseModel : c.servedIdentifier}</span>{activeModel.isAlias ? <SelectMenu label={c.baseModel} value={activeModel.sourceModel} options={availableModels.filter((model) => !model.isAlias && model.visible !== false).map((model) => ({ value: model.sourceModel, label: model.name, detail: draft.preferences.showModelIdentifiers !== false ? model.sourceModel : undefined }))} onChange={(value) => { const base = availableModels.find((model) => !model.isAlias && model.sourceModel === value); updateModel({ sourceModel: value, connectionId: base?.connectionId }); }} /> : <input value={activeModel.sourceModel} onChange={(event) => updateModel({ sourceModel: event.target.value })} />}</label>
        <label className="field context-window-field"><span>{c.contextWindow}</span><input type="number" min={1} step={1} inputMode="numeric" value={activeModel.contextWindowTokens ?? ""} onChange={(event) => setContextWindow(event.target.value)} placeholder={effectiveContext ? String(effectiveContext) : "131072"} /><small>{activeModel.isAlias ? c.aliasContextWindowHelp : c.contextWindowHelp}</small>{inheritedContext ? <small>{c.inheritedContextWindow}: {formatTokens(inheritedContext, draft.preferences.language)}</small> : null}{advertisedContext ? <small>{c.apiContextWindow}: {formatTokens(advertisedContext, draft.preferences.language)}</small> : null}{effectiveContext ? <small>{c.effectiveContextWindow}: {formatTokens(effectiveContext, draft.preferences.language)}</small> : null}</label>
        <label className="field"><span>{c.description}</span><input value={activeModel.description || ""} onChange={(event) => updateModel({ description: event.target.value })} /></label>
        <div className="model-visibility-row"><div><strong>{c.imageGenerationModel}</strong><small>{c.imageGenerationModelDesc}</small></div><button role="switch" aria-label={c.imageGenerationModel} aria-checked={activeModel.imageGeneration===true} className={`toggle ${activeModel.imageGeneration===true?"on":""}`} onClick={()=>updateModel({imageGeneration:activeModel.imageGeneration!==true})}><i/></button></div>
        <div className="model-visibility-row"><div><strong>{c.imageInputModel}</strong><small>{c.imageInputModelDesc}</small></div><button role="switch" aria-label={c.imageInputModel} aria-checked={activeModel.imageInput!==false} className={`toggle ${activeModel.imageInput!==false?"on":""}`} onClick={()=>updateModel({imageInput:activeModel.imageInput===false})}><i/></button></div>
        <div className="model-image-input-row"><div><strong>{c.visionSettings}</strong><small>{c.visionSettingsDesc}</small></div><label><span>{c.visionMaxResolution}</span><input type="number" min={128} max={8192} step={1} inputMode="numeric" disabled={activeModel.visionImageMode !== "max-resolution"} value={activeModel.visionMaxEdgePixels ?? 1024} onChange={(event) => setVisionMaxEdge(event.target.value)} title={c.visionMaxResolutionHelp}/></label><button role="switch" aria-label={c.visionUseOriginal} aria-checked={activeModel.visionImageMode === "max-resolution"} className={`toggle ${activeModel.visionImageMode === "max-resolution" ? "on" : ""}`} onClick={() => updateModel({ visionImageMode: activeModel.visionImageMode === "max-resolution" ? "original" : "max-resolution" })} title={c.visionUseOriginalDesc}><i /></button></div>
        <div className="field locked-field"><span id="model-system-prompt-label">{c.systemPrompt}</span><textarea rows={5} readOnly aria-labelledby="model-system-prompt-label" value={activeModel.systemPrompt || ""} placeholder={c.systemPromptPlaceholder} /><button type="button" className="subtle-action" onClick={() => setPromptOpen(true)}><Pencil size={15} />{c.editPrompt}</button></div>
        {promptOpen && <TextDialog ko={draft.preferences.language === "ko"} title={c.systemPrompt} value={activeModel.systemPrompt || ""} multiline allowEmpty placeholder={c.systemPromptPlaceholder} saveLabel={c.saveEdit} cancelLabel={c.cancel} onClose={() => setPromptOpen(false)} onSave={(value) => { updateModel({ systemPrompt: value }); setPromptOpen(false); }} />}
        {activeModel.isAlias && <button className="danger-action" onClick={removeModel}><Trash2 size={15} /> {c.deleteAlias}</button>}
      </div> : <EmptyState text={c.noModel} />}</div>
    </div>
  </div>;
}

function ReasoningSettings({ c, draft, availableModels, setDraft, activeModelId, setActiveModelId, activeModel, updateModel, addPreset, account }: ModelEditorProps & { c: CopySet; availableModels: ModelConfig[]; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>>; updateModel: (patch: Partial<ModelConfig>) => void; addPreset: () => string; account?: AccountInfo }) {
  const [activePresetId, setActivePresetId] = useState(activeModel?.reasoningPresets[0]?.id || "");
  const [promptPresetId, setPromptPresetId] = useState("");
  function patchPreset(id: string, patch: Partial<ReasoningPreset>) { if (activeModel) updateModel({ reasoningPresets: activeModel.reasoningPresets.map((preset) => preset.id === id ? { ...preset, ...patch } : preset) }); }
  function removePreset(id: string) { if (activeModel) { const index = activeModel.reasoningPresets.findIndex((preset) => preset.id === id); const next = activeModel.reasoningPresets.filter((preset) => preset.id !== id); updateModel({ reasoningPresets: next }); setActivePresetId(next[Math.min(Math.max(index, 0), next.length - 1)]?.id || ""); } }
  const efforts = activeModel?.reasoningEfforts || [];
  // Item 9: native levels cannot be renamed or deleted, so the editor lists templates only.
  const editablePresets = activeModel?.reasoningPresets.filter((preset) => preset.kind === "custom") || [];
  const hasEffort = efforts.some(value => !isReasoningToggle(value));
  const visibleModels = availableModels.filter((model) => model.visible !== false);
  const privileged = account?.role === "admin" || account?.role === "superadmin";
  const ownsModel = Boolean(activeModel?.isAlias && activeModel.ownerId === account?.id);
  // Served models belong to the administrators. A standard account shapes reasoning only on the
  // custom models it owns, and reads everything else.
  const canEditModel = privileged || ownsModel;
  const canEditPreset = (preset: ReasoningPreset) => preset.kind === "custom" && canEditModel;
  const selectedPreset = editablePresets.find((preset) => preset.id === activePresetId) || editablePresets[0];
  const promptPreset = editablePresets.find((preset) => preset.id === promptPresetId);
  const activePresetIndex = editablePresets.findIndex((preset) => preset.id === selectedPreset?.id);
  const activeModelIndex = visibleModels.findIndex((model) => model.id === activeModelId);
  function moveModel(sourceId: string, targetId: string) { setDraft((current) => ({ ...current, models: moveItemById(current.models, sourceId, targetId) })); setActiveModelId(sourceId); }
  function nudgeModel(offset: -1 | 1) { const target = visibleModels[activeModelIndex + offset]; if (activeModel && target) moveModel(activeModel.id, target.id); }
  function movePreset(sourceId: string, targetId: string) { if (!activeModel) return; updateModel({ reasoningPresets: moveItemById(activeModel.reasoningPresets, sourceId, targetId) }); setActivePresetId(sourceId); }
  function nudgePreset(offset: -1 | 1) {
    const target = editablePresets[activePresetIndex + offset];
    if (activeModel && selectedPreset && target) updateModel({ reasoningPresets: moveItemById(activeModel.reasoningPresets, selectedPreset.id, target.id) });
  }
  const presetActions = <OrderActions c={c} onAdd={() => { if (canEditModel) setActivePresetId(addPreset()); }} addLabel={c.addTemplate} disableAdd={!canEditModel} onUp={() => nudgePreset(-1)} onDown={() => nudgePreset(1)} disableUp={!canEditModel || activePresetIndex <= 0} disableDown={!canEditModel || activePresetIndex < 0 || activePresetIndex === editablePresets.length - 1} />;
  return <div className="settings-section wide"><SectionTitle icon={<Lightbulb size={19} />} title={c.reasoningTitle} description={c.reasoningDesc} action={presetActions} /><div className="split-model-editor"><ModelColumn c={c} models={visibleModels} connections={draft.connections} active={activeModelId} onChange={(id) => { setActiveModelId(id); setActivePresetId(draft.models.find((model) => model.id === id)?.reasoningPresets[0]?.id || ""); }} showIdentifiers={draft.preferences.showModelIdentifiers !== false} onMove={privileged ? moveModel : undefined} action={<OrderActions c={c} onUp={() => nudgeModel(-1)} onDown={() => nudgeModel(1)} disableUp={!privileged || activeModelIndex <= 0} disableDown={!privileged || activeModelIndex < 0 || activeModelIndex === visibleModels.length - 1} />} /><div className="model-editor-pane reasoning-pane">{activeModel ? <><div className="reason-capability"><div><strong>{c.nativeSupport}</strong><small>{activeModel.reasoningEfforts?.length ? `${hasEffort ? "Effort" : "Toggle"}: ${activeModel.reasoningEfforts.map(reasoningOptionName).join(", ")}` : c.noEffortMetadata}</small></div><button role="switch" aria-label={c.nativeSupport} aria-checked={activeModel.reasoningSupported} disabled={activeModel.isAlias || !privileged || !efforts.length} className={`toggle ${activeModel.reasoningSupported ? "on" : ""}`} onClick={() => updateModel({ reasoningSupported: !activeModel.reasoningSupported })}><i /></button></div><div className="preset-list">{editablePresets.map((preset) => <div className={`preset-editor ${preset.id === selectedPreset?.id ? "active" : ""}`} key={preset.id} onClick={() => setActivePresetId(preset.id)} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); movePreset(event.dataTransfer.getData("text/plain"), preset.id); }}><div className="preset-editor-head"><span className={`kind-icon ${preset.kind}`} draggable title={c.priorityHelp} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", preset.id); }}><GripVertical size={15} /></span><input disabled={!canEditPreset(preset)} value={preset.name} onChange={(event) => patchPreset(preset.id, { name: event.target.value })} aria-label={c.reasoningPreset} /><button aria-label={`${draft.preferences.language === "ko" ? "추론 프리셋 삭제" : "Delete reasoning preset"}: ${preset.name}`} disabled={!canEditPreset(preset)} onClick={() => removePreset(preset.id)}><Trash2 size={15} /></button></div><div className="preset-editor-body">{activeModel.reasoningSupported && <label><span>{hasEffort ? c.nativeEffort : c.reasoningLevel}</span><SelectMenu label={hasEffort ? c.nativeEffort : c.reasoningLevel} disabled={!canEditPreset(preset)} value={efforts.includes(preset.effort || "") ? preset.effort || "" : ""} options={[{ value: "", label: c.doNotSend }, ...efforts.map((effort) => ({ value: effort, label: reasoningOptionName(effort) }))]} onChange={(value) => patchPreset(preset.id, { effort: value })} /></label>}<label><span>{c.promptHandling}</span><SelectMenu label={c.promptHandling} disabled={!canEditPreset(preset)} value={preset.systemPromptMode || "append"} options={[{ value: "replace", label: c.replace }, { value: "prepend", label: c.prepend }, { value: "append", label: c.append }]} onChange={(value) => patchPreset(preset.id, { systemPromptMode: value as ReasoningPreset["systemPromptMode"] })} /></label><div className="locked-field preset-prompt-field"><span>{c.additionalPrompt}</span><textarea rows={3} readOnly aria-label={c.additionalPrompt} value={preset.systemPrompt || ""} placeholder={c.systemPromptPlaceholder} /><button type="button" className="subtle-action" disabled={!canEditPreset(preset)} onClick={() => setPromptPresetId(preset.id)}><Pencil size={15} />{c.editPrompt}</button></div></div></div>)}{!editablePresets.length && <EmptyState text={c.noPresets} />}{!canEditModel && <p className="settings-help">{c.servedReasoningLocked}</p>}<p className="settings-help">{c.nativePresetNote}</p></div></> : <EmptyState text={c.noModel} />}</div></div>{promptPreset && <TextDialog ko={draft.preferences.language === "ko"} title={`${promptPreset.name} · ${c.additionalPrompt}`} value={promptPreset.systemPrompt || ""} multiline allowEmpty placeholder={c.systemPromptPlaceholder} saveLabel={c.saveEdit} cancelLabel={c.cancel} onClose={() => setPromptPresetId("")} onSave={(value) => { patchPreset(promptPreset.id, { systemPrompt: value }); setPromptPresetId(""); }} />}</div>;
}

const storageBytesLabel=(bytes:number)=>bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} GB`:`${(bytes/1024**2).toFixed(1)} MB`;
const quotaParts=(bytes:number):{value:number;unit:"MB"|"GB"}=>bytes>=1024**3&&bytes%1024**3===0?{value:bytes/1024**3,unit:"GB"}:{value:Math.max(1,bytes/1024**2),unit:"MB"};
type UserTotals={storageUsedBytes:number;storageQuotaBytes:number;trashUsedBytes:number;trashQuotaBytes:number};

function ManagedUserFrame({c,user,onClose,children,footer}:{c:CopySet;user:UserSummary;onClose:()=>void;children:ReactNode;footer:ReactNode}){
  const ref=useModalFocus(onClose);return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer managed-user-layer" role="dialog" aria-modal="true" aria-label={`${user.displayName} ${c.userManagement}`}><button className="settings-backdrop" tabIndex={-1} onClick={onClose}/><section className="harness-dialog managed-user-dialog"><header><div><h2>{user.displayName}</h2><p>@{user.username} · {user.role}</p></div><button onClick={onClose} aria-label={c.close}><X size={20}/></button></header>{children}{footer}</section></div>,document.body);
}

function ManagedUserDialog({c,user,currentUserId,currentUserCanAudit,currentUserRole,onChanged,onDeleted,onClose}:{c:CopySet;user:UserSummary;currentUserId:string;currentUserCanAudit:boolean;currentUserRole:string;onChanged:()=>void;onDeleted:()=>void;onClose:()=>void}){
  const ko=c.users==="사용자";const initialQuota=quotaParts(user.storageQuotaBytes),initialTrashQuota=quotaParts(user.trashQuotaBytes);const[name,setName]=useState(user.displayName);const[role,setRole]=useState(user.role);const[auditEnabled,setAuditEnabled]=useState(user.auditEnabled);const[quota,setQuota]=useState(user.storageQuotaUsesDefault?0:initialQuota.value);const[unit,setUnit]=useState<"MB"|"GB">(initialQuota.unit);const[trashQuota,setTrashQuota]=useState(user.trashQuotaUsesDefault?0:initialTrashQuota.value);const[trashUnit,setTrashUnit]=useState<"MB"|"GB">(initialTrashQuota.unit);const[notice,setNotice]=useState("");const[busy,setBusy]=useState(false);const[auditView,setAuditView]=useState<"conversations"|"files">();
  const{dialog:messageDialog,confirm:askConfirm}=useMessageDialog(ko);
  async function save(){setBusy(true);setNotice("");try{const storageQuotaBytes=quota===0?0:Math.round(quota*(unit==="GB"?1024**3:1024**2)),trashQuotaBytes=trashQuota===0?0:Math.round(trashQuota*(trashUnit==="GB"?1024**3:1024**2));const payload=user.id===currentUserId?{storageQuotaBytes,trashQuotaBytes}:{displayName:name,role:user.role==="superadmin"?undefined:role,storageQuotaBytes,trashQuotaBytes,...(currentUserRole==="superadmin"?{auditEnabled:role==="admin"&&auditEnabled}:{})};const response=await fetch(`/api/users/${encodeURIComponent(user.id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const body=await response.json();if(!response.ok)throw new Error(body.error);onChanged();setNotice(c.saved);}catch(error){setNotice(error instanceof Error?error.message:"Unable to update user.");}finally{setBusy(false);}}
  async function remove(){if(!await askConfirm({tone:"danger",title:c.deleteUser,message:c.confirmDeleteUser,detail:`${user.displayName} (@${user.username})`,confirmLabel:c.confirmDelete}))return;setBusy(true);try{const response=await fetch(`/api/users/${encodeURIComponent(user.id)}`,{method:"DELETE"});const body=await response.json();if(!response.ok)throw new Error(body.error);onDeleted();}catch(error){setNotice(error instanceof Error?error.message:"Unable to delete user.");setBusy(false);}}
  const auditUser={id:user.id,username:user.username,displayName:user.displayName};
  if(auditView==="conversations")return <AdminConversationsDialog user={auditUser} ko={ko} onBack={()=>setAuditView(undefined)} onClose={onClose}/>;
  if(auditView==="files")return <AdminFilesDialog user={auditUser} ko={ko} onBack={()=>setAuditView(undefined)} onClose={onClose}/>;
  return <ManagedUserFrame c={c} user={user} onClose={onClose} footer={<>{messageDialog}{notice&&<p className="settings-notice" role="status">{notice}</p>}<footer><button className="secondary-button" onClick={onClose}>{c.close}</button>{user.role!=="superadmin"&&user.id!==currentUserId&&<button className="danger-button" disabled={busy} onClick={()=>void remove()}><Trash2 size={14}/>{c.deleteUser}</button>}</footer></>}>
    <div className="managed-user-scroll"><section className="managed-user-section"><h3>{ko?"계정 및 저장소":"Account and storage"}</h3><div className="form-grid"><label className="field"><span>{c.displayName}</span><input disabled={user.id===currentUserId} value={name} onChange={event=>setName(event.target.value)}/></label><div className="field"><span>{c.role}</span><div className="role-audit-controls">{user.role==="superadmin"||user.id===currentUserId?<input disabled value={user.role}/>:<SelectMenu label={c.role} value={role} options={[{value:"user",label:c.standardUser},{value:"admin",label:c.administrator}]} onChange={value=>{setRole(value as "user"|"admin");if(value!=="admin")setAuditEnabled(false);}}/>}{currentUserRole==="superadmin"&&<label className="audit-permission-toggle"><span>{ko?"감사":"Audit"}</span><button type="button" role="switch" aria-checked={user.role==="superadmin"||auditEnabled} disabled={user.role==="superadmin"||role!=="admin"} className={`toggle ${user.role==="superadmin"||auditEnabled?"on":""}`} onClick={()=>setAuditEnabled(value=>!value)}><i/></button></label>}</div></div></div><div className="quota-editor"><label className="field"><span>{ko?"저장소 할당량":"Storage quota"}</span><input type="number" min={0} step={unit==="GB"?.25:1} value={quota} onChange={event=>setQuota(Math.max(0,Number(event.target.value)))}/></label><label className="field quota-unit"><span>{ko?"단위":"Unit"}</span><SelectMenu label={ko?"용량 단위":"Quota unit"} value={unit} options={[{value:"MB",label:"MB"},{value:"GB",label:"GB"}]} onChange={value=>setUnit(value as "MB"|"GB")}/></label><small>{ko?`현재 ${storageBytesLabel(user.storageUsedBytes)} 사용 · 0은 기본값 (${storageBytesLabel(user.storageQuotaBytes)}) 사용`:`Currently using ${storageBytesLabel(user.storageUsedBytes)} · zero inherits the default (${storageBytesLabel(user.storageQuotaBytes)})`}</small></div><div className="quota-editor"><label className="field"><span>{ko?"휴지통 할당량":"Trash quota"}</span><input type="number" min={0} step={trashUnit==="GB"?.25:1} value={trashQuota} onChange={event=>setTrashQuota(Math.max(0,Number(event.target.value)))}/></label><label className="field quota-unit"><span>{ko?"단위":"Unit"}</span><SelectMenu label={ko?"휴지통 용량 단위":"Trash quota unit"} value={trashUnit} options={[{value:"MB",label:"MB"},{value:"GB",label:"GB"}]} onChange={value=>setTrashUnit(value as "MB"|"GB")}/></label><small>{ko?`현재 ${storageBytesLabel(user.trashUsedBytes)} 사용 · 0은 기본값 (${storageBytesLabel(user.trashQuotaBytes)}) 사용`:`Currently using ${storageBytesLabel(user.trashUsedBytes)} · zero inherits the default (${storageBytesLabel(user.trashQuotaBytes)})`}</small></div><button className="save-button" disabled={busy||!name.trim()||quota<0||trashQuota<0} onClick={()=>void save()}>{busy?c.saving:c.saveChanges}</button></section>
    {currentUserCanAudit&&<section className="managed-user-section"><h3>{ko?"기록 및 파일":"Records and files"}</h3><div className="managed-audit-links"><button onClick={()=>setAuditView("conversations")}><MessageSquareDashed size={18}/><span><strong>{ko?"채팅 기록":"Chat records"}</strong><small>{ko?"검색, 삭제 기록, 모든 분기 웹 보기 및 압축":"Search, deleted records, all-branch review, and export"}</small></span><ChevronRight size={17}/></button><button onClick={()=>setAuditView("files")}><HardDrive size={18}/><span><strong>{ko?"파일 저장소":"File storage"}</strong><small>{ko?"검색, 휴지통, 정렬 및 다운로드":"Search, trash, sorting, and downloads"}</small></span><ChevronRight size={17}/></button></div></section>}</div>
    </ManagedUserFrame>;
}

function UserManagerDialog({c,onClose,onTotals}:{c:CopySet;onClose:()=>void;onTotals:(totals:UserTotals)=>void}){
  const ko=c.users==="사용자";const ref=useModalFocus(onClose);const[users,setUsers]=useState<UserSummary[]>([]);const[page,setPage]=useState(1);const[pageCount,setPageCount]=useState(1);const[total,setTotal]=useState(0);const[query,setQuery]=useState("");const[search,setSearch]=useState("");const[currentUserId,setCurrentUserId]=useState("");const[currentUserCanAudit,setCurrentUserCanAudit]=useState(false);const[currentUserRole,setCurrentUserRole]=useState("");const[username,setUsername]=useState("");const[displayName,setDisplayName]=useState("");const[password,setPassword]=useState("");const[role,setRole]=useState<"user"|"admin">("user");const[notice,setNotice]=useState("");const[busy,setBusy]=useState(false);const[managed,setManaged]=useState<UserSummary>();const[createOpen,setCreateOpen]=useState(false);const[revision,setRevision]=useState(0);
  useEffect(()=>{const timer=window.setTimeout(()=>{setSearch(query.trim());setPage(1);},180);return()=>window.clearTimeout(timer);},[query]);
  useEffect(()=>{const controller=new AbortController();fetch(`/api/users?page=${page}&q=${encodeURIComponent(search)}`,{cache:"no-store",signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error);setUsers(body.users||[]);setTotal(body.total||0);setPageCount(body.pageCount||1);if(body.page!==page)setPage(body.page);setCurrentUserId(body.currentUserId||"");setCurrentUserCanAudit(body.currentUserCanAudit===true);setCurrentUserRole(body.currentUserRole||"");if(body.totals){onTotals(body.totals);setManaged(current=>current?(body.users||[]).find((user:UserSummary)=>user.id===current.id)||current:undefined);}}).catch(error=>{if(error?.name!=="AbortError")setNotice(error instanceof Error?error.message:"Unable to load users.");});return()=>controller.abort();},[onTotals,page,revision,search]);
  async function add(event:FormEvent){event.preventDefault();setBusy(true);setNotice("");try{const response=await fetch("/api/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,displayName:displayName||username,password,role})});const body=await response.json();if(!response.ok)throw new Error(body.error);setUsername("");setDisplayName("");setPassword("");setPage(1);setRevision(value=>value+1);setNotice(c.saved);setCreateOpen(false);}catch(error){setNotice(error instanceof Error?error.message:"Unable to create user.");}finally{setBusy(false);}}
  const changed=()=>setRevision(value=>value+1);
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer managed-user-layer" role="dialog" aria-modal="true" aria-label={c.userManagement}><button className="settings-backdrop" tabIndex={-1} onClick={onClose}/><section className="harness-dialog user-manager-dialog"><header><div><h2>{c.userManagement}</h2><p>{ko?"사용자를 검색하고 계정별 설정을 관리합니다.":"Search users and manage account-specific settings."}</p></div><button onClick={onClose} aria-label={c.close}><X size={20}/></button></header><form className={`user-create-card ${createOpen?"open":""}`} onSubmit={add}><button type="button" className="user-create-toggle" aria-expanded={createOpen} aria-controls="user-create-fields" onClick={()=>setCreateOpen(value=>!value)}><Plus size={16}/><span>{c.addUser}</span><ChevronDown size={16}/></button><div id="user-create-fields" className="user-create-fields"><div className="form-grid"><label className="field"><span>{c.username}</span><input value={username} onChange={event=>setUsername(event.target.value)} required/></label><label className="field"><span>{c.displayName}</span><input value={displayName} onChange={event=>setDisplayName(event.target.value)}/></label></div><div className="form-grid"><label className="field"><span>{c.password}</span><input type="password" minLength={8} value={password} onChange={event=>setPassword(event.target.value)} required/></label><label className="field"><span>{c.role}</span><SelectMenu label={c.role} value={role} options={[{value:"user",label:c.standardUser},{value:"admin",label:c.administrator}]} onChange={value=>setRole(value as "user"|"admin")}/></label></div><button className="subtle-action" disabled={busy}><Plus size={16}/>{c.addUser}</button></div></form><label className="user-search-field"><Search size={16}/><input data-autofocus value={query} onChange={event=>setQuery(event.target.value)} placeholder={ko?"사용자 이름, 표시 이름 또는 ID 검색":"Search username, display name, or ID"}/></label>{notice&&<p className="settings-notice">{notice}</p>}<div className="user-list managed-user-list">{users.map(user=><div key={user.id}><span className="avatar-mini">{user.displayName.charAt(0).toUpperCase()}</span><span className="managed-user-name"><strong>{user.displayName}</strong><small>@{user.username} · {user.role}{user.canAudit?` · ${ko?"감사":"audit"}`:""}</small></span><span className="managed-user-storage"><span><b>{ko?"저장소":"Storage"}</b><strong>{storageBytesLabel(user.storageUsedBytes)}</strong><small>/ {storageBytesLabel(user.storageQuotaBytes)}{user.storageQuotaUsesDefault?` · ${ko?"기본값":"default"}`:""}</small></span><span><b>{ko?"휴지통":"Trash"}</b><strong>{storageBytesLabel(user.trashUsedBytes)}</strong><small>/ {storageBytesLabel(user.trashQuotaBytes)}{user.trashQuotaUsesDefault?` · ${ko?"기본값":"default"}`:""}</small></span></span><button className="subtle-action" onClick={()=>setManaged(user)}><SlidersHorizontal size={15}/>{ko?"관리":"Manage"}</button></div>)}</div>{!users.length&&<p className="audit-empty">{ko?"일치하는 사용자가 없습니다.":"No matching users."}</p>}<nav className="audit-pager"><button disabled={page<=1} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={16}/></button><span>{page} / {pageCount}<small>{ko?`총 ${total}명`:`${total} total`}</small></span><button disabled={page>=pageCount} onClick={()=>setPage(value=>value+1)}><ChevronRight size={16}/></button></nav></section>{managed&&<ManagedUserDialog c={c} user={managed} currentUserId={currentUserId} currentUserCanAudit={currentUserCanAudit} currentUserRole={currentUserRole} onChanged={changed} onDeleted={()=>{setManaged(undefined);setNotice(c.userDeleted);changed();}} onClose={()=>setManaged(undefined)}/>}</div>,document.body);
}

function UsersSettings({ c }: { c: CopySet }) {
  const ko=c.users==="사용자";const[totals,setTotals]=useState<UserTotals>({storageUsedBytes:0,storageQuotaBytes:0,trashUsedBytes:0,trashQuotaBytes:0});const[manager,setManager]=useState(false);const[notice,setNotice]=useState("");
  useEffect(()=>{let cancelled=false;void fetch("/api/users?page=1").then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error);if(!cancelled)setTotals(body.totals);}).catch(error=>{if(!cancelled)setNotice(error instanceof Error?error.message:"Unable to load storage usage.");});return()=>{cancelled=true;};},[]);
  useEffect(()=>{fetch("/api/users?page=1",{cache:"no-store"}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error);if(body.totals)setTotals(body.totals);}).catch(error=>setNotice(error instanceof Error?error.message:"Unable to load users."));},[]);
  return <div className="settings-section"><SectionTitle icon={<Users size={19}/>} title={c.userManagement} description={c.userManagementDesc}/><div className="user-storage-overview full"><div><small>{ko?"전체 저장소 사용량":"Total storage usage"}</small><strong>{storageBytesLabel(totals.storageUsedBytes+totals.trashUsedBytes)} <span>/ {storageBytesLabel(totals.storageQuotaBytes+totals.trashQuotaBytes)}</span></strong><div className="aggregate-storage-bars"><StorageUsageMeter used={totals.storageUsedBytes} total={totals.storageQuotaBytes} label={ko?"실제 저장소":"Active storage"} ko={ko}/><StorageUsageMeter used={totals.trashUsedBytes} total={totals.trashQuotaBytes} label={ko?"휴지통 저장소":"Trash storage"} ko={ko}/></div></div></div><button className="user-manager-launch" onClick={()=>setManager(true)}><Users size={17}/>{ko?"사용자 관리 열기":"Open user management"}<ChevronRight size={16}/></button>{notice&&<p className="settings-notice">{notice}</p>}{manager&&<UserManagerDialog c={c} onClose={()=>setManager(false)} onTotals={setTotals}/>}</div>;
}

function AccountSettings({ c, account, draft, setDraft, onLogout }: { c: CopySet; account?: AccountInfo; draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>>; onLogout: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  async function change(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    try { const response = await fetch("/api/auth/password", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setNotice(c.passwordChanged); window.setTimeout(() => void onLogout(), 800); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Unable to change password."); }
    finally { setBusy(false); }
  }
  return <div className="settings-section"><SectionTitle icon={<UserRound size={19} />} title={account?.displayName || c.account} description={`@${account?.username || ""} · ${account?.role || ""}`} /><div className="account-card"><label className="field"><span>{c.displayName}</span><input value={draft.profile.name} onChange={(event) => setDraft((current) => ({ ...current, profile: { name: event.target.value } }))} /></label></div><form className="account-card" onSubmit={change}><label className="field"><span>{c.currentPassword}</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label className="field"><span>{c.newPassword}</span><input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><button className="save-button" disabled={busy}>{c.changePassword}</button>{notice && <small className="settings-notice">{notice}</small>}</form><button className="sign-out-button" onClick={() => void onLogout()}><LogOut size={16} />{c.signOut}</button></div>;
}

function EmptyState({ text }: { text: string }) { return <div className="empty-state"><UserRound size={22} /><p>{text}</p></div>; }
