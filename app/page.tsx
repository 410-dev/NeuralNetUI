"use client";

import {
  ArrowUp, BrainCircuit, Check, ChevronDown, ChevronLeft, ChevronRight, CirclePlus, Copy, Download, FileJson,
  FileText, GitBranch, ImagePlus, KeyRound, LoaderCircle, Menu, MessageSquarePlus, Pencil, Plus, RefreshCw,
  Search, Server, Settings2, SlidersHorizontal, Sparkles, Square, Trash2, UserRound, X, Globe2, Link2,
  LogOut, Users, ShieldCheck, Clock3, MapPin, ListChecks, Wrench, LocateFixed,
} from "lucide-react";
import { FormEvent, isValidElement, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ChatBranch, Conversation, ConversationSummary, ModelConfig, PublicConfig,
  ReasoningPreset, StoredAttachment, StoredMessage, Locale, AccountInfo, UserSummary, EnabledTools, ToolEvent, MultipleChoiceQuestion,
} from "@/lib/types";
import { advertisedContextWindowTokens, effectiveContextWindowTokens } from "@/lib/model-context";
import { getToolGroupLabel, getToolGroupState, getToolStatusLabel } from "@/lib/tool-presentation";
import { APP_VERSION } from "@/lib/version";

type SettingsTab = "general" | "connection" | "models" | "reasoning" | "users" | "account";
type AuthStatus = { setupRequired: boolean; authenticated: boolean; user: AccountInfo | null };
type MessageRevision = { messageId: string; branchId: string; updatedAt: string };
type QueuedPrompt = {
  id: string;
  content: string;
  attachments: StoredAttachment[];
  modelId: string;
  reasoningPresetId?: string;
  sendReasoning: boolean;
  tools: EnabledTools;
};
type CompletionOptions = Omit<QueuedPrompt, "id" | "content" | "attachments">;
type ChatJobSnapshot = { conversationId: string; branchId: string; status: "running" | "waiting" | "completed" | "stopped" | "error"; message: StoredMessage; error?: string };
const emptyConfig: PublicConfig = {
  server: { baseUrl: "http://localhost:8888/v1", apiKey: "", hasApiKey: false },
  profile: { name: "Luke Song" },
  preferences: { sendReasoningToModel: false, exportReasoning: true, language: "en", onDemand: false, showModelIdentifiers: true },
  models: [],
};
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();
const titleFrom = (text: string) => text.trim().split(/\s+/).slice(0, 7).join(" ").slice(0, 58) || "New chat";

const translations = {
  en: {
    newChat: "New Chat", search: "Search", searchChats: "Search chats…", histories: "Chat histories", exportChat: "Export chat", deleteChat: "Delete chat", deleteAllChats: "Delete all chats", confirmDeleteChat: "Delete this chat permanently?", confirmDeleteAllChats: "Delete all chat histories permanently?",
    historyEmpty: "Your conversations will appear here.", settingsConnections: "Settings & connections", selectModel: "Select a model",
    availableModels: "Available models", manageModels: "Manage models", welcome: "What would you like to explore?",
    messagePlaceholder: "Message your model…", reasoningPreset: "Reasoning preset", native: "Native", template: "Template", default: "default",
    sendPriorReasoning: "Send prior reasoning", sendPriorReasoningDesc: "Include reasoning_content in the next request",
    disclaimer: "Responses may be inaccurate. Verify important information.", stop: "Stop generating", send: "Send message", addToQueue: "Add to queue", queuedMessages: "Queued messages", removeQueuedMessage: "Remove queued message",
    cancel: "Cancel", forkSend: "Fork & send", editBranch: "Edit and branch", reasoning: "Reasoning", copy: "Copy", regenerate: "Regenerate response", regenerateRequest: "Regenerate from this message", deleteMessage: "Delete message", confirmDeleteMessage: "Delete this message?", previousRevision: "Previous revision", nextRevision: "Next revision",
    exportConversation: "Export conversation", exportDescription: "Export every branch as JSON, or the selected branch as Markdown.",
    includeReasoning: "Include reasoning", includeReasoningDesc: "Include model reasoning content in the export.", allBranches: "all branches",
    workspace: "Workspace", settings: "Settings", connection: "Connection", models: "Models", saveChanges: "Save changes", saving: "Saving…",
    serverTitle: "OpenAI-compatible server", serverDesc: "Connect to the hosted API and discover every served model.", baseUrl: "Base URL",
    baseUrlHelp: "Include the API version path, usually /v1.", apiKey: "API key", savedKey: "Saved key ••••••••", requiredKey: "Required by the current server",
    apiKeyHelp: "The key is stored only on this server and is never returned to the browser.", displayName: "Display name",
    discover: "Discover models & capabilities", discoverDesc: "Calls GET /models and keeps every model returned by the server.", detecting: "Detecting…", detectModels: "Detect models",
    modelsTitle: "Models & aliases", modelsDesc: "All served models stay here. Choose which ones appear in the chat interface.", newAlias: "New alias",
    customAlias: "CUSTOM ALIAS", servedModel: "SERVED MODEL", modelId: "Model ID", baseModel: "Base model", servedIdentifier: "Served model identifier",
    description: "Description", systemPrompt: "System prompt", systemPromptPlaceholder: "Applied to every conversation with this model…", deleteAlias: "Delete alias",
    showMain: "Show in main interface", showMainDesc: "Also show this model in the Reasoning section and model picker.", noModel: "No model selected.",
    reasoningTitle: "Reasoning effort", reasoningDesc: "Configure native effort levels and prompt templates separately for each visible model.", addTemplate: "Add template",
    nativeSupport: "Native reasoning support", noEffortMetadata: "No effort metadata advertised. You can configure it manually.", builtIn: "Built-in",
    customTemplate: "Custom template", nativeEffort: "Native effort sent to API", doNotSend: "Do not send", additionalPrompt: "Additional system prompt",
    promptHandling: "System prompt handling", replace: "Replace", prepend: "Prepend", append: "Append", noPresets: "No presets yet. Add one to control this model's reasoning.",
    language: "Language", general: "General", generalTitle: "General settings", generalDesc: "Choose interface and inference behavior.", interfaceLanguage: "Interface language", languageHelp: "The selected language is saved for future visits.", english: "English", korean: "Korean", onDemand: "On demand", onDemandHelp: "Load the selected model through /api/inference/load before each inference request.", showModelIdentifiers: "Show model identifiers", showModelIdentifiersHelp: "Show served identifiers below model names in model lists.", appVersion: "Version", saved: "Saved.", detectSaved: "models and capabilities detected. Save changes to apply.", detectFirst: "Detect a server model first.",
    attachImages: "Attach images", uploadingImages: "Creating thumbnails and uploading…", removeImage: "Remove image", loadEarlier: "Load earlier messages",
    imagesAttached: "images attached", imageChat: "Image chat", imageUploadFailed: "Image upload failed.", maxImages: "You can attach up to 12 images.",
    thinking: "Thinking…", editResponse: "Edit response", saveEdit: "Save", thoughtFor: "Thought for", useWrapping: "Use wrapping", copied: "Copied",
    addMenu: "Add", tools: "Tools", internetSearch: "Internet search", internetSearchDesc: "Let the model search DuckDuckGo", pageVisit: "Visit pages", pageVisitDesc: "Let the model read public web pages", currentTime: "Current time", currentTimeDesc: "Provide local time and time zone to the model", locationTool: "Current location", locationToolDesc: "Use browser location and detailed reverse geocoding", multipleChoice: "Multiple choice", multipleChoiceDesc: "Let the model ask up to three selectable questions", usingTool: "Using a tool…", toolCall: "Tool call", toolResult: "Tool result", submitChoices: "Submit choices", otherChoice: "Other (optional)", locationPermission: "Waiting for browser location permission…",
    account: "Account", users: "Users", signOut: "Sign out", changePassword: "Change password", currentPassword: "Current password", newPassword: "New password", passwordChanged: "Password changed. Please sign in again.",
    userManagement: "User management", userManagementDesc: "Administrators can create accounts, change display names and roles, and delete accounts.", username: "Username", password: "Password", role: "Role", standardUser: "User", administrator: "Administrator", addUser: "Add user", saveDisplayName: "Save user changes", deleteUser: "Delete user", confirmDeleteUser: "Permanently delete this user and all of their data?", userDeleted: "User deleted.", publicModel: "Public custom model", publicModelDesc: "Allow every user to use this custom model.",
    contextWindow: "Context window", contextWindowHelp: "Set a per-model fallback limit. When the API also advertises a limit, the smaller value is used.", aliasContextWindowHelp: "Leave empty to inherit the base model. A value here overrides the base model setting while respecting the server limit.", inheritedContextWindow: "Inherited from base model", apiContextWindow: "API-detected context", effectiveContextWindow: "Effective maximum", contextUsed: "context tokens used", contextUnavailable: "Set this model's context window in Settings.",
    outputTokens: "output tokens", reasoningTokens: "reasoning", tokensPerSecond: "tok/s", timeToFirstToken: "Time to first token",
  },
  ko: {
    newChat: "새 채팅", search: "검색", searchChats: "채팅 검색…", histories: "채팅 기록", exportChat: "채팅 내보내기", deleteChat: "대화 삭제", deleteAllChats: "전체 대화 삭제", confirmDeleteChat: "이 대화를 영구적으로 삭제할까요?", confirmDeleteAllChats: "모든 대화 기록을 영구적으로 삭제할까요?",
    historyEmpty: "대화를 시작하면 여기에 표시됩니다.", settingsConnections: "설정 및 연결", selectModel: "모델 선택",
    availableModels: "사용 가능한 모델", manageModels: "모델 관리", welcome: "무엇을 함께 살펴볼까요?",
    messagePlaceholder: "모델에게 메시지 보내기…", reasoningPreset: "Reasoning 프리셋", native: "내장", template: "템플릿", default: "기본값",
    sendPriorReasoning: "이전 Reasoning 전송", sendPriorReasoningDesc: "다음 요청에 reasoning_content를 포함합니다",
    disclaimer: "응답이 부정확할 수 있습니다. 중요한 정보는 확인해 주세요.", stop: "생성 중단", send: "메시지 전송", addToQueue: "대기열에 추가", queuedMessages: "대기 중인 메시지", removeQueuedMessage: "대기열에서 제거",
    cancel: "취소", forkSend: "분기 후 전송", editBranch: "편집 후 분기", reasoning: "Reasoning", copy: "복사", regenerate: "응답 재생성", regenerateRequest: "이 메시지부터 재생성", deleteMessage: "메시지 삭제", confirmDeleteMessage: "이 메시지를 삭제할까요?", previousRevision: "이전 수정본", nextRevision: "다음 수정본",
    exportConversation: "대화 내보내기", exportDescription: "모든 브랜치를 JSON으로, 선택한 브랜치를 Markdown으로 내보냅니다.",
    includeReasoning: "Reasoning 포함", includeReasoningDesc: "내보내기에 모델의 reasoning 내용을 포함합니다.", allBranches: "모든 브랜치",
    workspace: "워크스페이스", settings: "설정", connection: "연결", models: "모델", saveChanges: "변경사항 저장", saving: "저장 중…",
    serverTitle: "OpenAI 호환 서버", serverDesc: "호스팅된 API에 연결하고 서빙되는 모든 모델을 감지합니다.", baseUrl: "기본 URL",
    baseUrlHelp: "일반적으로 /v1을 포함한 API 버전 경로를 입력합니다.", apiKey: "API 키", savedKey: "저장된 키 ••••••••", requiredKey: "현재 서버에 API 키가 필요합니다",
    apiKeyHelp: "키는 이 서버에만 저장되며 브라우저로 다시 전송되지 않습니다.", displayName: "표시 이름",
    discover: "모델 및 기능 감지", discoverDesc: "GET /models를 호출하고 서버가 반환한 모든 모델을 보존합니다.", detecting: "감지 중…", detectModels: "모델 감지",
    modelsTitle: "모델 및 별칭", modelsDesc: "서빙되는 모든 모델을 보존하고 채팅 화면에 표시할 모델만 선택합니다.", newAlias: "새 별칭",
    customAlias: "커스텀 별칭", servedModel: "서빙 모델", modelId: "모델 ID", baseModel: "기반 모델", servedIdentifier: "서빙 모델 식별자",
    description: "설명", systemPrompt: "시스템 프롬프트", systemPromptPlaceholder: "이 모델의 모든 대화에 적용됩니다…", deleteAlias: "별칭 삭제",
    showMain: "메인 인터페이스에 표시", showMainDesc: "모델 선택기와 Reasoning 섹션에도 이 모델을 표시합니다.", noModel: "선택된 모델이 없습니다.",
    reasoningTitle: "Reasoning 수준", reasoningDesc: "표시된 모델별로 내장 effort와 프롬프트 템플릿을 설정합니다.", addTemplate: "템플릿 추가",
    nativeSupport: "Native Reasoning 지원", noEffortMetadata: "서버가 effort 메타데이터를 제공하지 않았습니다. 수동 설정할 수 있습니다.", builtIn: "내장",
    customTemplate: "커스텀 템플릿", nativeEffort: "API로 전송할 Native effort", doNotSend: "전송하지 않음", additionalPrompt: "추가 시스템 프롬프트",
    promptHandling: "시스템 프롬프트 처리", replace: "대체", prepend: "앞에 추가", append: "뒤에 추가", noPresets: "아직 프리셋이 없습니다. 템플릿을 추가해 주세요.",
    language: "언어", general: "일반", generalTitle: "일반 설정", generalDesc: "인터페이스와 추론 동작을 설정합니다.", interfaceLanguage: "인터페이스 언어", languageHelp: "선택한 언어는 저장되어 다음 접속에도 유지됩니다.", english: "영어", korean: "한국어", onDemand: "On demand", onDemandHelp: "추론 요청 전에 /api/inference/load를 호출해 선택한 모델을 로드합니다.", showModelIdentifiers: "모델 identifier 표시", showModelIdentifiersHelp: "모델 목록에서 모델 이름 아래에 서빙 identifier를 표시합니다.", appVersion: "버전", saved: "저장했습니다.", detectSaved: "개 모델과 기능을 감지했습니다. 저장을 눌러 적용하세요.", detectFirst: "먼저 서버 모델을 감지해 주세요.",
    attachImages: "이미지 첨부", uploadingImages: "썸네일 생성 및 업로드 중…", removeImage: "이미지 제거", loadEarlier: "이전 메시지 불러오기",
    imagesAttached: "개 이미지 첨부", imageChat: "이미지 대화", imageUploadFailed: "이미지 업로드에 실패했습니다.", maxImages: "이미지는 최대 12장까지 첨부할 수 있습니다.",
    thinking: "생각 중…", editResponse: "응답 편집", saveEdit: "저장", thoughtFor: "동안 생각함", useWrapping: "줄 바꿈 사용", copied: "복사됨",
    addMenu: "추가", tools: "도구", internetSearch: "인터넷 검색", internetSearchDesc: "모델이 DuckDuckGo를 검색하도록 허용", pageVisit: "페이지 방문", pageVisitDesc: "모델이 공개 웹 페이지를 읽도록 허용", currentTime: "현재 시간", currentTimeDesc: "현지 시간과 시간대를 모델에 제공", locationTool: "현재 위치", locationToolDesc: "브라우저 위치와 상세 역지오코딩 사용", multipleChoice: "다중 선택", multipleChoiceDesc: "모델이 선택형 질문을 최대 3개까지 요청", usingTool: "도구 사용 중…", toolCall: "도구 호출", toolResult: "도구 결과", submitChoices: "선택 제출", otherChoice: "기타 (선택 사항)", locationPermission: "브라우저 위치 권한을 기다리는 중…",
    account: "계정", users: "사용자", signOut: "로그아웃", changePassword: "비밀번호 변경", currentPassword: "현재 비밀번호", newPassword: "새 비밀번호", passwordChanged: "비밀번호를 변경했습니다. 다시 로그인해 주세요.",
    userManagement: "사용자 관리", userManagementDesc: "관리자는 계정을 만들고, 다른 사용자의 표시 이름과 권한을 변경하거나 계정을 삭제할 수 있습니다.", username: "사용자 이름", password: "비밀번호", role: "역할", standardUser: "일반 사용자", administrator: "관리자", addUser: "사용자 추가", saveDisplayName: "사용자 변경 저장", deleteUser: "사용자 삭제", confirmDeleteUser: "이 사용자와 모든 데이터를 영구적으로 삭제할까요?", userDeleted: "사용자를 삭제했습니다.", publicModel: "커스텀 모델 공개", publicModelDesc: "모든 사용자가 이 커스텀 모델을 사용할 수 있습니다.",
    contextWindow: "컨텍스트 윈도우", contextWindowHelp: "모델별 대체 한도를 설정합니다. API도 한도를 반환하면 둘 중 작은 값을 사용합니다.", aliasContextWindowHelp: "비워 두면 기반 모델 값을 상속합니다. 값을 입력하면 서버 한도 안에서 기반 모델 설정을 오버라이드합니다.", inheritedContextWindow: "기반 모델에서 상속", apiContextWindow: "API 감지 컨텍스트", effectiveContextWindow: "적용 최대값", contextUsed: "컨텍스트 토큰 사용", contextUnavailable: "설정에서 이 모델의 컨텍스트 윈도우를 지정해 주세요.",
    outputTokens: "출력 토큰", reasoningTokens: "reasoning", tokensPerSecond: "토큰/초", timeToFirstToken: "첫 토큰 도착 시간",
  },
} as const;
type CopySet = typeof translations.en | typeof translations.ko;
const copyFor = (locale: Locale): CopySet => translations[locale];

