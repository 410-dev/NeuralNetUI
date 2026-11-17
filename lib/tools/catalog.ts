import type { Locale } from "../types.ts";

/**
 * What every tool provider looks like to the people who use it. This module is shared by the
 * server and the browser, so it holds data only: no Node imports and no execution code.
 *
 * Three origins share one shape:
 * - builtin   — shipped with NeuralNetUI, placed in one of the fixed categories below
 * - workspace — installed by an administrator for every account (reserved for the next step)
 * - user      — installed by one account for itself (today: the account's MCP connections)
 */
export type ToolOrigin = "builtin" | "workspace" | "user";
export type ToolCategory = "internet" | "awareness" | "agent" | "interaction";
/** Menu section: the fixed built-in categories, then the installed tiers. */
export type ToolSection = ToolCategory | "workspace" | "mcp";
export type ToolIcon = "search" | "link" | "braces" | "clock" | "map-pin" | "hard-drive" | "terminal" | "list-checks" | "code" | "cable" | "wrench";
export type Localized = Record<Locale, string>;

export type ToolOptionField =
  | { key: string; kind: "boolean"; label: Localized; description?: Localized; default: boolean }
  /** A bounded whole number. `pairedWith` draws it beside that boolean option instead of on its own row. */
  | { key: string; kind: "integer"; label: Localized; default: number; min: number; max: number; pairedWith?: string };

export type ToolOptions = Record<string, boolean | number>;

export interface ToolFunctionManifest { name: string; label: Localized; description: Localized }

/** Conditions the server enforces before a provider is offered. The browser reads them only to hide rows. */
export interface ToolRequirements {
  experimental?: "hostComputerTool";
  role?: "superadmin";
  /** Needs a host that is not a container. */
  hostEnvironment?: boolean;
}

export interface ToolProviderManifest {
  /** Stable key stored in account preferences, e.g. "web-search" or "mcp:<connection id>". */
  id: string;
  origin: ToolOrigin;
  section: ToolSection;
  order: number;
  icon: ToolIcon;
  label: Localized;
  description: Localized;
  defaultEnabled: boolean;
  /** Functions with fixed names. Dynamic providers list none and declare `functionPrefix`. */
  functions: ToolFunctionManifest[];
  functionPrefix?: string;
  options?: ToolOptionField[];
  requires?: ToolRequirements;
  /**
   * How a waiting call is answered in the browser. "approval" uses the shared approval card; the others pick a
   * renderer built into the app. Installed providers may only use "approval".
   */
  clientRenderer?: "multiple-choice" | "location" | "code-runner";
  /** Wait phase shown while the model is still streaming this tool's arguments. */
  streamingPhase?: "creating-artifact";
  /** Completed calls are drawn as their own card in the transcript instead of in the tool activity list. */
  transcriptCard?: "multiple-choice" | "artifact";
}

const text = (en: string, ko: string): Localized => ({ en, ko });

export const TOOL_SECTION_LABELS: Record<ToolSection, Localized> = {
  internet: text("Internet", "인터넷"),
  awareness: text("Ambient awareness", "주변 인식"),
  agent: text("Agent", "에이전트"),
  interaction: text("Interaction", "상호 작용"),
  workspace: text("Workspace", "워크스페이스"),
  mcp: text("MCP", "MCP"),
};

export const TOOL_SECTION_ORDER: ToolSection[] = ["internet", "awareness", "agent", "interaction", "workspace", "mcp"];

