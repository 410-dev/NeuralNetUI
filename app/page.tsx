"use client";

import {
  ArrowUp, BrainCircuit, Check, ChevronDown, ChevronLeft, ChevronRight, CirclePlus, Copy, Download, FileJson,
  FileText, GitBranch, ImagePlus, KeyRound, LoaderCircle, Menu, MessageSquarePlus, Pencil, Plus, RefreshCw,
  Search, Server, Settings2, SlidersHorizontal, Sparkles, Square, Trash2, UserRound, X,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ChatBranch, Conversation, ConversationSummary, ModelConfig, PublicConfig,
  ReasoningPreset, StoredAttachment, StoredMessage, Locale,
} from "@/lib/types";

type SettingsTab = "general" | "connection" | "models" | "reasoning";
type MessageRevision = { messageId: string; branchId: string; updatedAt: string };
const emptyConfig: PublicConfig = {
  server: { baseUrl: "http://localhost:8888/v1", apiKey: "", hasApiKey: false },
  profile: { name: "Luke Song" },
  preferences: { sendReasoningToModel: false, exportReasoning: true, language: "en" },
  models: [],
};
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();
const titleFrom = (text: string) => text.trim().split(/\s+/).slice(0, 7).join(" ").slice(0, 58) || "New chat";

const translations = {
  en: {
    newChat: "New Chat", search: "Search", searchChats: "Search chats…", histories: "Chat histories", exportChat: "Export chat",
    historyEmpty: "Your conversations will appear here.", settingsConnections: "Settings & connections", selectModel: "Select a model",
    availableModels: "Available models", manageModels: "Manage models", welcome: "What would you like to explore?", branch: "Branch", messages: "messages",
    messagePlaceholder: "Message your model…", reasoningPreset: "Reasoning preset", native: "Native", template: "Template", default: "default",
    sendPriorReasoning: "Send prior reasoning", sendPriorReasoningDesc: "Include reasoning_content in the next request",
    disclaimer: "Responses may be inaccurate. Verify important information.", stop: "Stop generating", send: "Send message",
    cancel: "Cancel", forkSend: "Fork & send", editBranch: "Edit and branch", reasoning: "Reasoning", copy: "Copy", regenerate: "Regenerate response", previousRevision: "Previous revision", nextRevision: "Next revision",
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
    language: "Language", general: "General", generalTitle: "General settings", generalDesc: "Choose the language used throughout the interface.", interfaceLanguage: "Interface language", languageHelp: "The selected language is saved for future visits.", english: "English", korean: "Korean", saved: "Saved.", detectSaved: "models and capabilities detected. Save changes to apply.", detectFirst: "Detect a server model first.",
    attachImages: "Attach images", uploadingImages: "Creating thumbnails and uploading…", removeImage: "Remove image", loadEarlier: "Load earlier messages",
    imagesAttached: "images attached", imageChat: "Image chat", imageUploadFailed: "Image upload failed.", maxImages: "You can attach up to 12 images.",
    thinking: "Thinking…", editResponse: "Edit response", saveEdit: "Save", thoughtFor: "Thought for",
  },
  ko: {
    newChat: "새 채팅", search: "검색", searchChats: "채팅 검색…", histories: "채팅 기록", exportChat: "채팅 내보내기",
    historyEmpty: "대화를 시작하면 여기에 표시됩니다.", settingsConnections: "설정 및 연결", selectModel: "모델 선택",
    availableModels: "사용 가능한 모델", manageModels: "모델 관리", welcome: "무엇을 함께 살펴볼까요?", branch: "브랜치", messages: "개 메시지",
    messagePlaceholder: "모델에게 메시지 보내기…", reasoningPreset: "Reasoning 프리셋", native: "내장", template: "템플릿", default: "기본값",
    sendPriorReasoning: "이전 Reasoning 전송", sendPriorReasoningDesc: "다음 요청에 reasoning_content를 포함합니다",
    disclaimer: "응답이 부정확할 수 있습니다. 중요한 정보는 확인해 주세요.", stop: "생성 중단", send: "메시지 전송",
    cancel: "취소", forkSend: "분기 후 전송", editBranch: "편집 후 분기", reasoning: "Reasoning", copy: "복사", regenerate: "응답 재생성", previousRevision: "이전 수정본", nextRevision: "다음 수정본",
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
    language: "언어", general: "일반", generalTitle: "일반 설정", generalDesc: "인터페이스 전체에서 사용할 언어를 선택합니다.", interfaceLanguage: "인터페이스 언어", languageHelp: "선택한 언어는 저장되어 다음 접속에도 유지됩니다.", english: "영어", korean: "한국어", saved: "저장했습니다.", detectSaved: "개 모델과 기능을 감지했습니다. 저장을 눌러 적용하세요.", detectFirst: "먼저 서버 모델을 감지해 주세요.",
    attachImages: "이미지 첨부", uploadingImages: "썸네일 생성 및 업로드 중…", removeImage: "이미지 제거", loadEarlier: "이전 메시지 불러오기",
    imagesAttached: "개 이미지 첨부", imageChat: "이미지 대화", imageUploadFailed: "이미지 업로드에 실패했습니다.", maxImages: "이미지는 최대 12장까지 첨부할 수 있습니다.",
    thinking: "생각 중…", editResponse: "응답 편집", saveEdit: "저장", thoughtFor: "동안 생각함",
  },
} as const;
type CopySet = typeof translations.en | typeof translations.ko;
const copyFor = (locale: Locale): CopySet => translations[locale];