function formatThoughtDuration(totalSeconds: number, locale: Locale) {
  const total = Math.max(1, Math.round(totalSeconds)); const minutes = Math.floor(total / 60); const seconds = total % 60;
  if (locale === "ko") return `${minutes ? `${minutes}분 ` : ""}${seconds}초 동안 생각함`;
  return `Thought for ${minutes ? `${minutes} min ` : ""}${seconds} sec`;
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
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [histories, setHistories] = useState<ConversationSummary[]>([]);
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [sendReasoning, setSendReasoning] = useState(false);
  const [draftAttachments, setDraftAttachments] = useState<StoredAttachment[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [internetSearchEnabled, setInternetSearchEnabled] = useState(false);
  const [pageVisitEnabled, setPageVisitEnabled] = useState(false);
  const [currentTimeEnabled, setCurrentTimeEnabled] = useState(true);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [multipleChoiceEnabled, setMultipleChoiceEnabled] = useState(true);
  const [renderedMessageCount, setRenderedMessageCount] = useState(60);
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const abandonRef = useRef(false);
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);
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
    if (deleteAttachments) queued?.attachments.forEach((attachment) => fetch(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined));
  }

  function clearQueuedPrompts() {
    const queued = queuedPromptsRef.current;
    replaceQueue([]);
    queued.forEach((prompt) => prompt.attachments.forEach((attachment) => fetch(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined)));
  }

  useEffect(() => { fetch("/api/auth/status").then((response) => response.json()).then(setAuth).catch(() => setAuth({ setupRequired: false, authenticated: false, user: null })); }, []);

  useEffect(() => {
    if (!auth?.authenticated) return;
    Promise.all([fetch("/api/config").then((r) => r.json()), fetch("/api/conversations").then((r) => r.json())])
      .then(async ([next, stored]: [PublicConfig, { conversations: ConversationSummary[] }]) => {
        setConfig(next); setSendReasoning(next.preferences.sendReasoningToModel);
        setHistories(stored.conversations || []);
        const first = next.models.find((model) => model.visible !== false);
        if (first) { selectedModelIdRef.current = first.id; setSelectedModelId(first.id); setSelectedPresetId(first.reasoningPresets[0]?.id || ""); }
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

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);
  const locale = config.preferences.language || "en";
  const c = copyFor(locale);
  const visibleModels = config.models.filter((model) => model.visible !== false);
  const selectedModel = visibleModels.find((model) => model.id === selectedModelId) || visibleModels[0];
  const selectedPreset = selectedModel?.reasoningPresets.find((preset) => preset.id === selectedPresetId) || selectedModel?.reasoningPresets[0];
  const activeBranch = conversation?.branches.find((branch) => branch.id === conversation.activeBranchId);
  const contextUsedTokens = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].totalTokens !== undefined) return messages[index].totalTokens;
    }
    return undefined;
  }, [messages]);
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
  const userFirstName = config.profile.name.trim().split(/\s+/)[0] || "there";
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (locale === "ko") return `${hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후예요" : "좋은 저녁이에요"}, ${userFirstName}님.`;
    return `Good ${hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening"}, ${userFirstName}.`;
  }, [userFirstName, locale]);

  async function refreshHistories() {
    const result = await fetch("/api/conversations").then((r) => r.json());
    setHistories(result.conversations || []);
  }

  async function persist(next: Conversation, create = false) {
    setConversation(next);
    await fetch(create ? "/api/conversations" : `/api/conversations/${next.id}`, {
      method: create ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
    });
    await refreshHistories();
  }

  function chooseModel(model: ModelConfig) {
    selectedModelIdRef.current = model.id; setSelectedModelId(model.id); setSelectedPresetId(model.reasoningPresets[0]?.id || ""); setModelMenuOpen(false);
  }

  function navigateToChat(id: string, replace = false) {
    const method = replace ? "replaceState" : "pushState";
    window.history[method]({}, "", `/chat/${encodeURIComponent(id)}`);
  }

  function newChat(replaceUrl = false) {
    abandonRef.current = true; abortRef.current?.abort();
    clearQueuedPrompts();
    draftAttachments.forEach((attachment) => fetch(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined));
    const id = crypto.randomUUID(); pendingConversationIdRef.current = id; navigateToChat(id, replaceUrl);
    setDraftAttachments([]); setRenderedMessageCount(60); setIsGenerating(false); setConversation(null); setMessages([]); setDraft(""); setError(""); setMobileOpen(false);
  }

  function resetWorkspaceForAuthChange() {
    abandonRef.current = true; abortRef.current?.abort(); clearQueuedPrompts();
    setConfig(structuredClone(emptyConfig)); selectedModelIdRef.current = ""; setSelectedModelId(""); setSelectedPresetId("");
    setConversation(null); setMessages([]); setHistories([]); setDraft(""); setDraftAttachments([]); setIsGenerating(false); setError("");
    setSearchText(""); setSearching(false); setExportOpen(false); setMobileOpen(false);
  }

  async function loadConversation(id: string, navigate = true, allowNew = false) {
    try {
      abandonRef.current = true; abortRef.current?.abort(); clearQueuedPrompts();
      const response = await fetch(`/api/conversations/${id}`); const body = await response.json();
      if (!response.ok) {
        if (response.status === 404 && allowNew) { pendingConversationIdRef.current = id; setConversation(null); setMessages([]); setError(""); return; }
        throw new Error(body.error);
      }
      const next = normalizeConversationRevisions(body as Conversation);
      const branch = next.branches.find((item: ChatBranch) => item.id === next.activeBranchId) || next.branches[0];
      setConversation(next); setMessages(branch?.messages || []); selectedModelIdRef.current = next.modelId; setSelectedModelId(next.modelId);
      setRenderedMessageCount(60);
      setSelectedPresetId(next.reasoningPresetId || ""); setMobileOpen(false); setError("");
      pendingConversationIdRef.current = next.id; if (navigate) navigateToChat(next.id);
      void watchChatJob(next, branch?.id || next.activeBranchId, true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "대화를 불러오지 못했습니다."); }
  }

  async function deleteHistory(id: string) {
    if (!window.confirm(c.confirmDeleteChat)) return;
    try {
      if (id === conversation?.id) { await fetch(`/api/chat/${id}`, { method: "DELETE" }).catch(() => undefined); newChat(); }
      const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || c.deleteChat); }
      setHistories((current) => current.filter((item) => item.id !== id));
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.deleteChat); }
  }

  async function deleteAllHistories() {
    if (!histories.length || !window.confirm(c.confirmDeleteAllChats)) return;
    try {
      if (conversation?.id) await fetch(`/api/chat/${conversation.id}`, { method: "DELETE" }).catch(() => undefined);
      newChat();
      const response = await fetch("/api/conversations", { method: "DELETE" });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || c.deleteAllChats); }
      setHistories([]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.deleteAllChats); }
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
      id: pendingConversationIdRef.current || crypto.randomUUID(), title: firstMessage.content.trim() ? titleFrom(firstMessage.content) : c.imageChat, modelId: model.id,
      reasoningPresetId: preset?.id, activeBranchId: branchId, createdAt: stamp, updatedAt: stamp,
      branches: [{ id: branchId, name: "Main", messages: [firstMessage], createdAt: stamp, updatedAt: stamp }],
    };
  }

  async function refreshModelContextWindow(modelId: string) {
    try {
      const response = await fetch("/api/models/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
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
    if (!conversation?.id && !pendingConversationIdRef.current) return;
    const conversationId = conversation?.id || pendingConversationIdRef.current;
    const response = await fetch(`/api/chat/${conversationId}/input`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toolCallId, value }) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); setError(body.error || "도구 입력을 전달하지 못했습니다."); }
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
          if (response.status === 404) { if (!silent404) setError("실행 중인 채팅 작업을 찾지 못했습니다."); return working; }
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
      if (terminal.error) setError(terminal.error);
      const response = await fetch(`/api/conversations/${working.id}`, { cache: "no-store" });
      if (!response.ok) return working;
      const latest = normalizeConversationRevisions(await response.json() as Conversation);
      const latestBranch = latest.branches.find((item) => item.id === branchId) || latest.branches[0];
      setConversation(latest); setMessages(latestBranch?.messages || []); await refreshHistories(); return latest;
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setIsGenerating(false); }
    }
  }

  async function runCompletion(working: Conversation, branchId: string, requestMessages: StoredMessage[], create = false, revisionGroupId?: string, options?: CompletionOptions): Promise<Conversation | null> {
    const requestedModelId = options?.modelId || selectedModelIdRef.current;
    const liveModel = visibleModels.find((model) => model.id === requestedModelId);
    if (liveModel) {
      const requestedPresetId = options?.reasoningPresetId || selectedPresetId;
      const livePreset = liveModel.reasoningPresets.find((preset) => preset.id === requestedPresetId) || liveModel.reasoningPresets[0];
      working = { ...working, modelId: liveModel.id, reasoningPresetId: livePreset?.id };
    }
    const placeholder: StoredMessage = { id: uid("assistant"), revisionGroupId, role: "assistant", content: "", reasoning: "", createdAt: now() };
    setMessages([...requestMessages, placeholder]); setIsGenerating(true); setError("");
    await persist(working, create);
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: working.id, branchId, assistantMessageId: placeholder.id, revisionGroupId, modelId: working.modelId, reasoningPresetId: working.reasoningPresetId, sendReasoning: options?.sendReasoning ?? sendReasoning,
          tools: options?.tools || { internetSearch: internetSearchEnabled, pageVisit: pageVisitEnabled, currentTime: currentTimeEnabled, location: locationEnabled, multipleChoice: multipleChoiceEnabled },
          clientContext: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language },
          messages: requestMessages.map((message) => ({ role: message.role, content: message.content, reasoning_content: message.reasoning, attachments: message.attachments?.map(({ id }) => ({ id })) })) }),
      });
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error || `요청에 실패했습니다 (${response.status})`); }
      const completed = await watchChatJob(working, branchId); if (completed) void refreshModelContextWindow(working.modelId); return completed;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "채팅 요청에 실패했습니다."); setMessages(requestMessages); setIsGenerating(false); return working;
    }
  }

  async function runCompletionAndDrain(working: Conversation, branchId: string, requestMessages: StoredMessage[], create = false, revisionGroupId?: string, options?: CompletionOptions) {
    let latest = await runCompletion(working, branchId, requestMessages, create, revisionGroupId, options);
    while (latest && !abandonRef.current && queuedPromptsRef.current.length) {
      const queued = queuedPromptsRef.current[0];
      removeQueuedPrompt(queued.id, false);
      const model = visibleModels.find((item) => item.id === queued.modelId) || visibleModels[0];
      if (!model) {
        queued.attachments.forEach((attachment) => fetch(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined));
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
    if (isGenerating) {
      if (!hasMessage) {
        const id = conversation?.id || pendingConversationIdRef.current;
        if (id) await fetch(`/api/chat/${id}`, { method: "DELETE" }).catch(() => undefined);
        return;
      }
      if (!requestModel || uploadingImages) return;
      const queued: QueuedPrompt = { id: uid("user"), content: text, attachments: draftAttachments, modelId: requestModel.id, reasoningPresetId: requestPreset?.id, sendReasoning,
        tools: { internetSearch: internetSearchEnabled, pageVisit: pageVisitEnabled, currentTime: currentTimeEnabled, location: locationEnabled, multipleChoice: multipleChoiceEnabled } };
      replaceQueue([...queuedPromptsRef.current, queued]); setDraft(""); setDraftAttachments([]); return;
    }
    if (!hasMessage || !requestModel || uploadingImages) return;
    const attachments = draftAttachments;
    const userMessage: StoredMessage = { id: uid("user"), role: "user", content: text, attachments, createdAt: now() }; setDraft(""); setDraftAttachments([]);
    const options: CompletionOptions = { modelId: requestModel.id, reasoningPresetId: requestPreset?.id, sendReasoning,
      tools: { internetSearch: internetSearchEnabled, pageVisit: pageVisitEnabled, currentTime: currentTimeEnabled, location: locationEnabled, multipleChoice: multipleChoiceEnabled } };
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
    const edited: StoredMessage = { ...original, id: uid("assistant"), revisionGroupId, content, createdAt: stamp };
    const path = [...source.messages.slice(0, index), edited];
    const branch: ChatBranch = { id: newBranchId, name: `${locale === "ko" ? "응답 수정" : "Response edit"} ${conversation.branches.length + 1}`, parentBranchId: source.id,
      forkedFromMessageId: messageId, messages: path, createdAt: stamp, updatedAt: stamp };
    const next: Conversation = { ...conversation, activeBranchId: newBranchId, updatedAt: stamp, branches: [...conversation.branches, branch] };
    setMessages(path); await persist(next);
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
    if (!conversation || isGenerating || !window.confirm(c.confirmDeleteMessage)) return;
    const source = activeBranch || conversation.branches[0]; if (!source) return;
    const message = source.messages.find((item) => item.id === messageId); if (message?.role !== "user") return;
    const stamp = now(); const nextMessages = source.messages.filter((item) => item.id !== messageId);
    const next: Conversation = { ...conversation, updatedAt: stamp, branches: conversation.branches.map((branch) => branch.id === source.id ? { ...branch, messages: nextMessages, updatedAt: stamp } : branch) };
    setMessages(nextMessages); await persist(next);
  }

  async function toggleSendReasoning(value: boolean) {
    setSendReasoning(value);
    const next = { ...config, preferences: { ...config.preferences, sendReasoningToModel: value } };
    setConfig(next);
    await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
  }

  async function uploadImages(files: File[]) {
    const remaining = 12 - draftAttachments.length;
    if (remaining <= 0) { setError(c.maxImages); return; }
    const selected = files.filter((file) => file.type.startsWith("image/")).slice(0, remaining);
    if (!selected.length) return;
    setUploadingImages(true); setError("");
    try {
      const prepared = await Promise.all(selected.map(async (file) => ({ file, ...(await createThumbnail(file)) })));
      const form = new FormData();
      prepared.forEach(({ file, thumbnail, width, height }) => { form.append("files", file); form.append("thumbnails", thumbnail); form.append("dimensions", JSON.stringify({ width, height })); });
      const response = await fetch("/api/uploads", { method: "POST", body: form }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || c.imageUploadFailed);
      setDraftAttachments((current) => [...current, ...body.attachments].slice(0, 12));
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.imageUploadFailed); }
    finally { setUploadingImages(false); }
  }

  async function removeDraftAttachment(attachment: StoredAttachment) {
    setDraftAttachments((current) => current.filter((item) => item.id !== attachment.id));
    await fetch(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
  }

  if (!auth) return <div className="auth-shell"><LoaderCircle className="spin" size={28} /></div>;
  if (!auth.authenticated) return <AuthScreen setup={auth.setupRequired} onAuthenticated={async () => setAuth(await fetch("/api/auth/status").then((response) => response.json()))} />;

  const visibleHistory = histories.filter((item) => item.title.toLowerCase().includes(searchText.toLowerCase()));
  const hiddenMessageCount = Math.max(0, messages.length - renderedMessageCount);
  const renderedMessages = hiddenMessageCount ? messages.slice(-renderedMessageCount) : messages;
  function loadEarlierMessages() {
    const element = threadRef.current; const previousHeight = element?.scrollHeight || 0;
    setRenderedMessageCount((count) => Math.min(messages.length, count + 60));
    requestAnimationFrame(() => { if (element) element.scrollTop += element.scrollHeight - previousHeight; });
  }
  return (
    <main className={`app-shell ${messages.length ? "chat-active" : "chat-idle"}`}>
      <button className="mobile-menu" aria-label={locale === "ko" ? "메뉴 열기" : "Open menu"} onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
      <aside className={`sidebar ${mobileOpen ? "mobile-visible" : ""}`}>
        <section className="side-panel">
          <div className="new-chat-halo"><button className="pill-button primary-nav" onClick={() => newChat()}><MessageSquarePlus size={19} /> {c.newChat}</button></div>
          <button className="pill-button" onClick={() => setSearching((value) => !value)}><Search size={18} /> {c.search}</button>
          {searching && <input className="history-search" autoFocus value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={c.searchChats} />}
          <div className="history-heading"><p className="section-label">{c.histories}</p><div>{conversation && <button onClick={() => setExportOpen(true)} title={c.exportChat} aria-label={c.exportChat}><Download size={15} /></button>}{histories.length > 0 && <button onClick={() => void deleteAllHistories()} title={c.deleteAllChats} aria-label={c.deleteAllChats}><Trash2 size={15} /></button>}</div></div>
          <div className="history-list">
            {visibleHistory.map((item) => <div className={`history-row ${item.id === conversation?.id ? "active" : ""}`} key={item.id}><button className="history-item" onClick={() => loadConversation(item.id)}><span>{item.title}</span>{item.branchCount > 1 && <b><GitBranch size={11} />{item.branchCount}</b>}</button><button className="history-delete" onClick={() => void deleteHistory(item.id)} title={c.deleteChat} aria-label={`${c.deleteChat}: ${item.title}`}><Trash2 size={13} /></button></div>)}
            {!visibleHistory.length && <p className="history-empty">{c.historyEmpty}</p>}
          </div>
        </section>
        <button className="profile-card" onClick={() => { setSettingsOpen(true); setMobileOpen(false); }}><span className="avatar">{config.profile.name.charAt(0).toUpperCase() || "U"}</span><span><strong>{config.profile.name}</strong><small>{c.settingsConnections}</small></span><Settings2 size={17} /></button>
      </aside>
      {mobileOpen && <button className="mobile-scrim" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)} />}

      <section className="chat-surface">
        <div className="ambient-glow" />
        <div className="model-switcher">
          <button className="model-trigger" onClick={() => setModelMenuOpen((value) => !value)}><span>{selectedModel?.name || c.selectModel}</span><ChevronDown size={16} className={modelMenuOpen ? "rotate" : ""} /></button>
          {modelMenuOpen && <div className="popover model-popover"><div className="popover-heading"><span>{c.availableModels}</span><small>{visibleModels.length}</small></div>{visibleModels.map((model) => <button className="model-option" key={model.id} onClick={() => chooseModel(model)}><span className="selection-dot">{model.id === selectedModel?.id && <Check size={13} />}</span><span><strong>{model.name}</strong>{config.preferences.showModelIdentifiers !== false && <small>{model.sourceModel}</small>}<em>{model.description}</em></span>{model.isAlias && <b>ALIAS</b>}</button>)}<button className="manage-link" onClick={() => { setModelMenuOpen(false); setSettingsOpen(true); }}><Settings2 size={15} /> {c.manageModels}</button></div>}
        </div>

        <div className="conversation-stage">
          {!messages.length ? <div className="idle-center"><div className="welcome"><div className="welcome-mark"><Sparkles size={19} /></div><h1>{greeting}</h1><p>{c.welcome}</p></div><Composer c={c} draft={draft} setDraft={setDraft} sendMessage={sendMessage} keyDown={handleComposerKeyDown} isGenerating={isGenerating} queuedPrompts={queuedPrompts} onRemoveQueuedPrompt={removeQueuedPrompt} selectedModel={selectedModel} models={config.models} selectedPreset={selectedPreset} contextUsedTokens={contextUsedTokens} presetOpen={presetMenuOpen} setPresetOpen={setPresetMenuOpen} setPreset={setSelectedPresetId} sendReasoning={sendReasoning} toggleSendReasoning={toggleSendReasoning} error={error} clearError={() => setError("")} attachments={draftAttachments} uploadingImages={uploadingImages} onFiles={uploadImages} onRemoveAttachment={removeDraftAttachment} internetSearchEnabled={internetSearchEnabled} setInternetSearchEnabled={setInternetSearchEnabled} pageVisitEnabled={pageVisitEnabled} setPageVisitEnabled={setPageVisitEnabled} currentTimeEnabled={currentTimeEnabled} setCurrentTimeEnabled={setCurrentTimeEnabled} locationEnabled={locationEnabled} setLocationEnabled={setLocationEnabled} multipleChoiceEnabled={multipleChoiceEnabled} setMultipleChoiceEnabled={setMultipleChoiceEnabled} /></div> : <>
            <div className="thread" ref={threadRef} aria-live="polite">
              {hiddenMessageCount > 0 && <button className="load-earlier" onClick={loadEarlierMessages}>{c.loadEarlier} · {hiddenMessageCount}</button>}
              {renderedMessages.map((message) => <Message c={c} locale={locale} key={message.id} message={message} pending={isGenerating && message.id === messages[messages.length - 1]?.id} revisions={messageRevisions.get(message.revisionGroupId || message.id) || []} onFork={forkFromMessage} onEditAssistant={editAssistantMessage} onRegenerate={regenerateAssistantMessage} onRegenerateUser={regenerateUserMessage} onDeleteUser={deleteUserMessage} onRevision={(branchId) => void switchBranch(branchId)} onToolInput={submitToolInput} />)}
            </div>
            <Composer c={c} draft={draft} setDraft={setDraft} sendMessage={sendMessage} keyDown={handleComposerKeyDown} isGenerating={isGenerating} queuedPrompts={queuedPrompts} onRemoveQueuedPrompt={removeQueuedPrompt} selectedModel={selectedModel} models={config.models} selectedPreset={selectedPreset} contextUsedTokens={contextUsedTokens} presetOpen={presetMenuOpen} setPresetOpen={setPresetMenuOpen} setPreset={setSelectedPresetId} sendReasoning={sendReasoning} toggleSendReasoning={toggleSendReasoning} error={error} clearError={() => setError("")} attachments={draftAttachments} uploadingImages={uploadingImages} onFiles={uploadImages} onRemoveAttachment={removeDraftAttachment} internetSearchEnabled={internetSearchEnabled} setInternetSearchEnabled={setInternetSearchEnabled} pageVisitEnabled={pageVisitEnabled} setPageVisitEnabled={setPageVisitEnabled} currentTimeEnabled={currentTimeEnabled} setCurrentTimeEnabled={setCurrentTimeEnabled} locationEnabled={locationEnabled} setLocationEnabled={setLocationEnabled} multipleChoiceEnabled={multipleChoiceEnabled} setMultipleChoiceEnabled={setMultipleChoiceEnabled} />
          </>}
        </div>
      </section>

      {settingsOpen && <SettingsPanel initial={config} onClose={() => setSettingsOpen(false)} onLogout={async () => { resetWorkspaceForAuthChange(); await fetch("/api/auth/logout", { method: "POST" }); setSettingsOpen(false); setAuth({ setupRequired: false, authenticated: false, user: null }); }} onSaved={(next) => { setConfig(next); setSendReasoning(next.preferences.sendReasoningToModel); const model = next.models.find((item) => item.visible !== false && item.id === selectedModelIdRef.current) || next.models.find((item) => item.visible !== false); selectedModelIdRef.current = model?.id || ""; setSelectedModelId(model?.id || ""); setSelectedPresetId(model?.reasoningPresets[0]?.id || ""); }} />}
      {exportOpen && conversation && <ExportDialog c={c} conversation={conversation} initialIncludeReasoning={config.preferences.exportReasoning} onClose={() => setExportOpen(false)} onPreference={(value) => { const next = { ...config, preferences: { ...config.preferences, exportReasoning: value } }; setConfig(next); fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }); }} />}
    </main>
  );
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