export const BUILTIN_TOOL_PROVIDERS: readonly ToolProviderManifest[] = [
  {
    id: "web-search", origin: "builtin", section: "internet", order: 10, icon: "search", defaultEnabled: false,
    label: text("Internet search", "인터넷 검색"), description: text("Let the model search DuckDuckGo", "모델이 DuckDuckGo를 검색하도록 허용"),
    functions: [{ name: "internet_search", label: text("Internet search", "인터넷 검색"), description: text("Titles, URLs and snippets from DuckDuckGo", "DuckDuckGo 검색 결과의 제목, URL, 스니펫") }],
  },
  {
    id: "page-visit", origin: "builtin", section: "internet", order: 20, icon: "link", defaultEnabled: false,
    label: text("Visit pages", "페이지 방문"), description: text("Let the model read public web pages", "모델이 공개 웹 페이지를 읽도록 허용"),
    functions: [{ name: "visit_page", label: text("Page visit", "페이지 방문"), description: text("Reads the title and text of a public HTTP(S) page", "공개 HTTP(S) 페이지의 제목과 본문 읽기") }],
  },
  {
    id: "current-time", origin: "builtin", section: "awareness", order: 10, icon: "clock", defaultEnabled: true,
    label: text("Current time", "현재 시간"), description: text("Provide local time and time zone to the model", "현지 시간과 시간대를 모델에 제공"),
    functions: [{ name: "get_current_time", label: text("Current time", "현재 시간"), description: text("Date, time with seconds, and IANA time zone", "초 단위 날짜·시각과 IANA 시간대") }],
  },
  {
    id: "location", origin: "builtin", section: "awareness", order: 20, icon: "map-pin", defaultEnabled: false,
    label: text("Current location", "현재 위치"), description: text("Use browser location and detailed reverse geocoding", "브라우저 위치와 상세 역지오코딩 사용"),
    functions: [{ name: "get_current_location", label: text("Current location", "현재 위치"), description: text("Asks this browser for its position, then reverse-geocodes it", "브라우저에 위치를 요청한 뒤 역지오코딩") }],
    clientRenderer: "location",
  },
  {
    id: "storage", origin: "builtin", section: "agent", order: 10, icon: "hard-drive", defaultEnabled: true,
    label: text("Storage access", "저장소 접근"), description: text("Let the model privately access your stored files", "모델의 개인 저장소 접근 권한"),
    functions: [{ name: "storage_access", label: text("Storage access", "저장소 접근"), description: text("Searches, reads, writes and saves files in private storage", "개인 저장소 파일 검색·읽기·쓰기·URL 저장") }],
    options: [
      { key: "read", kind: "boolean", default: true, label: text("Read", "읽기"), description: text("Search files and load them into the model's context", "파일 검색과 모델 컨텍스트 불러오기") },
      { key: "write", kind: "boolean", default: false, label: text("Write", "쓰기"), description: text("Create text files and save files from URLs", "텍스트 파일 생성과 URL 파일 저장") },
      { key: "maxFiles", kind: "integer", default: 5, min: 1, max: 20, pairedWith: "write", label: text("files per chat", "개/대화") },
    ],
  },
  {
    id: "code-runner", origin: "builtin", section: "agent", order: 20, icon: "braces", defaultEnabled: false,
    label: text("Code runner", "코드 실행"), description: text("Run JavaScript or Python in this browser's sandbox, never on the server", "JavaScript·Python을 서버가 아닌 이 브라우저의 샌드박스에서 실행"),
    functions: [
      { name: "run_javascript", label: text("JavaScript", "JavaScript"), description: text("Sandboxed worker with no network or page access", "네트워크·페이지 접근이 없는 격리된 워커") },
      { name: "run_python", label: text("Python", "Python"), description: text("Pyodide, downloaded from jsDelivr on first use in a tab", "탭에서 처음 쓸 때 jsDelivr에서 Pyodide를 내려받음") },
    ],
    options: [{ key: "timeoutSeconds", kind: "integer", default: 30, min: 5, max: 120, label: text("Time limit (seconds)", "실행 제한 시간(초)") }],
    clientRenderer: "code-runner",
  },
  {
    id: "host-computer", origin: "builtin", section: "agent", order: 40, icon: "terminal", defaultEnabled: false,
    label: text("Host computer", "호스트 컴퓨터"), description: text("Let the model control files, shells, programs, uploads, and the host screen", "모델의 파일·셸·프로그램·업로드·호스트 화면 제어 허용"),
    functions: [{ name: "host_computer", label: text("Host computer", "호스트 컴퓨터"), description: text("Files, processes, shells and screenshots on this server's computer", "이 서버 컴퓨터의 파일·프로세스·셸·화면") }],
    requires: { experimental: "hostComputerTool", role: "superadmin", hostEnvironment: true },
  },
  {
    id: "multiple-choice", origin: "builtin", section: "interaction", order: 10, icon: "list-checks", defaultEnabled: true,
    label: text("Multiple choice", "다중 선택"), description: text("Let the model ask selectable questions", "모델이 설정된 개수만큼 선택형 질문을 요청"),
    functions: [{ name: "ask_multiple_choice", label: text("Multiple choice", "다중 선택"), description: text("Shows selectable questions above the composer", "입력창 위에 선택형 질문 표시") }],
    clientRenderer: "multiple-choice", transcriptCard: "multiple-choice",
  },
  {
    id: "artifact", origin: "builtin", section: "interaction", order: 20, icon: "code", defaultEnabled: true,
    label: text("Artifact", "아티팩트"), description: text("Render HTML, CSV, JSON, XML, or Markdown in an interactive viewer", "HTML·CSV·JSON·XML·Markdown을 전용 뷰어로 렌더링"),
    functions: [{ name: "create_artifact", label: text("Artifact", "아티팩트"), description: text("Creates a document or mini-app opened beside the chat", "채팅 옆에서 여는 문서나 미니 앱 생성") }],
    streamingPhase: "creating-artifact", transcriptCard: "artifact",
  },
];

