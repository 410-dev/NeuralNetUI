import { isIP } from "node:net";

export type McpAddressClass = "public" | "private" | "blocked";

export function classifyMcpAddress(address:string):McpAddressClass {
  const value=address.toLowerCase().split("%")[0];
  // Do not let IPv4-mapped IPv6 literals bypass the IPv4 range checks.
  if(value.startsWith("::ffff:"))return"blocked";
  if(isIP(value)===4){const parts=value.split(".").map(Number);if(parts[0]===0||parts[0]>=224||parts[0]===169&&parts[1]===254)return"blocked";if(parts[0]===10||parts[0]===127||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===192&&parts[1]===168)return"private";return"public";}
  if(value==="::"||value.startsWith("fe8")||value.startsWith("fe9")||value.startsWith("fea")||value.startsWith("feb")||value.startsWith("ff"))return"blocked";
  if(value==="::1"||value.startsWith("fc")||value.startsWith("fd"))return"private";
  return"public";
}

export function mcpToolAlias(connectionId: string, toolName: string) {
  const safe = toolName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 45) || "tool";
  return `mcp_${connectionId.replace(/-/g, "").slice(0, 8)}_${safe}`.slice(0, 64);
}

/**
 * A readable message for a failure while talking to an MCP server. The upstream HTTP status is reported in the text
 * only: NeuralNetUI answers its own client with 400, because answering 502/504 would make a proxy in front of
 * NeuralNetUI (such as Cloudflare Tunnel) replace the JSON body with its own error page.
 */
export function describeMcpFailure(error: unknown, endpoint: string): string {
  const source = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; status?: unknown; data?: { text?: unknown }; cause?: unknown } : {};
  // The SDK reports a rejected token as UnauthorizedError without an HTTP status.
  const unauthorized = source.name === "UnauthorizedError" || typeof source.message === "string" && /^unauthori[sz]ed\.?$/i.test(source.message.trim());
  const status = Number(source.status) || (unauthorized ? 401 : NaN);
  const raw = typeof source.data?.text === "string" ? source.data.text : typeof source.message === "string" ? source.message : String(error);
  let detail = raw.replace(/^Error POSTing to endpoint(?: \(HTTP \d+\))?:\s*/, "").trim();
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    const summary = [parsed.title, parsed.detail ?? (parsed.error as { message?: unknown } | undefined)?.message ?? parsed.error].filter(item => typeof item === "string" && item).join(" — ");
    if (summary) detail = summary;
  } catch { /* plain-text bodies are used as they are */ }
  if (/^\s*</.test(detail)) detail = "";
  detail = detail.replace(/\s+/g, " ").slice(0, 300);
  const cause = source.cause && typeof source.cause === "object" && typeof (source.cause as { code?: unknown }).code === "string" ? (source.cause as { code: string }).code : "";
  const hints: string[] = [];
  let path = "/";
  try { path = new URL(endpoint).pathname; } catch { /* the schema already validated the URL */ }
  if ((status === 404 || status === 405) && (path === "/" || path === "")) hints.push("엔드포인트 경로를 확인하세요. 많은 MCP 서버는 /mcp 경로를 씁니다.");
  if (status === 401 || status === 403) hints.push("인증 방식과 토큰 또는 API 키를 확인하세요.");
  if (status === 502 || status === 503 || status === 504 || status === 520 || status === 521 || status === 522 || status === 523 || status === 524) hints.push("서버 앞단의 프록시나 터널이 MCP 서버에 닿지 못했습니다. 프록시가 가리키는 주소와 http/https 설정, MCP 서버 실행 상태를 확인하세요.");
  const head = Number.isInteger(status) && status >= 400 && status < 600
    ? `MCP 서버가 HTTP ${status}로 응답했습니다`
    : `MCP 서버에 연결하지 못했습니다${cause ? ` (${cause})` : ""}`;
  return [`${head}${detail ? `: ${detail}` : "."}`, ...hints].join(" ");
}

/** A file an MCP server asks NeuralNetUI to save into the caller's private storage. */
export type McpStorageLink = { url: string; name: string; size: number; sha256?: string };

const STORAGE_LINK_PATH = /^files\/[A-Za-z0-9_-]{16,128}\/[^/?#]{1,1200}$/;

/**
 * Reads a `resource_link` content part that asks to be saved to storage (`_meta["nnui/saveToStorage"] === true`).
 * The file is fetched from `_meta["nnui/path"]`, resolved against the connection's own URL, so a tool result can never
 * point NeuralNetUI at another host. Anything malformed is ignored.
 */
export function mcpStorageLink(part: unknown, connectionUrl: string): McpStorageLink | undefined {
  const source = part && typeof part === "object" ? part as Record<string, unknown> : undefined;
  if (source?.type !== "resource_link") return undefined;
  const meta = source._meta && typeof source._meta === "object" ? source._meta as Record<string, unknown> : {};
  if (meta["nnui/saveToStorage"] !== true || typeof meta["nnui/path"] !== "string" || !STORAGE_LINK_PATH.test(meta["nnui/path"])) return undefined;
  const size = Number(source.size);
  if (!Number.isSafeInteger(size) || size <= 0) return undefined;
  let url: URL;
  try { url = new URL(meta["nnui/path"], connectionUrl); } catch { return undefined; }
  if (url.origin !== new URL(connectionUrl).origin) return undefined;
  const name = typeof source.name === "string" && source.name.trim() ? source.name.trim().slice(0, 240) : decodeURIComponent(meta["nnui/path"].split("/").pop() || "download");
  const sha256 = typeof meta.sha256 === "string" && /^[a-f0-9]{64}$/i.test(meta.sha256) ? meta.sha256.toLowerCase() : undefined;
  return { url: url.toString(), name, size, ...(sha256 ? { sha256 } : {}) };
}