function formatThoughtDuration(totalSeconds: number, locale: Locale) {
  const total = Math.max(1, Math.round(totalSeconds)); const minutes = Math.floor(total / 60); const seconds = total % 60;
  if (locale === "ko") return `${minutes ? `${minutes}분 ` : ""}${seconds}초 동안 생각함`;
  return `Thought for ${minutes ? `${minutes} min ` : ""}${seconds} sec`;
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
  const [renderedMessageCount, setRenderedMessageCount] = useState(60);
  const abortRef = useRef<AbortController | null>(null);
  const abandonRef = useRef(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([fetch("/api/config").then((r) => r.json()), fetch("/api/conversations").then((r) => r.json())])
      .then(([next, stored]: [PublicConfig, { conversations: ConversationSummary[] }]) => {
        setConfig(next); setSendReasoning(next.preferences.sendReasoningToModel);
        setHistories(stored.conversations || []);
        const first = next.models.find((model) => model.visible !== false);
        if (first) { setSelectedModelId(first.id); setSelectedPresetId(first.reasoningPresets[0]?.id || ""); }
      }).catch(() => setError("설정 또는 대화 기록을 불러오지 못했습니다."));
  }, []);

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);
  const locale = config.preferences.language || "en";
  const c = copyFor(locale);
  const visibleModels = config.models.filter((model) => model.visible !== false);
  const selectedModel = visibleModels.find((model) => model.id === selectedModelId) || visibleModels[0];
  const selectedPreset = selectedModel?.reasoningPresets.find((preset) => preset.id === selectedPresetId) || selectedModel?.reasoningPresets[0];
  const activeBranch = conversation?.branches.find((branch) => branch.id === conversation.activeBranchId);
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
    setSelectedModelId(model.id); setSelectedPresetId(model.reasoningPresets[0]?.id || ""); setModelMenuOpen(false);
  }

  function newChat() {
    abandonRef.current = true; abortRef.current?.abort();
    draftAttachments.forEach((attachment) => fetch(`/api/uploads/${attachment.id}`, { method: "DELETE" }).catch(() => undefined));
    setDraftAttachments([]); setRenderedMessageCount(60); setIsGenerating(false); setConversation(null); setMessages([]); setDraft(""); setError(""); setMobileOpen(false);
  }

  async function loadConversation(id: string) {
    try {
      const response = await fetch(`/api/conversations/${id}`); const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const next = normalizeConversationRevisions(body as Conversation);
      const branch = next.branches.find((item: ChatBranch) => item.id === next.activeBranchId) || next.branches[0];
      setConversation(next); setMessages(branch?.messages || []); setSelectedModelId(next.modelId);
      setRenderedMessageCount(60);
      setSelectedPresetId(next.reasoningPresetId || ""); setMobileOpen(false); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "대화를 불러오지 못했습니다."); }
  }

  async function switchBranch(branchId: string) {
    if (!conversation) return;
    const branch = conversation.branches.find((item) => item.id === branchId); if (!branch) return;
    const next = { ...conversation, activeBranchId: branchId, updatedAt: now() };
    setMessages(branch.messages); setRenderedMessageCount(60); await persist(next);
  }

  function createConversation(firstMessage: StoredMessage): Conversation {
    const stamp = now(); const branchId = uid("branch");
    return {
      id: uid("chat"), title: firstMessage.content.trim() ? titleFrom(firstMessage.content) : c.imageChat, modelId: selectedModel?.id || "model",
      reasoningPresetId: selectedPreset?.id, activeBranchId: branchId, createdAt: stamp, updatedAt: stamp,
      branches: [{ id: branchId, name: "Main", messages: [firstMessage], createdAt: stamp, updatedAt: stamp }],
    };
  }

  async function runCompletion(working: Conversation, branchId: string, requestMessages: StoredMessage[], create = false, revisionGroupId?: string) {
    abandonRef.current = false;
    const placeholder: StoredMessage = { id: uid("assistant"), revisionGroupId, role: "assistant", content: "", reasoning: "", createdAt: now() };
    setMessages([...requestMessages, placeholder]); setIsGenerating(true); setError("");
    await persist(working, create);
    const controller = new AbortController(); abortRef.current = controller;
    let answer = ""; let reasoning = ""; let reasoningStartedAt: number | null = null; let reasoningDurationSeconds: number | undefined;
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ modelId: working.modelId, reasoningPresetId: working.reasoningPresetId, sendReasoning,
          messages: requestMessages.map((message) => ({ role: message.role, content: message.content, reasoning_content: message.reasoning, attachments: message.attachments?.map(({ id }) => ({ id })) })) }),
      });
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error || `요청에 실패했습니다 (${response.status})`); }
      if (!response.body) throw new Error("응답 스트림이 없습니다.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue; const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta || {};
            const contentDelta = delta.content || ""; const reasoningDelta = delta.reasoning_content || delta.reasoning || "";
            if (reasoningDelta && reasoningStartedAt === null) reasoningStartedAt = Date.now();
            if (contentDelta && reasoningStartedAt !== null && reasoningDurationSeconds === undefined) {
              reasoningDurationSeconds = Math.max(1, (Date.now() - reasoningStartedAt) / 1000);
            }
            answer += contentDelta; reasoning += reasoningDelta;
            setMessages([...requestMessages, { ...placeholder, content: answer, reasoning, reasoningDurationSeconds }]);
          } catch { /* compatible servers may emit non-JSON keep-alives */ }
        }
      }
      if (reasoning && reasoningDurationSeconds === undefined) reasoningDurationSeconds = Math.max(1, reasoningStartedAt ? (Date.now() - reasoningStartedAt) / 1000 : 1);
      const complete: StoredMessage = { ...placeholder, content: answer, reasoning, reasoningDurationSeconds };
      const completedAt = now();
      const completed: Conversation = { ...working, updatedAt: completedAt, branches: working.branches.map((branch) => branch.id === branchId ? { ...branch, messages: [...requestMessages, complete], updatedAt: completedAt } : branch) };
      setMessages([...requestMessages, complete]); await persist(completed);
    } catch (caught) {
      if ((caught as Error).name === "AbortError" && abandonRef.current) return;
      if ((caught as Error).name !== "AbortError") setError(caught instanceof Error ? caught.message : "채팅 요청에 실패했습니다.");
      if (reasoning && reasoningDurationSeconds === undefined) reasoningDurationSeconds = Math.max(1, reasoningStartedAt ? (Date.now() - reasoningStartedAt) / 1000 : 1);
      const partial: StoredMessage[] = answer || reasoning ? [...requestMessages, { ...placeholder, content: answer, reasoning, reasoningDurationSeconds }] : requestMessages;
      const stoppedAt = now();
      const stopped: Conversation = { ...working, updatedAt: stoppedAt, branches: working.branches.map((branch) => branch.id === branchId ? { ...branch, messages: partial, updatedAt: stoppedAt } : branch) };
      setMessages(partial); await persist(stopped);
    } finally { setIsGenerating(false); abortRef.current = null; }
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    if (isGenerating) { abortRef.current?.abort(); return; }
    const text = draft.trim(); if ((!text && !draftAttachments.length) || !selectedModel || uploadingImages) return;
    const attachments = draftAttachments;
    const userMessage: StoredMessage = { id: uid("user"), role: "user", content: text, attachments, createdAt: now() }; setDraft(""); setDraftAttachments([]);
    if (!conversation) {
      const next = createConversation(userMessage); await runCompletion(next, next.activeBranchId, [userMessage], true); return;
    }
    const branch = activeBranch || conversation.branches[0]; if (!branch) return;
    const requestMessages = [...branch.messages, userMessage]; const stamp = now();
    const next: Conversation = { ...conversation, modelId: selectedModel.id, reasoningPresetId: selectedPreset?.id, updatedAt: stamp,
      branches: conversation.branches.map((item) => item.id === branch.id ? { ...item, messages: requestMessages, updatedAt: stamp } : item) };
    await runCompletion(next, branch.id, requestMessages);
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
    setMessages(path); await runCompletion(next, newBranchId, path);
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
    setMessages(path); await runCompletion(next, newBranchId, path, false, revisionGroupId);
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
          <div className="new-chat-halo"><button className="pill-button primary-nav" onClick={newChat}><MessageSquarePlus size={19} /> {c.newChat}</button></div>
          <button className="pill-button" onClick={() => setSearching((value) => !value)}><Search size={18} /> {c.search}</button>
          {searching && <input className="history-search" autoFocus value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={c.searchChats} />}
          <div className="history-heading"><p className="section-label">{c.histories}</p>{conversation && <button onClick={() => setExportOpen(true)} title={c.exportChat}><Download size={15} /></button>}</div>
          <div className="history-list">
            {visibleHistory.map((item) => <button className={`history-item ${item.id === conversation?.id ? "active" : ""}`} key={item.id} onClick={() => loadConversation(item.id)}><span>{item.title}</span>{item.branchCount > 1 && <b><GitBranch size={11} />{item.branchCount}</b>}</button>)}
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
          {modelMenuOpen && <div className="popover model-popover"><div className="popover-heading"><span>{c.availableModels}</span><small>{visibleModels.length}</small></div>{visibleModels.map((model) => <button className="model-option" key={model.id} onClick={() => chooseModel(model)}><span className="selection-dot">{model.id === selectedModel?.id && <Check size={13} />}</span><span><strong>{model.name}</strong><small>{model.sourceModel}</small><em>{model.description}</em></span>{model.isAlias && <b>ALIAS</b>}</button>)}<button className="manage-link" onClick={() => { setModelMenuOpen(false); setSettingsOpen(true); }}><Settings2 size={15} /> {c.manageModels}</button></div>}
        </div>

        <div className="conversation-stage">
          {!messages.length ? <div className="idle-center"><div className="welcome"><div className="welcome-mark"><Sparkles size={19} /></div><h1>{greeting}</h1><p>{c.welcome}</p></div><Composer c={c} draft={draft} setDraft={setDraft} sendMessage={sendMessage} keyDown={handleComposerKeyDown} isGenerating={isGenerating} selectedModel={selectedModel} selectedPreset={selectedPreset} presetOpen={presetMenuOpen} setPresetOpen={setPresetMenuOpen} setPreset={setSelectedPresetId} sendReasoning={sendReasoning} toggleSendReasoning={toggleSendReasoning} error={error} clearError={() => setError("")} attachments={draftAttachments} uploadingImages={uploadingImages} onFiles={uploadImages} onRemoveAttachment={removeDraftAttachment} /></div> : <>
            <div className="thread" ref={threadRef} aria-live="polite">
              {conversation && conversation.branches.length > 1 && <div className="branch-bar"><GitBranch size={14} /><span>{c.branch}</span><select value={conversation.activeBranchId} onChange={(event) => switchBranch(event.target.value)}>{conversation.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name} · {branch.messages.length} {c.messages}</option>)}</select></div>}
              {hiddenMessageCount > 0 && <button className="load-earlier" onClick={loadEarlierMessages}>{c.loadEarlier} · {hiddenMessageCount}</button>}
              {renderedMessages.map((message) => <Message c={c} locale={locale} key={message.id} message={message} pending={isGenerating && message.id === messages[messages.length - 1]?.id} revisions={messageRevisions.get(message.revisionGroupId || message.id) || []} onFork={forkFromMessage} onEditAssistant={editAssistantMessage} onRegenerate={regenerateAssistantMessage} onRevision={(branchId) => void switchBranch(branchId)} />)}
            </div>
            <Composer c={c} draft={draft} setDraft={setDraft} sendMessage={sendMessage} keyDown={handleComposerKeyDown} isGenerating={isGenerating} selectedModel={selectedModel} selectedPreset={selectedPreset} presetOpen={presetMenuOpen} setPresetOpen={setPresetMenuOpen} setPreset={setSelectedPresetId} sendReasoning={sendReasoning} toggleSendReasoning={toggleSendReasoning} error={error} clearError={() => setError("")} attachments={draftAttachments} uploadingImages={uploadingImages} onFiles={uploadImages} onRemoveAttachment={removeDraftAttachment} />
          </>}
        </div>
      </section>

      {settingsOpen && <SettingsPanel initial={config} onClose={() => setSettingsOpen(false)} onSaved={(next) => { setConfig(next); setSendReasoning(next.preferences.sendReasoningToModel); const model = next.models.find((item) => item.visible !== false && item.id === selectedModelId) || next.models.find((item) => item.visible !== false); setSelectedModelId(model?.id || ""); setSelectedPresetId(model?.reasoningPresets[0]?.id || ""); }} />}
      {exportOpen && conversation && <ExportDialog c={c} conversation={conversation} initialIncludeReasoning={config.preferences.exportReasoning} onClose={() => setExportOpen(false)} onPreference={(value) => { const next = { ...config, preferences: { ...config.preferences, exportReasoning: value } }; setConfig(next); fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }); }} />}
    </main>
  );
}