const builtinById = new Map(BUILTIN_TOOL_PROVIDERS.map(manifest => [manifest.id, manifest]));
const builtinByFunction = new Map(BUILTIN_TOOL_PROVIDERS.flatMap(manifest => manifest.functions.map(fn => [fn.name, manifest] as const)));

export function builtinToolProvider(id: string) { return builtinById.get(id); }

/** The built-in provider that owns a function name, if any. Installed providers are looked up by prefix instead. */
export function builtinProviderForFunction(name: string) { return builtinByFunction.get(name); }

export const MCP_PROVIDER_PREFIX = "mcp:";
export const mcpProviderId = (connectionId: string) => `${MCP_PROVIDER_PREFIX}${connectionId}`;
export const isMcpFunctionName = (name: string) => /^mcp_[a-f0-9]{8}_/i.test(name);

/** An MCP connection the account registered, presented as a "user" tier provider. */
export function mcpManifest(connection: { id: string; name: string; description?: string; url: string }, order = 0): ToolProviderManifest {
  const description = connection.description || connection.url;
  return {
    id: mcpProviderId(connection.id), origin: "user", section: "mcp", order, icon: "cable", defaultEnabled: false,
    label: { en: connection.name, ko: connection.name }, description: { en: description, ko: description },
    functions: [], functionPrefix: `mcp_${connection.id.replace(/-/g, "").slice(0, 8)}_`,
  };
}

export interface ToolEnvironment {
  role?: string;
  experimental?: { hostComputerTool?: boolean };
  /** True when the host is not a container. */
  hostEnvironment?: boolean;
}

export function toolRequirementsMet(manifest: Pick<ToolProviderManifest, "requires">, environment: ToolEnvironment) {
  const requires = manifest.requires;
  if (!requires) return true;
  if (requires.experimental && environment.experimental?.[requires.experimental] !== true) return false;
  if (requires.role && environment.role !== requires.role) return false;
  if (requires.hostEnvironment && environment.hostEnvironment !== true) return false;
  return true;
}

export function streamingPhaseFor(name: string) { return builtinProviderForFunction(name)?.streamingPhase; }
export function transcriptCardFor(name: string) { return builtinProviderForFunction(name)?.transcriptCard; }
export function clientRendererFor(name: string) { return builtinProviderForFunction(name)?.clientRenderer; }

export function toolIconFor(name: string): ToolIcon {
  return builtinProviderForFunction(name)?.icon || (isMcpFunctionName(name) ? "cable" : "wrench");
}

export function functionLabel(name: string, locale: Locale) {
  return builtinProviderForFunction(name)?.functions.find(fn => fn.name === name)?.label[locale];
}

/**
 * Which approval card a waiting call needs, read from what the server recorded on it rather than from the tool's
 * name: host computer calls carry a risk assessment, installed providers carry an approval request.
 */
export function pendingApprovalKind(event: { arguments?: unknown }): "host" | "mcp" | undefined {
  const args = event.arguments && typeof event.arguments === "object" ? event.arguments as Record<string, unknown> : {};
  if (args._mcpApproval && typeof args._mcpApproval === "object") return "mcp";
  if (args.authorization && typeof args.authorization === "object") return "host";
  return undefined;
}