function ContextWindowIndicator({ c, locale, model, models, usedTokens }: { c: CopySet; locale: Locale; model?: ModelConfig; models: ModelConfig[]; usedTokens?: number }) {
  const [open, setOpen] = useState(false);
  const maximum = effectiveContextWindowTokens(model, models);
  const used = Math.max(0, usedTokens || 0);
  const percentage = maximum ? Math.min(100, used / maximum * 100) : 0;
  const percentageLabel = percentage > 0 && percentage < .1 ? "<0.1%" : `${percentage.toFixed(1)}%`;
  const detail = maximum
    ? `${formatTokens(used, locale)} / ${formatTokens(maximum, locale)} ${c.contextUsed} · ${percentageLabel}`
    : c.contextUnavailable;
  return <div className={`context-indicator ${open ? "open" : ""}`}>
    <button type="button" className="context-trigger" aria-label={detail} aria-expanded={open} onClick={() => setOpen((value) => !value)} onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
      <span className="context-donut" style={{ "--context-fill": `${percentage * 3.6}deg` } as React.CSSProperties} />
    </button>
    <span className="context-tooltip" role="tooltip">{maximum ? <><strong>{formatTokens(used, locale)} / {formatTokens(maximum, locale)}</strong><small>{percentageLabel} · {c.contextUsed}</small></> : <small>{detail}</small>}</span>
  </div>;
}