function Composer(props: { c: CopySet; draft: string; setDraft: (value: string) => void; sendMessage: (event?: FormEvent) => Promise<void>; keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; isGenerating: boolean; selectedModel?: ModelConfig; selectedPreset?: ReasoningPreset; presetOpen: boolean; setPresetOpen: (value: boolean) => void; setPreset: (id: string) => void; sendReasoning: boolean; toggleSendReasoning: (value: boolean) => void; error: string; clearError: () => void; attachments: StoredAttachment[]; uploadingImages: boolean; onFiles: (files: File[]) => void; onRemoveAttachment: (attachment: StoredAttachment) => void }) {
  const { c, draft, setDraft, sendMessage, keyDown, isGenerating, selectedModel, selectedPreset, presetOpen, setPresetOpen, setPreset, sendReasoning, toggleSendReasoning, error, clearError, attachments, uploadingImages, onFiles, onRemoveAttachment } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  return <div className="composer-wrap">{error && <div className="error-toast"><span>{error}</span><button onClick={clearError}><X size={15} /></button></div>}<form className="composer" onSubmit={sendMessage}><input ref={fileRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => { onFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />{attachments.length > 0 && <div className="draft-attachments">{attachments.map((attachment) => <div className="draft-image" key={attachment.id}><img src={attachment.thumbnailUrl} alt={attachment.name} loading="lazy" decoding="async" /><button type="button" title={c.removeImage} onClick={() => onRemoveAttachment(attachment)}><X size={13} /></button></div>)}</div>}{uploadingImages && <div className="uploading-images"><LoaderCircle size={14} />{c.uploadingImages}</div>}<textarea aria-label={c.messagePlaceholder} rows={draft ? 2 : 1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={keyDown} placeholder={c.messagePlaceholder} /><div className="composer-actions"><button type="button" className="icon-button" title={c.attachImages} onClick={() => fileRef.current?.click()} disabled={uploadingImages || attachments.length >= 12}><ImagePlus size={19} /></button>{attachments.length > 0 && <small className="attachment-count">{attachments.length} {c.imagesAttached}</small>}<span className="composer-spacer" /><div className="preset-switcher"><button type="button" className="preset-trigger" disabled={!selectedModel?.reasoningPresets.length} onClick={() => setPresetOpen(!presetOpen)}><BrainCircuit size={16} /><span>{selectedPreset?.name || c.default}</span><ChevronDown size={14} /></button>{presetOpen && <div className="popover preset-popover"><p>{c.reasoningPreset}</p>{selectedModel?.reasoningPresets.map((preset) => <button type="button" key={preset.id} onClick={() => { setPreset(preset.id); setPresetOpen(false); }}><span className="selection-dot">{preset.id === selectedPreset?.id && <Check size={12} />}</span><span>{preset.name}<small>{preset.kind === "builtin" ? `${c.native} · ${preset.effort || c.default}` : `${c.template}${preset.effort ? ` · ${preset.effort}` : ""}`}</small></span></button>)}<div className="reasoning-send-toggle"><span><strong>{c.sendPriorReasoning}</strong><small>{c.sendPriorReasoningDesc}</small></span><button type="button" role="switch" aria-checked={sendReasoning} className={`toggle ${sendReasoning ? "on" : ""}`} onClick={() => toggleSendReasoning(!sendReasoning)}><i /></button></div></div>}</div><button className={`send-button ${isGenerating ? "stopping" : ""}`} type="submit" disabled={uploadingImages} aria-label={isGenerating ? c.stop : c.send}>{isGenerating ? <Square size={14} fill="currentColor" /> : <ArrowUp size={20} />}</button></div></form><p className="composer-note">{c.disclaimer}</p></div>;
}

function Message({ c, locale, message, pending, revisions, onFork, onEditAssistant, onRegenerate, onRevision }: { c: CopySet; locale: Locale; message: StoredMessage; pending: boolean; revisions: MessageRevision[]; onFork: (id: string, text: string) => void; onEditAssistant: (id: string, text: string) => void; onRegenerate: (id: string) => void; onRevision: (branchId: string) => void }) {
  const [thoughtOpen, setThoughtOpen] = useState(false); const [editing, setEditing] = useState(false); const [text, setText] = useState(message.content);
  const reasoningRef = useRef<HTMLDivElement>(null);
  const isThinking = pending && Boolean(message.reasoning) && message.reasoningDurationSeconds === undefined;
  useEffect(() => { if (!editing) setText(message.content); }, [editing, message.content]);
  useEffect(() => { if (isThinking && reasoningRef.current) reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight; }, [isThinking, message.reasoning]);
  if (message.role === "user") return <div className="message-row user-message"><div className="user-message-actions">{editing ? <div className="message-edit">{message.attachments?.length ? <AttachmentGrid attachments={message.attachments} /> : null}<textarea value={text} onChange={(event) => setText(event.target.value)} autoFocus /><div><button onClick={() => setEditing(false)}>{c.cancel}</button><button onClick={() => { if (text.trim() !== message.content) onFork(message.id, text); setEditing(false); }}><GitBranch size={13} /> {c.forkSend}</button></div></div> : <><button className="edit-message" title={c.editBranch} aria-label={c.editBranch} onClick={() => setEditing(true)}><Pencil size={13} /></button><div className="user-message-stack"><div className="user-message-content">{message.attachments?.length ? <AttachmentGrid attachments={message.attachments} /> : null}{message.content && <div className="message-bubble">{message.content}</div>}</div><RevisionNavigator c={c} messageId={message.id} revisions={revisions} onRevision={onRevision} /></div></>}</div></div>;
  const showThought = isThinking || thoughtOpen;
  return <div className="message-row assistant-message">
    {message.reasoning && <div className={`thinking-block ${isThinking ? "streaming" : ""}`}><button onClick={() => !isThinking && setThoughtOpen((value) => !value)} aria-expanded={showThought}><BrainCircuit size={15} /> {isThinking ? c.thinking : formatThoughtDuration(message.reasoningDurationSeconds || 1, locale)} {!isThinking && <ChevronDown size={14} className={thoughtOpen ? "rotate" : ""} />}</button>{showThought && <div ref={reasoningRef} className={`thinking-preview ${isThinking ? "live" : ""}`}>{message.reasoning}</div>}</div>}
    {editing ? <div className="assistant-edit"><textarea value={text} onChange={(event) => setText(event.target.value)} autoFocus /><div><button onClick={() => { setText(message.content); setEditing(false); }}>{c.cancel}</button><button className="save-response" onClick={() => { if (text.trim()) onEditAssistant(message.id, text); setEditing(false); }}><Check size={13} /> {c.saveEdit}</button></div></div> : <div className="assistant-copy markdown-body">{message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}>{message.content}</ReactMarkdown> : pending ? <span className="typing"><i /><i /><i /></span> : ""}</div>}
    {!pending && !editing && <div className="assistant-footer"><div className="assistant-actions"><button className="message-action-button" title={c.regenerate} aria-label={c.regenerate} onClick={() => onRegenerate(message.id)}><RefreshCw size={14} /></button>{message.content && <button className="message-action-button" title={c.copy} aria-label={c.copy} onClick={() => navigator.clipboard.writeText(message.content)}><Copy size={14} /></button>}<button className="message-action-button" title={c.editResponse} aria-label={c.editResponse} onClick={() => setEditing(true)}><Pencil size={14} /></button></div><RevisionNavigator c={c} messageId={message.id} revisions={revisions} onRevision={onRevision} /></div>}
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

function SettingsPanel({ initial, onClose, onSaved }: { initial: PublicConfig; onClose: () => void; onSaved: (config: PublicConfig) => void }) {
  const [draft, setDraft] = useState<PublicConfig>(structuredClone(initial)); const [tab, setTab] = useState<SettingsTab>("general"); const [activeModelId, setActiveModelId] = useState(initial.models[0]?.id || ""); const [saving, setSaving] = useState(false); const [detecting, setDetecting] = useState(false); const [notice, setNotice] = useState("");
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
        return previous ? { ...model, name: previous.name, visible: previous.visible, description: previous.description, systemPrompt: previous.systemPrompt, reasoningSupported: previous.reasoningSupported, reasoningEfforts: previous.reasoningEfforts, reasoningPresets: previous.reasoningPresets } : model;
      });
      setDraft((current) => ({ ...current, models: [...detected, ...aliases] })); setActiveModelId(detected[0]?.id || aliases[0]?.id || "");
      setNotice(`${body.models.length}${c.detectSaved}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Connection failed."); } finally { setDetecting(false); }
  }
  function addAlias() { const base = draft.models.find((model) => !model.isAlias) || draft.models[0]; if (!base) { setNotice(c.detectFirst); return; } const alias: ModelConfig = { ...structuredClone(base), id: uid("alias"), name: draft.preferences.language === "ko" ? "새 커스텀 모델" : "New custom model", isAlias: true, visible: true, systemPrompt: "" }; setDraft((current) => ({ ...current, models: [...current.models, alias] })); setActiveModelId(alias.id); setTab("models"); }
  function addPreset() { if (!activeModel) return; const preset: ReasoningPreset = { id: uid("preset"), name: draft.preferences.language === "ko" ? "새 템플릿" : "New template", kind: "custom", effort: activeModel.reasoningSupported ? activeModel.reasoningEfforts?.[0] || "medium" : "", systemPrompt: "", systemPromptMode: "append" }; updateModel({ reasoningPresets: [...activeModel.reasoningPresets, preset] }); }
  function openReasoning() { const visible = draft.models.filter((model) => model.visible !== false); if (!activeModel?.visible) setActiveModelId(visible[0]?.id || ""); setTab("reasoning"); }
  return <div className="settings-layer" role="dialog" aria-modal="true" aria-label={c.settings}><button className="settings-backdrop" onClick={onClose} aria-label={c.cancel} /><section className="settings-panel"><header><div><span>{c.workspace}</span><h2>{c.settings}</h2></div><button onClick={onClose}><X size={20} /></button></header><div className="settings-body"><nav><button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}><Settings2 size={17} /> {c.general}</button><button className={tab === "connection" ? "active" : ""} onClick={() => setTab("connection")}><Server size={17} /> {c.connection}</button><button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}><SlidersHorizontal size={17} /> {c.models}</button><button className={tab === "reasoning" ? "active" : ""} onClick={openReasoning}><BrainCircuit size={17} /> Reasoning</button></nav><div className="settings-content">{tab === "general" && <GeneralSettings c={c} draft={draft} setDraft={setDraft} />}{tab === "connection" && <ConnectionSettings c={c} draft={draft} setDraft={setDraft} onDetect={detect} detecting={detecting} />}{tab === "models" && <ModelSettings c={c} draft={draft} setDraft={setDraft} activeModelId={activeModelId} setActiveModelId={setActiveModelId} activeModel={activeModel} updateModel={updateModel} addAlias={addAlias} />}{tab === "reasoning" && <ReasoningSettings c={c} draft={draft} activeModelId={activeModelId} setActiveModelId={setActiveModelId} activeModel={activeModel} updateModel={updateModel} addPreset={addPreset} />}</div></div><footer><span>{notice}</span><div><button className="secondary-button" onClick={onClose}>{c.cancel}</button><button className="save-button" onClick={save} disabled={saving}>{saving ? c.saving : c.saveChanges}</button></div></footer></section></div>;
}

function GeneralSettings({ c, draft, setDraft }: { c: CopySet; draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>> }) {
  function selectLanguage(language: Locale) { setDraft((current) => ({ ...current, preferences: { ...current.preferences, language } })); }
  return <div className="settings-section"><SectionTitle icon={<Settings2 size={19} />} title={c.generalTitle} description={c.generalDesc} /><div className="general-setting-card"><div><strong>{c.interfaceLanguage}</strong><small>{c.languageHelp}</small></div><div className="language-options" role="radiogroup" aria-label={c.interfaceLanguage}><button role="radio" aria-checked={draft.preferences.language === "en"} className={draft.preferences.language === "en" ? "active" : ""} onClick={() => selectLanguage("en")}><span>EN</span><div><strong>{c.english}</strong><small>English</small></div>{draft.preferences.language === "en" && <Check size={16} />}</button><button role="radio" aria-checked={draft.preferences.language === "ko"} className={draft.preferences.language === "ko" ? "active" : ""} onClick={() => selectLanguage("ko")}><span>한</span><div><strong>{c.korean}</strong><small>한국어</small></div>{draft.preferences.language === "ko" && <Check size={16} />}</button></div></div></div>;
}

function ConnectionSettings({ c, draft, setDraft, onDetect, detecting }: { c: CopySet; draft: PublicConfig; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>>; onDetect: () => void; detecting: boolean }) {
  return <div className="settings-section"><SectionTitle icon={<Server size={19} />} title={c.serverTitle} description={c.serverDesc} /><label className="field"><span>{c.baseUrl}</span><input value={draft.server.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, server: { ...current.server, baseUrl: event.target.value } }))} placeholder="http://localhost:8888/v1" /><small>{c.baseUrlHelp}</small></label><label className="field"><span>{c.apiKey}</span><div className="field-with-icon"><KeyRound size={16} /><input type="password" value={draft.server.apiKey} onChange={(event) => setDraft((current) => ({ ...current, server: { ...current.server, apiKey: event.target.value } }))} placeholder={draft.server.hasApiKey ? c.savedKey : c.requiredKey} /></div><small>{c.apiKeyHelp}</small></label><label className="field compact"><span>{c.displayName}</span><input value={draft.profile.name} onChange={(event) => setDraft((current) => ({ ...current, profile: { name: event.target.value } }))} /></label><div className="connection-test"><div><strong>{c.discover}</strong><small>{c.discoverDesc}</small></div><button onClick={onDetect} disabled={detecting}><RefreshCw size={16} className={detecting ? "spin" : ""} />{detecting ? c.detecting : c.detectModels}</button></div></div>;
}

type ModelEditorProps = { draft: PublicConfig; activeModelId: string; setActiveModelId: (id: string) => void; activeModel?: ModelConfig };
function ModelColumn({ c, models, active, onChange, action }: { c: CopySet; models: ModelConfig[]; active: string; onChange: (id: string) => void; action?: React.ReactNode }) { return <aside className="model-column"><div className="model-column-head"><span>{c.models}</span>{action}</div><div className="model-column-list">{models.map((model) => <button key={model.id} className={model.id === active ? "active" : ""} onClick={() => onChange(model.id)}><span className="model-type-icon">{model.isAlias ? <Pencil size={13} /> : <Server size={13} />}</span><span><strong>{model.name}</strong><small>{model.sourceModel}</small></span>{model.visible === false && <i className="hidden-model-dot" />}</button>)}</div></aside>; }

function ModelSettings({ c, draft, setDraft, activeModelId, setActiveModelId, activeModel, updateModel, addAlias }: ModelEditorProps & { c: CopySet; setDraft: React.Dispatch<React.SetStateAction<PublicConfig>>; updateModel: (patch: Partial<ModelConfig>) => void; addAlias: () => void }) {
  function removeModel() { if (!activeModel) return; const next = draft.models.filter((model) => model.id !== activeModel.id); setDraft((current) => ({ ...current, models: next })); setActiveModelId(next[0]?.id || ""); }
  return <div className="settings-section wide"><SectionTitle icon={<SlidersHorizontal size={19} />} title={c.modelsTitle} description={c.modelsDesc} /><div className="split-model-editor"><ModelColumn c={c} models={draft.models} active={activeModelId} onChange={setActiveModelId} action={<button onClick={addAlias} title={c.newAlias}><Plus size={15} /></button>} /><div className="model-editor-pane">{activeModel ? <div className="editor-card"><div className="model-visibility-row"><div><strong>{c.showMain}</strong><small>{c.showMainDesc}</small></div><button role="switch" aria-checked={activeModel.visible !== false} className={`toggle ${activeModel.visible !== false ? "on" : ""}`} onClick={() => updateModel({ visible: activeModel.visible === false })}><i /></button></div><div className="type-badge">{activeModel.isAlias ? c.customAlias : c.servedModel}</div><div className="form-grid"><label className="field"><span>{c.displayName}</span><input value={activeModel.name} onChange={(event) => updateModel({ name: event.target.value })} /></label><label className="field"><span>{c.modelId}</span><input value={activeModel.id} disabled={!activeModel.isAlias} onChange={(event) => { const oldId = activeModel.id; setDraft((current) => ({ ...current, models: current.models.map((model) => model.id === oldId ? { ...model, id: event.target.value } : model) })); setActiveModelId(event.target.value); }} /></label></div><label className="field"><span>{activeModel.isAlias ? c.baseModel : c.servedIdentifier}</span>{activeModel.isAlias ? <select value={activeModel.sourceModel} onChange={(event) => updateModel({ sourceModel: event.target.value })}>{draft.models.filter((model) => !model.isAlias).map((model) => <option key={model.id} value={model.sourceModel}>{model.name} · {model.sourceModel}</option>)}</select> : <input value={activeModel.sourceModel} onChange={(event) => updateModel({ sourceModel: event.target.value })} />}</label><label className="field"><span>{c.description}</span><input value={activeModel.description || ""} onChange={(event) => updateModel({ description: event.target.value })} /></label><label className="field"><span>{c.systemPrompt}</span><textarea rows={5} value={activeModel.systemPrompt || ""} onChange={(event) => updateModel({ systemPrompt: event.target.value })} placeholder={c.systemPromptPlaceholder} /></label>{activeModel.isAlias && <button className="danger-action" onClick={removeModel}><Trash2 size={15} /> {c.deleteAlias}</button>}</div> : <EmptyState text={c.noModel} />}</div></div></div>;
}

function ReasoningSettings({ c, draft, activeModelId, setActiveModelId, activeModel, updateModel, addPreset }: ModelEditorProps & { c: CopySet; updateModel: (patch: Partial<ModelConfig>) => void; addPreset: () => void }) {
  function patchPreset(id: string, patch: Partial<ReasoningPreset>) { if (activeModel) updateModel({ reasoningPresets: activeModel.reasoningPresets.map((preset) => preset.id === id ? { ...preset, ...patch } : preset) }); }
  function removePreset(id: string) { if (activeModel) updateModel({ reasoningPresets: activeModel.reasoningPresets.filter((preset) => preset.id !== id) }); }
  const efforts = activeModel?.reasoningEfforts?.length ? activeModel.reasoningEfforts : ["none", "low", "medium", "high", "xhigh"];
  const visibleModels = draft.models.filter((model) => model.visible !== false);
  return <div className="settings-section wide"><SectionTitle icon={<BrainCircuit size={19} />} title={c.reasoningTitle} description={c.reasoningDesc} action={<button className="subtle-action" onClick={addPreset}><Plus size={16} /> {c.addTemplate}</button>} /><div className="split-model-editor"><ModelColumn c={c} models={visibleModels} active={activeModelId} onChange={setActiveModelId} /><div className="model-editor-pane reasoning-pane">{activeModel ? <><div className="reason-capability"><div><strong>{c.nativeSupport}</strong><small>{activeModel.reasoningEfforts?.length ? `API efforts: ${activeModel.reasoningEfforts.join(", ")}` : c.noEffortMetadata}</small></div><button className={`toggle ${activeModel.reasoningSupported ? "on" : ""}`} onClick={() => updateModel({ reasoningSupported: !activeModel.reasoningSupported })}><i /></button></div><div className="preset-list">{activeModel.reasoningPresets.map((preset) => <div className="preset-editor" key={preset.id}><div className="preset-editor-head"><span className={`kind-icon ${preset.kind}`}><BrainCircuit size={15} /></span><input value={preset.name} onChange={(event) => patchPreset(preset.id, { name: event.target.value })} aria-label={c.reasoningPreset} /><select value={preset.kind} onChange={(event) => patchPreset(preset.id, { kind: event.target.value as ReasoningPreset["kind"] })}><option value="builtin">{c.builtIn}</option><option value="custom">{c.customTemplate}</option></select><button onClick={() => removePreset(preset.id)}><Trash2 size={15} /></button></div><div className="preset-editor-body">{activeModel.reasoningSupported && <label><span>{c.nativeEffort}</span><select value={preset.effort || ""} onChange={(event) => patchPreset(preset.id, { effort: event.target.value })}><option value="">{c.doNotSend}</option>{efforts.map((effort) => <option value={effort} key={effort}>{effort === "xhigh" ? "extra high" : effort.replaceAll("_", " ")}</option>)}</select></label>}{preset.kind === "custom" && <><label><span>{c.promptHandling}</span><select value={preset.systemPromptMode || "append"} onChange={(event) => patchPreset(preset.id, { systemPromptMode: event.target.value as ReasoningPreset["systemPromptMode"] })}><option value="replace">{c.replace}</option><option value="prepend">{c.prepend}</option><option value="append">{c.append}</option></select></label><label><span>{c.additionalPrompt}</span><textarea rows={3} value={preset.systemPrompt || ""} onChange={(event) => patchPreset(preset.id, { systemPrompt: event.target.value })} placeholder={c.systemPromptPlaceholder} /></label></>}</div></div>)}{!activeModel.reasoningPresets.length && <EmptyState text={c.noPresets} />}</div></> : <EmptyState text={c.noModel} />}</div></div></div>;
}

function SectionTitle({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) { return <div className="section-title"><span className="title-icon">{icon}</span><div><h3>{title}</h3><p>{description}</p></div>{action}</div>; }
function EmptyState({ text }: { text: string }) { return <div className="empty-state"><UserRound size={22} /><p>{text}</p></div>; }