function Composer(props: { c: CopySet; draft: string; setDraft: (value: string) => void; sendMessage: (event?: FormEvent) => Promise<void>; keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; isGenerating: boolean; queuedPrompts: QueuedPrompt[]; onRemoveQueuedPrompt: (id: string) => void; selectedModel?: ModelConfig; models: ModelConfig[]; selectedPreset?: ReasoningPreset; contextUsedTokens?: number; presetOpen: boolean; setPresetOpen: (value: boolean) => void; setPreset: (id: string) => void; sendReasoning: boolean; toggleSendReasoning: (value: boolean) => void; error: string; clearError: () => void; attachments: StoredAttachment[]; uploadingImages: boolean; onFiles: (files: File[]) => void; onRemoveAttachment: (attachment: StoredAttachment) => void; internetSearchEnabled: boolean; setInternetSearchEnabled: (value: boolean) => void; pageVisitEnabled: boolean; setPageVisitEnabled: (value: boolean) => void; currentTimeEnabled: boolean; setCurrentTimeEnabled: (value: boolean) => void; locationEnabled: boolean; setLocationEnabled: (value: boolean) => void; multipleChoiceEnabled: boolean; setMultipleChoiceEnabled: (value: boolean) => void }) {
  const { c, draft, setDraft, sendMessage, keyDown, isGenerating, queuedPrompts, onRemoveQueuedPrompt, selectedModel, models, selectedPreset, contextUsedTokens, presetOpen, setPresetOpen, setPreset, sendReasoning, toggleSendReasoning, error, clearError, attachments, uploadingImages, onFiles, onRemoveAttachment, internetSearchEnabled, setInternetSearchEnabled, pageVisitEnabled, setPageVisitEnabled, currentTimeEnabled, setCurrentTimeEnabled, locationEnabled, setLocationEnabled, multipleChoiceEnabled, setMultipleChoiceEnabled } = props;
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
  const showStop = isGenerating && !hasDraftMessage;
  return <div className="composer-wrap">
    {error && <div className="error-toast"><span>{error}</span><button onClick={clearError}><X size={15} /></button></div>}
    <form className="composer" onSubmit={sendMessage}>
      <input ref={fileRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => { onFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
      {queuedPrompts.length > 0 && <div className="queued-prompts"><p><span>{c.queuedMessages}</span><b>{queuedPrompts.length}</b></p>{queuedPrompts.map((prompt, index) => <div key={prompt.id}><b>{index + 1}</b><span><strong>{prompt.content || c.imageChat}</strong>{prompt.attachments.length > 0 && <small>{prompt.attachments.length} {c.imagesAttached}</small>}</span><button type="button" title={c.removeQueuedMessage} aria-label={c.removeQueuedMessage} onClick={() => onRemoveQueuedPrompt(prompt.id)}><X size={13} /></button></div>)}</div>}
      {attachments.length > 0 && <div className="draft-attachments">{attachments.map((attachment) => <div className="draft-image" key={attachment.id}><img src={attachment.thumbnailUrl} alt={attachment.name} loading="lazy" decoding="async" /><button type="button" title={c.removeImage} onClick={() => onRemoveAttachment(attachment)}><X size={13} /></button></div>)}</div>}
      {uploadingImages && <div className="uploading-images"><LoaderCircle size={14} />{c.uploadingImages}</div>}
      <textarea aria-label={c.messagePlaceholder} rows={draft ? 2 : 1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={keyDown} placeholder={c.messagePlaceholder} />
      <div className="composer-actions">
        <div className="add-menu-wrap" ref={addMenuRef}>
          <button type="button" className={`icon-button ${addMenuOpen ? "active" : ""}`} title={c.addMenu} onClick={() => setAddMenuOpen((value) => !value)}><Plus size={20} /></button>
          {addMenuOpen && <div className="popover add-menu-popover">
            <button type="button" className="add-menu-action" onClick={() => { fileRef.current?.click(); setAddMenuOpen(false); }} disabled={uploadingImages || attachments.length >= 12}><ImagePlus size={17} /><span><strong>{c.attachImages}</strong></span></button>
            <p>{c.tools}</p>
             <div className="tool-toggle-row"><Globe2 size={17} /><span><strong>{c.internetSearch}</strong><small>{c.internetSearchDesc}</small></span><button type="button" role="switch" aria-checked={internetSearchEnabled} className={`toggle ${internetSearchEnabled ? "on" : ""}`} onClick={() => setInternetSearchEnabled(!internetSearchEnabled)}><i /></button></div>
             <div className="tool-toggle-row"><Link2 size={17} /><span><strong>{c.pageVisit}</strong><small>{c.pageVisitDesc}</small></span><button type="button" role="switch" aria-checked={pageVisitEnabled} className={`toggle ${pageVisitEnabled ? "on" : ""}`} onClick={() => setPageVisitEnabled(!pageVisitEnabled)}><i /></button></div>
             <div className="tool-toggle-row"><Clock3 size={17} /><span><strong>{c.currentTime}</strong><small>{c.currentTimeDesc}</small></span><button type="button" role="switch" aria-checked={currentTimeEnabled} className={`toggle ${currentTimeEnabled ? "on" : ""}`} onClick={() => setCurrentTimeEnabled(!currentTimeEnabled)}><i /></button></div>
             <div className="tool-toggle-row"><MapPin size={17} /><span><strong>{c.locationTool}</strong><small>{c.locationToolDesc}</small></span><button type="button" role="switch" aria-checked={locationEnabled} className={`toggle ${locationEnabled ? "on" : ""}`} onClick={() => setLocationEnabled(!locationEnabled)}><i /></button></div>
             <div className="tool-toggle-row"><ListChecks size={17} /><span><strong>{c.multipleChoice}</strong><small>{c.multipleChoiceDesc}</small></span><button type="button" role="switch" aria-checked={multipleChoiceEnabled} className={`toggle ${multipleChoiceEnabled ? "on" : ""}`} onClick={() => setMultipleChoiceEnabled(!multipleChoiceEnabled)}><i /></button></div>
          </div>}
        </div>
        {attachments.length > 0 && <small className="attachment-count">{attachments.length} {c.imagesAttached}</small>}
        {(internetSearchEnabled || pageVisitEnabled || currentTimeEnabled || locationEnabled || multipleChoiceEnabled) && <small className="enabled-tools"><Wrench size={11} />{Number(internetSearchEnabled) + Number(pageVisitEnabled) + Number(currentTimeEnabled) + Number(locationEnabled) + Number(multipleChoiceEnabled)}</small>}
        <span className="composer-spacer" />
        <ContextWindowIndicator c={c} locale={c === translations.ko ? "ko" : "en"} model={selectedModel} models={models} usedTokens={contextUsedTokens} />
        <div className="preset-switcher"><button type="button" className="preset-trigger" disabled={!selectedModel?.reasoningPresets.length} onClick={() => setPresetOpen(!presetOpen)}><BrainCircuit size={16} /><span>{selectedPreset?.name || c.default}</span><ChevronDown size={14} /></button>{presetOpen && <div className="popover preset-popover"><p>{c.reasoningPreset}</p>{selectedModel?.reasoningPresets.map((preset) => <button type="button" key={preset.id} onClick={() => { setPreset(preset.id); setPresetOpen(false); }}><span className="selection-dot">{preset.id === selectedPreset?.id && <Check size={12} />}</span><span>{preset.name}<small>{preset.kind === "builtin" ? `${c.native} · ${preset.effort || c.default}` : `${c.template}${preset.effort ? ` · ${preset.effort}` : ""}`}</small></span></button>)}<div className="reasoning-send-toggle"><span><strong>{c.sendPriorReasoning}</strong><small>{c.sendPriorReasoningDesc}</small></span><button type="button" role="switch" aria-checked={sendReasoning} className={`toggle ${sendReasoning ? "on" : ""}`} onClick={() => toggleSendReasoning(!sendReasoning)}><i /></button></div></div>}</div>
        <button className={`send-button ${showStop ? "stopping" : ""}`} type="submit" disabled={uploadingImages} aria-label={showStop ? c.stop : isGenerating ? c.addToQueue : c.send}>{showStop ? <Square size={14} fill="currentColor" /> : <ArrowUp size={20} />}</button>
      </div>
    </form>
    <p className="composer-note">{c.disclaimer}</p>
  </div>;
}

function CodeSnippet({ c, children }: { c: CopySet; children: ReactNode }) {
  const [wrapping, setWrapping] = useState(false);
  const [copied, setCopied] = useState(false);
  const codeElement = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
  const code = String(codeElement?.props.children ?? children).replace(/\n$/, "");
  const language = codeElement?.props.className?.match(/language-([^\s]+)/)?.[1];

  async function copySnippet() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return <div className={`code-snippet ${wrapping ? "wrap" : ""}`}>
    <div className="code-snippet-toolbar">
      <span className="code-language">{language || "code"}</span>
      <div className="code-snippet-actions">
        <label><span>{c.useWrapping}</span><button type="button" role="switch" aria-label={c.useWrapping} aria-checked={wrapping} className={`toggle code-wrap-toggle ${wrapping ? "on" : ""}`} onClick={() => setWrapping((value) => !value)}><i /></button></label>
        <button type="button" className="copy-snippet" onClick={() => void copySnippet()} aria-label={c.copy} title={c.copy}>{copied ? <Check size={13} /> : <Copy size={13} />}<span>{copied ? c.copied : c.copy}</span></button>
      </div>
    </div>
    <pre><code className={codeElement?.props.className}>{code}</code></pre>
  </div>;
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
  return <div className="mobile-message-action-layer" role="dialog" aria-modal="true" aria-label={locale === "ko" ? "메시지 작업" : "Message actions"}>
    <button className="mobile-message-action-scrim" aria-label={c.cancel} onClick={onClose} />
    <section className="mobile-message-action-sheet">
      <header><span>{role === "user" ? (locale === "ko" ? "내 메시지" : "Your message") : (locale === "ko" ? "모델 응답" : "Model response")}</span><button onClick={onClose} aria-label={c.cancel}><X size={18} /></button></header>
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

function MultipleChoicePanel({ c, event, onSubmit }: { c: CopySet; event: ToolEvent; onSubmit: (value: unknown) => void }) {
  const args = event.arguments && typeof event.arguments === "object" ? event.arguments as { questions?: MultipleChoiceQuestion[] } : {};
  const questions = args.questions || [];
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const keyFor = (question: MultipleChoiceQuestion, index: number) => question.id || `question-${index + 1}`;
  function choose(question: MultipleChoiceQuestion, index: number, option: string) {
    const key = keyFor(question, index); const current = answers[key] || [];
    if (question.type === "single_select") setAnswers((value) => ({ ...value, [key]: [option] }));
    else setAnswers((value) => ({ ...value, [key]: current.includes(option) ? current.filter((item) => item !== option) : [...current, option] }));
  }
  function submit() {
    const value = { answers: questions.map((question, index) => { const key = keyFor(question, index); return { question: question.question, type: question.type, selections: answers[key] || [], ...(other[key]?.trim() ? { other: other[key].trim() } : {}) }; }) };
    setSubmitted(true); onSubmit(value);
  }
  return <section className="multiple-choice-panel" aria-label={c.multipleChoice}>
    {questions.map((question, index) => { const key = keyFor(question, index); const selected = answers[key] || []; return <fieldset key={key} disabled={submitted}>
      <legend><b>{index + 1}</b><span>{question.question}</span></legend>
      <div className="choice-options">{question.options.map((option) => { const rank = selected.indexOf(option); return <button type="button" key={option} className={rank >= 0 ? "selected" : ""} onClick={() => choose(question, index, option)}><i>{question.type === "rank_priorities" && rank >= 0 ? rank + 1 : rank >= 0 ? <Check size={13} /> : ""}</i><span>{option}</span></button>; })}</div>
      <label className="choice-other"><Pencil size={14} /><input value={other[key] || ""} onChange={(e) => setOther((value) => ({ ...value, [key]: e.target.value }))} placeholder={c.otherChoice} /></label>
    </fieldset>; })}
    <button type="button" className="choice-submit" disabled={submitted} onClick={submit}>{submitted ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{c.submitChoices}</button>
  </section>;
}

function ToolEventIcon({ name, size = 15 }: { name: string; size?: number }) {
  const Icon = name === "internet_search" ? Search : name === "visit_page" ? Link2 : name === "get_current_time" ? Clock3 : name === "get_current_location" ? LocateFixed : name === "ask_multiple_choice" ? ListChecks : Wrench;
  return <Icon size={size} />;
}

function ToolActivity({ c, locale, event, onInput }: { c: CopySet; locale: Locale; event: ToolEvent; onInput: (id: string, value: unknown) => void }) {
  const active = event.status === "calling" || event.status === "waiting";
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
      {event.status === "waiting" && event.name === "ask_multiple_choice" && <MultipleChoicePanel c={c} event={event} onSubmit={(value) => onInput(event.id, value)} />}
      {event.result !== undefined && <details open><summary>{c.toolResult}</summary><StructuredJson value={event.result} /></details>}
    </div>
  </details>;
}

function ToolActivityGroup({ c, locale, events, onInput }: { c: CopySet; locale: Locale; events: ToolEvent[]; onInput: (id: string, value: unknown) => void }) {
  const state = getToolGroupState(events);
  const label = getToolGroupLabel(state, locale);
  return <details className={`tool-activity-group ${state}`} open>
    <summary aria-label={label}>
      <span className="tool-group-icon"><Wrench size={16} /></span>
      <strong>{label}</strong>
      <span className="tool-count">{events.length}</span>
      <ChevronDown size={14} className="tool-group-chevron" />
    </summary>
    <div className="tool-activity-list" aria-label={locale === "ko" ? "도구 호출 목록" : "Tool call list"}>
      {events.map((event) => <ToolActivity key={event.id} c={c} locale={locale} event={event} onInput={onInput} />)}
    </div>
  </details>;
}

function Message({ c, locale, message, pending, revisions, onFork, onEditAssistant, onRegenerate, onRegenerateUser, onDeleteUser, onRevision, onToolInput }: { c: CopySet; locale: Locale; message: StoredMessage; pending: boolean; revisions: MessageRevision[]; onFork: (id: string, text: string) => void; onEditAssistant: (id: string, text: string) => void; onRegenerate: (id: string) => void; onRegenerateUser: (id: string) => void; onDeleteUser: (id: string) => void; onRevision: (branchId: string) => void; onToolInput: (id: string, value: unknown) => void }) {
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.content);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const reasoningRef = useRef<HTMLDivElement>(null);
  const isThinking = pending && Boolean(message.reasoning) && message.reasoningDurationSeconds === undefined;
  const longPress = useLongPress(() => setMobileActionsOpen(true), pending || editing);
  useEffect(() => { if (!editing) setText(message.content); }, [editing, message.content]);
  useEffect(() => { if (isThinking && reasoningRef.current) reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight; }, [isThinking, message.reasoning]);
  const copyMessage = async () => { await navigator.clipboard.writeText(message.content); setMobileActionsOpen(false); };
  const editMessage = () => { setMobileActionsOpen(false); setEditing(true); };
  const regenerateMessage = () => { setMobileActionsOpen(false); message.role === "user" ? onRegenerateUser(message.id) : onRegenerate(message.id); };
  const actions = mobileActionsOpen && typeof document !== "undefined"
    ? createPortal(<MobileMessageActions c={c} locale={locale} role={message.role} canCopy={Boolean(message.content)} onClose={() => setMobileActionsOpen(false)} onRegenerate={regenerateMessage} onEdit={editMessage} onCopy={() => void copyMessage()} onDelete={message.role === "user" ? () => { setMobileActionsOpen(false); onDeleteUser(message.id); } : undefined} />, document.body)
    : null;

  if (message.role === "user") return <div className="message-row user-message"><div className="user-message-actions">{editing ? <div className="message-edit">{message.attachments?.length ? <AttachmentGrid attachments={message.attachments} /> : null}<textarea value={text} onChange={(event) => setText(event.target.value)} autoFocus /><div><button onClick={() => setEditing(false)}>{c.cancel}</button><button onClick={() => { if (text.trim() !== message.content) onFork(message.id, text); setEditing(false); }}><GitBranch size={13} /> {c.forkSend}</button></div></div> : <><div className="user-message-toolbar"><button title={c.regenerateRequest} aria-label={c.regenerateRequest} onClick={() => onRegenerateUser(message.id)}><RefreshCw size={13} /></button>{message.content && <button title={c.copy} aria-label={c.copy} onClick={() => navigator.clipboard.writeText(message.content)}><Copy size={13} /></button>}<button title={c.editBranch} aria-label={c.editBranch} onClick={() => setEditing(true)}><Pencil size={13} /></button><button className="delete" title={c.deleteMessage} aria-label={c.deleteMessage} onClick={() => onDeleteUser(message.id)}><Trash2 size={13} /></button></div><div className="user-message-stack long-press-target" {...longPress}><div className="user-message-content">{message.attachments?.length ? <AttachmentGrid attachments={message.attachments} /> : null}{message.content && <div className="message-bubble">{message.content}</div>}</div><RevisionNavigator c={c} messageId={message.id} revisions={revisions} onRevision={onRevision} /></div></>}</div>{actions}</div>;
  const showThought = isThinking || thoughtOpen;
  return <div className="message-row assistant-message long-press-target" {...longPress}>
    {message.reasoning && <div className={`thinking-block ${isThinking ? "streaming" : ""}`}><button onClick={() => !isThinking && setThoughtOpen((value) => !value)} aria-expanded={showThought}><BrainCircuit size={15} /> {isThinking ? c.thinking : formatThoughtDuration(message.reasoningDurationSeconds || 1, locale)} {!isThinking && <ChevronDown size={14} className={thoughtOpen ? "rotate" : ""} />}</button>{showThought && <div ref={reasoningRef} className={`thinking-preview ${isThinking ? "live" : ""}`}>{message.reasoning}</div>}</div>}
    {message.toolEvents?.length ? <ToolActivityGroup c={c} locale={locale} events={message.toolEvents} onInput={onToolInput} /> : null}
    {editing ? <div className="assistant-edit"><textarea value={text} onChange={(event) => setText(event.target.value)} autoFocus /><div><button onClick={() => { setText(message.content); setEditing(false); }}>{c.cancel}</button><button className="save-response" onClick={() => { if (text.trim()) onEditAssistant(message.id, text); setEditing(false); }}><Check size={13} /> {c.saveEdit}</button></div></div> : <div className="assistant-copy markdown-body">{message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" />, pre: ({ children }) => <CodeSnippet c={c}>{children}</CodeSnippet> }}>{message.content}</ReactMarkdown> : pending ? <span className="typing"><i /><i /><i /></span> : ""}</div>}
    {!pending && !editing && <div className="assistant-footer"><div className="assistant-actions"><button className="message-action-button" title={c.regenerate} aria-label={c.regenerate} onClick={() => onRegenerate(message.id)}><RefreshCw size={14} /></button>{message.content && <button className="message-action-button" title={c.copy} aria-label={c.copy} onClick={() => navigator.clipboard.writeText(message.content)}><Copy size={14} /></button>}<button className="message-action-button" title={c.editResponse} aria-label={c.editResponse} onClick={() => setEditing(true)}><Pencil size={14} /></button></div><RevisionNavigator c={c} messageId={message.id} revisions={revisions} onRevision={onRevision} /><MessageTokenStats c={c} locale={locale} message={message} /></div>}
    {actions}
  </div>;
}

function RevisionNavigator({ c, messageId, revisions, onRevision }: { c: CopySet; messageId: string; revisions: MessageRevision[]; onRevision: (branchId: string) => void }) {
  if (revisions.length < 2) return null;
  const index = Math.max(0, revisions.findIndex((revision) => revision.messageId === messageId));
  return <div className="revision-navigator" aria-label={`${index + 1} / ${revisions.length}`}><button title={c.previousRevision} aria-label={c.previousRevision} disabled={index === 0} onClick={() => onRevision(revisions[index - 1].branchId)}><ChevronLeft size={14} /></button><span>{index + 1} / {revisions.length}</span><button title={c.nextRevision} aria-label={c.nextRevision} disabled={index === revisions.length - 1} onClick={() => onRevision(revisions[index + 1].branchId)}><ChevronRight size={14} /></button></div>;
}

function AttachmentGrid({ attachments }: { attachments: StoredAttachment[] }) {
  return <div className={`message-attachments count-${Math.min(attachments.length, 4)}`}>{attachments.map((attachment) => <a href={attachment.url} target="_blank" rel="noreferrer" key={attachment.id} title={attachment.name}><img src={attachment.thumbnailUrl} alt={attachment.name} loading="lazy" decoding="async" width={attachment.width} height={attachment.height} /></a>)}</div>;
}

function ExportDialog({ c, conversation, initialIncludeReasoning, onClose, onPreference }: { c: CopySet; conversation: Conversation; initialIncludeReasoning: boolean; onClose: () => void; onPreference: (value: boolean) => void }) {
  const [includeReasoning, setIncludeReasoning] = useState(initialIncludeReasoning);
  function download(format: "json" | "markdown") {
    const active = conversation.branches.find((branch) => branch.id === conversation.activeBranchId) || conversation.branches[0];
    let content: string; let type: string; let extension: string;
    if (format === "json") {
      const exported = { ...conversation, branches: conversation.branches.map((branch) => ({ ...branch, messages: branch.messages.map((message) => includeReasoning ? message : (({ reasoning: _, ...rest }) => rest)(message)) })) };
      content = JSON.stringify(exported, null, 2); type = "application/json"; extension = "json";
    } else {
      content = `# ${conversation.title}\n\nBranch: ${active.name}\n\n` + active.messages.map((message) => `${message.role === "user" ? "## User" : "## Assistant"}\n\n${includeReasoning && message.reasoning ? `> Reasoning\n> ${message.reasoning.replaceAll("\n", "\n> ")}\n\n` : ""}${message.content}`).join("\n\n---\n\n");
      type = "text/markdown"; extension = "md";
    }
    const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${conversation.title.replace(/[^a-z0-9가-힣_-]+/gi, "-")}.${extension}`; anchor.click(); URL.revokeObjectURL(url); onPreference(includeReasoning); onClose();
  }
  return <div className="mini-dialog-layer"><button className="settings-backdrop" onClick={onClose} /><section className="export-dialog"><header><div><Download size={18} /><h3>{c.exportConversation}</h3></div><button onClick={onClose}><X size={18} /></button></header><p>{c.exportDescription}</p><label className="export-reasoning"><span><strong>{c.includeReasoning}</strong><small>{c.includeReasoningDesc}</small></span><button role="switch" aria-checked={includeReasoning} className={`toggle ${includeReasoning ? "on" : ""}`} onClick={() => setIncludeReasoning(!includeReasoning)}><i /></button></label><div className="export-actions"><button onClick={() => download("markdown")}><FileText size={17} /> Markdown</button><button onClick={() => download("json")}><FileJson size={17} /> JSON · {c.allBranches}</button></div></section></div>;
}

function SettingsPanel({ initial, onClose, onSaved, onLogout }: { initial: PublicConfig; onClose: () => void; onSaved: (config: PublicConfig) => void; onLogout: () => Promise<void> }) {
  const admin = initial.account?.role === "admin" || initial.account?.role === "superadmin";
  const firstEditableModel = initial.models.find((model) => !model.isAlias || model.ownerId === initial.account?.id) || initial.models[0];
  const [draft, setDraft] = useState<PublicConfig>(structuredClone(initial)); const [tab, setTab] = useState<SettingsTab>(admin ? "general" : "models"); const [activeModelId, setActiveModelId] = useState(firstEditableModel?.id || ""); const [saving, setSaving] = useState(false); const [detecting, setDetecting] = useState(false); const [notice, setNotice] = useState("");
  const activeModel = draft.models.find((model) => model.id === activeModelId);
  const c = copyFor(draft.preferences.language || "en");
  function updateModel(patch: Partial<ModelConfig>) { setDraft((current) => ({ ...current, models: current.models.map((model) => model.id === activeModelId ? { ...model, ...patch } : model) })); }
  async function save() { setSaving(true); setNotice(""); try { const response = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setDraft(body); onSaved(body); setNotice(c.saved); } catch (error) { setNotice(error instanceof Error ? error.message : "Save failed."); } finally { setSaving(false); } }
  async function detect() {
    setDetecting(true); setNotice("");
    try {
      const response = await fetch("/api/models/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft.server) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      const aliases = draft.models.filter((model) => model.isAlias);
      const detected: ModelConfig[] = body.models.map((model: ModelConfig) => {
        const baseIdentifier = model.sourceModel.split(":")[0];
        const previous = draft.models.find((item) => !item.isAlias && item.sourceModel.split(":")[0] === baseIdentifier);
        return previous ? { ...model, name: previous.name, visible: previous.visible, description: previous.description, systemPrompt: previous.systemPrompt, reasoningSupported: previous.reasoningSupported, reasoningEfforts: previous.reasoningEfforts, reasoningPresets: previous.reasoningPresets, contextWindowTokens: previous.contextWindowTokens } : model;
      });
      const refreshedAliases = aliases.map((alias) => {
        const base = detected.find((model) => model.sourceModel === alias.sourceModel || model.id === alias.sourceModel);
        return base ? { ...alias, apiContextWindowTokens: undefined } : alias;
      });
      setDraft((current) => ({ ...current, models: [...detected, ...refreshedAliases] })); setActiveModelId(detected[0]?.id || refreshedAliases[0]?.id || "");
      setNotice(`${body.models.length}${c.detectSaved}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Connection failed."); } finally { setDetecting(false); }
  }
  function addAlias() { const base = draft.models.find((model) => !model.isAlias) || draft.models[0]; if (!base) { setNotice(c.detectFirst); return; } const alias: ModelConfig = { ...structuredClone(base), id: uid("alias"), name: draft.preferences.language === "ko" ? "새 커스텀 모델" : "New custom model", isAlias: true, visible: true, systemPrompt: "", contextWindowTokens: undefined, apiContextWindowTokens: undefined, ownerId: initial.account?.id, isPublic: false }; setDraft((current) => ({ ...current, models: [...current.models, alias] })); setActiveModelId(alias.id); setTab("models"); }
  function addPreset() { if (!activeModel) return; const preset: ReasoningPreset = { id: uid("preset"), name: draft.preferences.language === "ko" ? "새 템플릿" : "New template", kind: "custom", effort: activeModel.reasoningSupported ? activeModel.reasoningEfforts?.[0] || "medium" : "", systemPrompt: "", systemPromptMode: "append", ownerId: initial.account?.id }; updateModel({ reasoningPresets: [...activeModel.reasoningPresets, preset] }); }
  function openReasoning() { const visible = draft.models.filter((model) => model.visible !== false); if (!activeModel?.visible) setActiveModelId(visible[0]?.id || ""); setTab("reasoning"); }
  return <div className="settings-layer" role="dialog" aria-modal="true" aria-label={c.settings}><button className="settings-backdrop" onClick={onClose} aria-label={c.cancel} /><section className="settings-panel"><header><div><span>{c.workspace}</span><h2>{c.settings}</h2></div><button onClick={onClose}><X size={20} /></button></header><div className="settings-body"><nav>{admin && <button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}><Settings2 size={17} /> {c.general}</button>}{admin && <button className={tab === "connection" ? "active" : ""} onClick={() => setTab("connection")}><Server size={17} /> {c.connection}</button>}<button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}><SlidersHorizontal size={17} /> {c.models}</button><button className={tab === "reasoning" ? "active" : ""} onClick={openReasoning}><BrainCircuit size={17} /> Reasoning</button>{admin && <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><Users size={17} /> {c.users}</button>}<button className={tab === "account" ? "active" : ""} onClick={() => setTab("account")}><UserRound size={17} /> {c.account}</button></nav><div className="settings-content">{tab === "general" && admin && <GeneralSettings c={c} draft={draft} setDraft={setDraft} />}{tab === "connection" && admin && <ConnectionSettings c={c} draft={draft} setDraft={setDraft} onDetect={detect} detecting={detecting} />}{tab === "models" && <ModelSettings c={c} draft={draft} setDraft={setDraft} activeModelId={activeModelId} setActiveModelId={setActiveModelId} activeModel={activeModel} updateModel={updateModel} addAlias={addAlias} account={initial.account} />}{tab === "reasoning" && <ReasoningSettings c={c} draft={draft} activeModelId={activeModelId} setActiveModelId={setActiveModelId} activeModel={activeModel} updateModel={updateModel} addPreset={addPreset} account={initial.account} />}{tab === "users" && admin && <UsersSettings c={c} />}{tab === "account" && <AccountSettings c={c} account={initial.account} onLogout={onLogout} />}</div></div><footer><span>{notice}</span><div><button className="secondary-button" onClick={onClose}>{c.cancel}</button>{tab !== "users" && tab !== "account" && <button className="save-button" onClick={save} disabled={saving}>{saving ? c.saving : c.saveChanges}</button>}</div></footer></section></div>;
}

function GeneralSettings({ c, draft, setDraft }: { c: CopySet; draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>> }) {
  function selectLanguage(language: Locale) { setDraft((current) => ({ ...current, preferences: { ...current.preferences, language } })); }
  function toggleOnDemand() { setDraft((current) => ({ ...current, preferences: { ...current.preferences, onDemand: !current.preferences.onDemand } })); }
  function toggleModelIdentifiers() { setDraft((current) => ({ ...current, preferences: { ...current.preferences, showModelIdentifiers: current.preferences.showModelIdentifiers === false } })); }
  return <div className="settings-section"><SectionTitle icon={<Settings2 size={19} />} title={c.generalTitle} description={c.generalDesc} /><div className="general-setting-card"><div><strong>{c.interfaceLanguage}</strong><small>{c.languageHelp}</small></div><div className="language-options" role="radiogroup" aria-label={c.interfaceLanguage}><button role="radio" aria-checked={draft.preferences.language === "en"} className={draft.preferences.language === "en" ? "active" : ""} onClick={() => selectLanguage("en")}><span>EN</span><div><strong>{c.english}</strong><small>English</small></div>{draft.preferences.language === "en" && <Check size={16} />}</button><button role="radio" aria-checked={draft.preferences.language === "ko"} className={draft.preferences.language === "ko" ? "active" : ""} onClick={() => selectLanguage("ko")}><span>한</span><div><strong>{c.korean}</strong><small>한국어</small></div>{draft.preferences.language === "ko" && <Check size={16} />}</button></div></div><div className="general-setting-card general-toggle-card"><div><strong>{c.onDemand}</strong><small>{c.onDemandHelp}</small></div><button role="switch" aria-checked={draft.preferences.onDemand} aria-label={c.onDemand} className={`toggle ${draft.preferences.onDemand ? "on" : ""}`} onClick={toggleOnDemand}><i /></button></div><div className="general-setting-card general-toggle-card"><div><strong>{c.showModelIdentifiers}</strong><small>{c.showModelIdentifiersHelp}</small></div><button role="switch" aria-checked={draft.preferences.showModelIdentifiers !== false} aria-label={c.showModelIdentifiers} className={`toggle ${draft.preferences.showModelIdentifiers !== false ? "on" : ""}`} onClick={toggleModelIdentifiers}><i /></button></div><div className="general-setting-card app-version-card"><div><strong>{c.appVersion}</strong><small>NeuralNetUI</small></div><b>{APP_VERSION}</b></div></div>;
}

function ConnectionSettings({ c, draft, setDraft, onDetect, detecting }: { c: CopySet; draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>>; onDetect: () => void; detecting: boolean }) {
  return <div className="settings-section"><SectionTitle icon={<Server size={19} />} title={c.serverTitle} description={c.serverDesc} /><label className="field"><span>{c.baseUrl}</span><input value={draft.server.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, server: { ...current.server, baseUrl: event.target.value } }))} placeholder="http://localhost:8888/v1" /><small>{c.baseUrlHelp}</small></label><label className="field"><span>{c.apiKey}</span><div className="field-with-icon"><KeyRound size={16} /><input type="password" value={draft.server.apiKey} onChange={(event) => setDraft((current) => ({ ...current, server: { ...current.server, apiKey: event.target.value } }))} placeholder={draft.server.hasApiKey ? c.savedKey : c.requiredKey} /></div><small>{c.apiKeyHelp}</small></label><label className="field compact"><span>{c.displayName}</span><input value={draft.profile.name} onChange={(event) => setDraft((current) => ({ ...current, profile: { name: event.target.value } }))} /></label><div className="connection-test"><div><strong>{c.discover}</strong><small>{c.discoverDesc}</small></div><button onClick={onDetect} disabled={detecting}><RefreshCw size={16} className={detecting ? "spin" : ""} />{detecting ? c.detecting : c.detectModels}</button></div></div>;
}

type ModelEditorProps = { draft: PublicConfig; activeModelId: string; setActiveModelId: (id: string) => void; activeModel?: ModelConfig };
function ModelColumn({ c, models, active, onChange, showIdentifiers, action }: { c: CopySet; models: ModelConfig[]; active: string; onChange: (id: string) => void; showIdentifiers: boolean; action?: React.ReactNode }) { return <aside className="model-column"><div className="model-column-head"><span>{c.models}</span>{action}</div><div className="model-column-list">{models.map((model) => <button key={model.id} className={model.id === active ? "active" : ""} onClick={() => onChange(model.id)}><span className="model-type-icon">{model.isAlias ? <Pencil size={13} /> : <Server size={13} />}</span><span><strong>{model.name}</strong>{showIdentifiers && <small>{model.sourceModel}</small>}</span>{model.visible === false && <i className="hidden-model-dot" />}</button>)}</div></aside>; }

function ModelSettings({ c, draft, setDraft, activeModelId, setActiveModelId, activeModel, updateModel, addAlias, account }: ModelEditorProps & { c: CopySet; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>>; updateModel: (patch: Partial<ModelConfig>) => void; addAlias: () => void; account?: AccountInfo }) {
  function removeModel() { if (!activeModel) return; const next = draft.models.filter((model) => model.id !== activeModel.id); setDraft((current) => ({ ...current, models: next })); setActiveModelId(next[0]?.id || ""); }
  const editableModels = draft.models.filter((model) => model.isAlias && (!account || model.ownerId === account.id));
  const privileged = account?.role === "admin" || account?.role === "superadmin";
  const shownModels = account ? privileged ? draft.models.filter((model) => !model.isAlias || model.ownerId === account.id || !model.ownerId) : editableModels : draft.models;
  const effectiveContext = effectiveContextWindowTokens(activeModel, draft.models);
  const advertisedContext = advertisedContextWindowTokens(activeModel, draft.models);
  const inheritedContext = activeModel?.isAlias && activeModel.contextWindowTokens === undefined ? effectiveContext : undefined;
  function setContextWindow(value: string) {
    const parsed = value.trim() ? Number(value) : undefined;
    updateModel({ contextWindowTokens: parsed && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined });
  }
  return <div className="settings-section wide">
    <SectionTitle icon={<SlidersHorizontal size={19} />} title={c.modelsTitle} description={c.modelsDesc} />
    <div className="split-model-editor">
      <ModelColumn c={c} models={shownModels} active={activeModelId} onChange={setActiveModelId} showIdentifiers={draft.preferences.showModelIdentifiers !== false} action={<button onClick={addAlias} title={c.newAlias}><Plus size={15} /></button>} />
      <div className="model-editor-pane">{activeModel && shownModels.some((model) => model.id === activeModel.id) ? <div className="editor-card">
        {activeModel.isAlias && <div className="model-visibility-row"><div><strong>{c.publicModel}</strong><small>{c.publicModelDesc}</small></div><button role="switch" aria-checked={activeModel.isPublic === true} className={`toggle ${activeModel.isPublic ? "on" : ""}`} onClick={() => updateModel({ isPublic: !activeModel.isPublic })}><i /></button></div>}
        <div className="model-visibility-row"><div><strong>{c.showMain}</strong><small>{c.showMainDesc}</small></div><button role="switch" aria-checked={activeModel.visible !== false} className={`toggle ${activeModel.visible !== false ? "on" : ""}`} onClick={() => updateModel({ visible: activeModel.visible === false })}><i /></button></div>
        <div className="type-badge">{activeModel.isAlias ? c.customAlias : c.servedModel}</div>
        <div className="form-grid"><label className="field"><span>{c.displayName}</span><input value={activeModel.name} onChange={(event) => updateModel({ name: event.target.value })} /></label><label className="field"><span>{c.modelId}</span><input value={activeModel.id} disabled={!activeModel.isAlias} onChange={(event) => { const oldId = activeModel.id; setDraft((current) => ({ ...current, models: current.models.map((model) => model.id === oldId ? { ...model, id: event.target.value } : model) })); setActiveModelId(event.target.value); }} /></label></div>
        <label className="field"><span>{activeModel.isAlias ? c.baseModel : c.servedIdentifier}</span>{activeModel.isAlias ? <select value={activeModel.sourceModel} onChange={(event) => updateModel({ sourceModel: event.target.value })}>{draft.models.filter((model) => !model.isAlias).map((model) => <option key={model.id} value={model.sourceModel}>{model.name}{draft.preferences.showModelIdentifiers !== false ? ` · ${model.sourceModel}` : ""}</option>)}</select> : <input value={activeModel.sourceModel} onChange={(event) => updateModel({ sourceModel: event.target.value })} />}</label>
        <label className="field context-window-field"><span>{c.contextWindow}</span><input type="number" min={1} step={1} inputMode="numeric" value={activeModel.contextWindowTokens ?? ""} onChange={(event) => setContextWindow(event.target.value)} placeholder={effectiveContext ? String(effectiveContext) : "131072"} /><small>{activeModel.isAlias ? c.aliasContextWindowHelp : c.contextWindowHelp}</small>{inheritedContext ? <small>{c.inheritedContextWindow}: {formatTokens(inheritedContext, draft.preferences.language)}</small> : null}{advertisedContext ? <small>{c.apiContextWindow}: {formatTokens(advertisedContext, draft.preferences.language)}</small> : null}{effectiveContext ? <small>{c.effectiveContextWindow}: {formatTokens(effectiveContext, draft.preferences.language)}</small> : null}</label>
        <label className="field"><span>{c.description}</span><input value={activeModel.description || ""} onChange={(event) => updateModel({ description: event.target.value })} /></label>
        <label className="field"><span>{c.systemPrompt}</span><textarea rows={5} value={activeModel.systemPrompt || ""} onChange={(event) => updateModel({ systemPrompt: event.target.value })} placeholder={c.systemPromptPlaceholder} /></label>
        {activeModel.isAlias && <button className="danger-action" onClick={removeModel}><Trash2 size={15} /> {c.deleteAlias}</button>}
      </div> : <EmptyState text={c.noModel} />}</div>
    </div>
  </div>;
}

function ReasoningSettings({ c, draft, activeModelId, setActiveModelId, activeModel, updateModel, addPreset, account }: ModelEditorProps & { c: CopySet; updateModel: (patch: Partial<ModelConfig>) => void; addPreset: () => void; account?: AccountInfo }) {
  function patchPreset(id: string, patch: Partial<ReasoningPreset>) { if (activeModel) updateModel({ reasoningPresets: activeModel.reasoningPresets.map((preset) => preset.id === id ? { ...preset, ...patch } : preset) }); }
  function removePreset(id: string) { if (activeModel) updateModel({ reasoningPresets: activeModel.reasoningPresets.filter((preset) => preset.id !== id) }); }
  const efforts = activeModel?.reasoningEfforts?.length ? activeModel.reasoningEfforts : ["none", "low", "medium", "high", "xhigh"];
  const visibleModels = draft.models.filter((model) => model.visible !== false);
  const privileged = account?.role === "admin" || account?.role === "superadmin";
  const ownsModel = Boolean(activeModel?.isAlias && activeModel.ownerId === account?.id);
  const canEditPreset = (preset: ReasoningPreset) => privileged || ownsModel || preset.kind === "custom" && preset.ownerId === account?.id;
  return <div className="settings-section wide"><SectionTitle icon={<BrainCircuit size={19} />} title={c.reasoningTitle} description={c.reasoningDesc} action={<button className="subtle-action" onClick={addPreset}><Plus size={16} /> {c.addTemplate}</button>} /><div className="split-model-editor"><ModelColumn c={c} models={visibleModels} active={activeModelId} onChange={setActiveModelId} showIdentifiers={draft.preferences.showModelIdentifiers !== false} /><div className="model-editor-pane reasoning-pane">{activeModel ? <><div className="reason-capability"><div><strong>{c.nativeSupport}</strong><small>{activeModel.reasoningEfforts?.length ? `API efforts: ${activeModel.reasoningEfforts.join(", ")}` : c.noEffortMetadata}</small></div><button disabled={!privileged && !ownsModel} className={`toggle ${activeModel.reasoningSupported ? "on" : ""}`} onClick={() => updateModel({ reasoningSupported: !activeModel.reasoningSupported })}><i /></button></div><div className="preset-list">{activeModel.reasoningPresets.map((preset) => <div className="preset-editor" key={preset.id}><div className="preset-editor-head"><span className={`kind-icon ${preset.kind}`}><BrainCircuit size={15} /></span><input disabled={!canEditPreset(preset)} value={preset.name} onChange={(event) => patchPreset(preset.id, { name: event.target.value })} aria-label={c.reasoningPreset} /><select disabled={!canEditPreset(preset)} value={preset.kind} onChange={(event) => patchPreset(preset.id, { kind: event.target.value as ReasoningPreset["kind"] })}><option value="builtin">{c.builtIn}</option><option value="custom">{c.customTemplate}</option></select><button disabled={!canEditPreset(preset)} onClick={() => removePreset(preset.id)}><Trash2 size={15} /></button></div><div className="preset-editor-body">{activeModel.reasoningSupported && <label><span>{c.nativeEffort}</span><select disabled={!canEditPreset(preset)} value={preset.effort || ""} onChange={(event) => patchPreset(preset.id, { effort: event.target.value })}><option value="">{c.doNotSend}</option>{efforts.map((effort) => <option value={effort} key={effort}>{effort === "xhigh" ? "extra high" : effort.replaceAll("_", " ")}</option>)}</select></label>}{preset.kind === "custom" && <><label><span>{c.promptHandling}</span><select disabled={!canEditPreset(preset)} value={preset.systemPromptMode || "append"} onChange={(event) => patchPreset(preset.id, { systemPromptMode: event.target.value as ReasoningPreset["systemPromptMode"] })}><option value="replace">{c.replace}</option><option value="prepend">{c.prepend}</option><option value="append">{c.append}</option></select></label><label><span>{c.additionalPrompt}</span><textarea disabled={!canEditPreset(preset)} rows={3} value={preset.systemPrompt || ""} onChange={(event) => patchPreset(preset.id, { systemPrompt: event.target.value })} placeholder={c.systemPromptPlaceholder} /></label></>}</div></div>)}{!activeModel.reasoningPresets.length && <EmptyState text={c.noPresets} />}</div></> : <EmptyState text={c.noModel} />}</div></div></div>;
}

function UsersSettings({ c }: { c: CopySet }) {
  const [users, setUsers] = useState<UserSummary[]>([]); const [names, setNames] = useState<Record<string, string>>({}); const [roles, setRoles] = useState<Record<string, "user" | "admin">>({}); const [currentUserId, setCurrentUserId] = useState(""); const [username, setUsername] = useState(""); const [displayName, setDisplayName] = useState(""); const [password, setPassword] = useState(""); const [role, setRole] = useState<"user" | "admin">("user"); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [activeUserId, setActiveUserId] = useState("");
  function syncUsers(next: UserSummary[]) { setUsers(next); setNames(Object.fromEntries(next.map((user) => [user.id, user.displayName]))); setRoles(Object.fromEntries(next.filter((user) => user.role !== "superadmin").map((user) => [user.id, user.role as "user" | "admin"]))); }
  useEffect(() => { fetch("/api/users").then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); syncUsers(body.users || []); setCurrentUserId(body.currentUserId || ""); }).catch((error) => setNotice(error instanceof Error ? error.message : "Unable to load users.")); }, []);
  async function add(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    try { const response = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, displayName: displayName || username, password, role }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); syncUsers(body.users || []); setUsername(""); setDisplayName(""); setPassword(""); setNotice(c.saved); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Unable to create user."); }
    finally { setBusy(false); }
  }
  async function saveUser(user: UserSummary) {
    setActiveUserId(user.id); setNotice("");
    try { const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: names[user.id], ...(user.role === "superadmin" ? {} : { role: roles[user.id] }) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); syncUsers(body.users || []); setNotice(c.saved); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Unable to update user."); }
    finally { setActiveUserId(""); }
  }
  async function remove(user: UserSummary) {
    if (!window.confirm(`${c.confirmDeleteUser}\n\n${user.displayName} (@${user.username})`)) return;
    setActiveUserId(user.id); setNotice("");
    try { const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, { method: "DELETE" }); const body = await response.json(); if (!response.ok) throw new Error(body.error); syncUsers(body.users || []); setNotice(c.userDeleted); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Unable to delete user."); }
    finally { setActiveUserId(""); }
  }
  return <div className="settings-section"><SectionTitle icon={<Users size={19} />} title={c.userManagement} description={c.userManagementDesc} /><form className="user-create-card" onSubmit={add}><div className="form-grid"><label className="field"><span>{c.username}</span><input value={username} onChange={(event) => setUsername(event.target.value)} required /></label><label className="field"><span>{c.displayName}</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label></div><div className="form-grid"><label className="field"><span>{c.password}</span><input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label className="field"><span>{c.role}</span><select value={role} onChange={(event) => setRole(event.target.value as "user" | "admin")}><option value="user">{c.standardUser}</option><option value="admin">{c.administrator}</option></select></label></div><button className="subtle-action" disabled={busy}><Plus size={16} />{c.addUser}</button>{notice && <small className="settings-notice">{notice}</small>}</form><div className="user-list">{users.map((user) => <div key={user.id}><span className="avatar-mini">{(names[user.id] || user.displayName).charAt(0).toUpperCase()}</span><span className="managed-user-name"><input disabled={user.id === currentUserId} value={names[user.id] ?? user.displayName} onChange={(event) => setNames((current) => ({ ...current, [user.id]: event.target.value }))} aria-label={`${c.displayName}: ${user.username}`} /><small>@{user.username}</small></span>{user.role === "superadmin" || user.id === currentUserId ? <b>{user.role}</b> : <select className="managed-user-role" value={roles[user.id] || user.role} aria-label={`${c.role}: ${user.username}`} onChange={(event) => setRoles((current) => ({ ...current, [user.id]: event.target.value as "user" | "admin" }))}><option value="user">{c.standardUser}</option><option value="admin">{c.administrator}</option></select>}<span className="managed-user-actions">{user.id !== currentUserId && <button title={c.saveDisplayName} aria-label={c.saveDisplayName} disabled={activeUserId === user.id || !names[user.id]?.trim() || (names[user.id].trim() === user.displayName && (user.role === "superadmin" || roles[user.id] === user.role))} onClick={() => void saveUser(user)}><Check size={15} /></button>}{user.role !== "superadmin" && user.id !== currentUserId && <button className="delete-user" title={c.deleteUser} aria-label={c.deleteUser} disabled={activeUserId === user.id} onClick={() => void remove(user)}><Trash2 size={15} /></button>}</span></div>)}</div></div>;
}

function AccountSettings({ c, account, onLogout }: { c: CopySet; account?: AccountInfo; onLogout: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  async function change(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    try { const response = await fetch("/api/auth/password", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setNotice(c.passwordChanged); window.setTimeout(() => void onLogout(), 800); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Unable to change password."); }
    finally { setBusy(false); }
  }
  return <div className="settings-section"><SectionTitle icon={<UserRound size={19} />} title={account?.displayName || c.account} description={`@${account?.username || ""} · ${account?.role || ""}`} /><form className="account-card" onSubmit={change}><label className="field"><span>{c.currentPassword}</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label className="field"><span>{c.newPassword}</span><input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><button className="save-button" disabled={busy}>{c.changePassword}</button>{notice && <small className="settings-notice">{notice}</small>}</form><button className="sign-out-button" onClick={() => void onLogout()}><LogOut size={16} />{c.signOut}</button></div>;
}

function SectionTitle({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) { return <div className="section-title"><span className="title-icon">{icon}</span><div><h3>{title}</h3><p>{description}</p></div>{action}</div>; }
function EmptyState({ text }: { text: string }) { return <div className="empty-state"><UserRound size={22} /><p>{text}</p></div>; }
