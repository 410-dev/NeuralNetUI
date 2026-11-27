import { vmCallerId, vmDefaultPolicy } from "./vm";
import { isVmFileTool, runVmFileTool, VM_FILE_TOOLS } from "./vm-files";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Client, StreamableHTTPClientTransport, type AuthProvider, type Tool } from "@modelcontextprotocol/client";
import { z } from "zod";
import { AuthError } from "./auth";
import { db } from "./database";
import type { McpAuthType, McpConnection, McpEntitlement, McpToolInfo, McpToolPolicy } from "./types";
import type { ModelContentPart } from "./document-processing";
import { classifyMcpAddress, describeMcpFailure, mcpStorageLink, mcpToolAlias, type McpStorageLink } from "./mcp-utils";
import { importStreamToStorage } from "./storage-chunk-upload";

const MAX_RESULT_CHARS = 100_000;
const CONNECTION_TIMEOUT_MS = 20_000;
export const DEFAULT_MCP_TOOL_TIMEOUT_SECONDS = 20;
export const MIN_MCP_TOOL_TIMEOUT_SECONDS = 5;
export const MAX_MCP_TOOL_TIMEOUT_SECONDS = 600;
const toolTimeoutMessage = `도구 실행 타임아웃은 ${MIN_MCP_TOOL_TIMEOUT_SECONDS}~${MAX_MCP_TOOL_TIMEOUT_SECONDS}초 사이의 정수여야 합니다.`;
const DEFAULT_TOOL_POLICY: McpToolPolicy = "session_ask";

type McpRow = {
  id: string; user_id: string; name: string; description: string; url: string;
  auth_type: McpAuthType; credential: string; enabled: number; tool_timeout_seconds: number; kind?: "user" | "vm"; created_at: string; updated_at: string;
};

const connectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().default(""),
  url: z.string().trim().url().max(2000).refine(value => { const url=new URL(value);return ["http:", "https:"].includes(url.protocol)&&!url.username&&!url.password; }, "MCP URL은 사용자 정보가 없는 HTTP(S) 주소여야 합니다."),
  authType: z.enum(["oauth", "api_key", "none"]),
  credential: z.string().max(8000).optional().default(""),
  enabled: z.boolean().optional().default(true),
  toolTimeoutSeconds: z.number().int().min(MIN_MCP_TOOL_TIMEOUT_SECONDS, toolTimeoutMessage).max(MAX_MCP_TOOL_TIMEOUT_SECONDS, toolTimeoutMessage).optional(),
  kind: z.enum(["user", "vm"]).optional().default("user"),
});
/** Shell commands on a virtual computer can run for minutes; they report progress, but start with a long limit. */
const VM_TOOL_TIMEOUT_SECONDS = 600;

function publicConnection(row: McpRow): McpConnection {
  return { id: row.id, name: row.name, description: row.description || undefined, url: row.url, authType: row.auth_type, hasCredential: Boolean(row.credential), enabled: row.enabled === 1, toolTimeoutSeconds: row.tool_timeout_seconds, kind: row.kind === "vm" ? "vm" : "user", createdAt: row.created_at, updatedAt: row.updated_at };
}

export function mcpEntitlement(userId: string): McpEntitlement {
  const row = db.prepare(`SELECT p.mcp_enabled AS enabled,p.max_mcp_connections AS maximum,
    (SELECT COUNT(*) FROM mcp_connections m WHERE m.user_id=u.id AND m.kind='user') AS used
    FROM users u LEFT JOIN plans p ON p.id=u.plan_id WHERE u.id=?`).get(userId) as { enabled: number | null; maximum: number | null; used: number } | undefined;
  return { enabled: row?.enabled === 1, maxConnections: row?.maximum || 0, usedConnections: row?.used || 0 };
}

export function listMcpConnections(userId: string): McpConnection[] {
  return (db.prepare("SELECT * FROM mcp_connections WHERE user_id=? ORDER BY kind='vm' DESC,created_at,name").all(userId) as McpRow[]).map(publicConnection);
}

function ownedRow(userId: string, id: string): McpRow {
  const row = db.prepare("SELECT * FROM mcp_connections WHERE id=? AND user_id=?").get(id, userId) as McpRow | undefined;
  if (!row) throw new AuthError("MCP 연결을 찾을 수 없습니다.", 404);
  return row;
}

function assertEntitled(userId: string, adding = false) {
  const entitlement = mcpEntitlement(userId);
  if (!entitlement.enabled) throw new AuthError("현재 플랜에서는 MCP 연결을 사용할 수 없습니다.", 403);
  if (adding && entitlement.usedConnections >= entitlement.maxConnections) throw new AuthError(`현재 플랜의 MCP 등록 한도(${entitlement.maxConnections}개)에 도달했습니다.`, 409);
  return entitlement;
}

export function createMcpConnection(userId: string, input: unknown): McpConnection {
  const value = connectionSchema.parse(input);
  // The virtual computer is separate from the plan's MCP allowance; an account has at most one.
  if (value.kind === "vm") { if (db.prepare("SELECT 1 FROM mcp_connections WHERE user_id=? AND kind='vm'").get(userId)) throw new AuthError("가상 컴퓨터는 하나만 등록할 수 있습니다.", 409); }
  else assertEntitled(userId, true);
  if (value.authType !== "none" && !value.credential.trim()) throw new AuthError("선택한 인증 방식의 토큰 또는 API 키를 입력해 주세요.", 400);
  const id = randomUUID(), stamp = new Date().toISOString();
  try {
    db.prepare("INSERT INTO mcp_connections(id,user_id,name,description,url,auth_type,credential,enabled,tool_timeout_seconds,kind,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, userId, value.name, value.description, value.url, value.authType, value.authType === "none" ? "" : value.credential.trim(), value.enabled ? 1 : 0, value.toolTimeoutSeconds ?? (value.kind === "vm" ? VM_TOOL_TIMEOUT_SECONDS : DEFAULT_MCP_TOOL_TIMEOUT_SECONDS), value.kind, stamp, stamp);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new AuthError("같은 이름의 MCP 연결이 이미 있습니다.", 409);
    throw error;
  }
  return publicConnection(ownedRow(userId, id));
}

export function updateMcpConnection(userId: string, id: string, input: unknown): McpConnection {
  const previous = ownedRow(userId, id), value = connectionSchema.parse(input);
  if (previous.kind !== "vm") assertEntitled(userId);
  const credential = value.authType === "none" ? "" : value.credential.trim() || (value.authType === previous.auth_type ? previous.credential : "");
  if (value.authType !== "none" && !credential) throw new AuthError("선택한 인증 방식의 토큰 또는 API 키를 입력해 주세요.", 400);
  try {
    db.prepare("UPDATE mcp_connections SET name=?,description=?,url=?,auth_type=?,credential=?,enabled=?,tool_timeout_seconds=?,updated_at=? WHERE id=? AND user_id=?")
      .run(value.name, value.description, value.url, value.authType, credential, value.enabled ? 1 : 0, value.toolTimeoutSeconds ?? previous.tool_timeout_seconds, new Date().toISOString(), id, userId);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new AuthError("같은 이름의 MCP 연결이 이미 있습니다.", 409);
    throw error;
  }
  return publicConnection(ownedRow(userId, id));
}

export function deleteMcpConnection(userId: string, id: string) {
  const result = db.prepare("DELETE FROM mcp_connections WHERE id=? AND user_id=?").run(id, userId);
  if (!result.changes) throw new AuthError("MCP 연결을 찾을 수 없습니다.", 404);
}

function requestSignal(signal?: AbortSignal, timeoutMs = CONNECTION_TIMEOUT_MS) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

async function assertNetworkTarget(userId:string,rawUrl:string){
  const url=new URL(rawUrl);if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw new AuthError("안전하지 않은 MCP URL입니다.",400);
  const hostname=url.hostname.replace(/^\[|\]$/g,"");
  const addresses=await lookup(hostname,{all:true});if(!addresses.length)throw new AuthError("MCP 서버 주소를 확인할 수 없습니다.",400);
  const classes=addresses.map(item=>classifyMcpAddress(item.address));
  if(classes.includes("blocked"))throw new AuthError("링크 로컬 또는 예약 주소에는 MCP를 연결할 수 없습니다.",403);
  if(classes.includes("private")){const role=(db.prepare("SELECT role FROM users WHERE id=?").get(userId) as {role:string}|undefined)?.role;if(role!=="admin"&&role!=="superadmin")throw new AuthError("내부 네트워크 MCP 연결은 관리자 계정에서만 사용할 수 있습니다.",403);}
}

async function connectedClient(row: McpRow, signal?: AbortSignal) {
  await assertNetworkTarget(row.user_id,row.url);
  const authProvider: AuthProvider | undefined = row.auth_type === "none" ? undefined : { token: async () => row.credential || undefined };
  const guardedFetch:typeof fetch=async(input,init)=>{const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;await assertNetworkTarget(row.user_id,url);return fetch(input,{...init,redirect:"error"});};
  // A virtual computer keeps one workspace per account, named by an opaque id.
  const requestInit = row.kind === "vm" ? { headers: { "X-NNUI-User": vmCallerId(row.user_id) } } : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(row.url), { ...(authProvider ? { authProvider } : {}),fetch:guardedFetch, ...(requestInit ? { requestInit } : {}) });
  const client = new Client({ name: "NeuralNetUI", version: "3.0.0" }, { cachePartition: row.user_id });
  await client.connect(transport, { signal: requestSignal(signal) });
  return client;
}

/** Runs one exchange with an MCP server; its failures become a 400 with a readable message. Our own checks pass through. */
async function talkToServer<T>(endpoint: string, signal: AbortSignal | undefined, exchange: () => Promise<T>): Promise<T> {
  try { return await exchange(); }
  catch (error) {
    if (error instanceof AuthError || signal?.aborted || (error as { name?: unknown })?.name === "AbortError") throw error;
    throw new AuthError(describeMcpFailure(error, endpoint), 400);
  }
}

export function toolPolicies(connectionId: string) {
  return new Map((db.prepare("SELECT tool_name,policy FROM mcp_tool_policies WHERE connection_id=?").all(connectionId) as Array<{tool_name:string;policy:McpToolPolicy}>).map(item=>[item.tool_name,item.policy]));
}

export async function listMcpTools(userId: string, connectionId: string, signal?: AbortSignal): Promise<McpToolInfo[]> {
  const row=ownedRow(userId,connectionId);
  if(row.kind!=="vm")assertEntitled(userId);
  if(!row.enabled)throw new AuthError("이 MCP 연결은 비활성화되어 있습니다.",403);
  const policies=toolPolicies(connectionId);
  return talkToServer(row.url,signal,async()=>{
    const client=await connectedClient(row,signal);
    try {
      const result=await client.listTools(undefined,{signal:requestSignal(signal),cacheMode:"bypass"});
      const browser=row.kind==="vm"?[...await vmBrowserToolList(userId).catch(()=>[]),...(await import("./secure-input")).SECURE_INPUT_SPECS]:[];
      return [...result.tools,...(row.kind==="vm"?VM_FILE_TOOLS:[]),...browser].map(tool=>({name:tool.name,description:tool.description,inputSchema:tool.inputSchema,policy:policies.get(tool.name)||(row.kind==="vm"?vmDefaultPolicy(tool.name):DEFAULT_TOOL_POLICY)}));
    } finally { await client.close().catch(()=>undefined); }
  });
}

export function saveMcpToolPolicies(userId:string,connectionId:string,input:unknown){
  const owned=ownedRow(userId,connectionId);if(owned.kind!=="vm")assertEntitled(userId);
  const source=input&&typeof input==="object"?input as Record<string,unknown>:{};
  const entries=Array.isArray(source.tools)?source.tools:[];
  const parsed=entries.map(item=>{const value=item&&typeof item==="object"?item as Record<string,unknown>:{};const name=String(value.name||"").trim(),policy=String(value.policy||"") as McpToolPolicy;if(!name||name.length>200||!["blocked","always_ask","session_ask","always_allow"].includes(policy))throw new AuthError("올바르지 않은 MCP 도구 정책입니다.",400);return{name,policy};});
  const stamp=new Date().toISOString(),statement=db.prepare("INSERT INTO mcp_tool_policies(connection_id,tool_name,policy,updated_at) VALUES(?,?,?,?) ON CONFLICT(connection_id,tool_name) DO UPDATE SET policy=excluded.policy,updated_at=excluded.updated_at");
  db.transaction(()=>{for(const item of parsed)statement.run(connectionId,item.name,item.policy,stamp);})();
  return {saved:parsed.length};
}

export async function testMcpConnection(userId: string, input: unknown & { id?: string }, signal?: AbortSignal) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const previous = typeof source.id === "string" ? ownedRow(userId, source.id) : undefined;
  const value = connectionSchema.parse(source);
  if (value.kind !== "vm") assertEntitled(userId);
  const credential = value.authType === "none" ? "" : value.credential.trim() || (previous?.auth_type === value.authType ? previous.credential : "");
  if (value.authType !== "none" && !credential) throw new AuthError("연결 테스트에 사용할 토큰 또는 API 키를 입력해 주세요.", 400);
  const row: McpRow = { id: previous?.id || "test", user_id: userId, name: value.name, description: value.description, url: value.url, auth_type: value.authType, credential, enabled: 1, tool_timeout_seconds: value.toolTimeoutSeconds ?? VM_TOOL_TIMEOUT_SECONDS, kind: value.kind, created_at: "", updated_at: "" };
  return talkToServer(row.url, signal, async () => {
    const client = await connectedClient(row, signal);
    try { const result = await client.listTools(undefined, { signal: requestSignal(signal), cacheMode: "bypass" }); return { toolCount: result.tools.length, tools: result.tools.slice(0, 20).map(tool => tool.name) }; }
    finally { await client.close().catch(() => undefined); }
  });
}

export type McpToolBinding = { advertisedName: string; connectionId: string; connectionName: string; toolName: string; tool: Tool; policy: McpToolPolicy };

/**
 * One enabled connection's tools as call bindings, blocked tools left out. Advertised names are namespaced by the
 * connection so two servers can offer tools with the same name.
 */
export async function mcpConnectionBindings(userId: string, connectionId: string, signal?: AbortSignal): Promise<McpToolBinding[]> {
  const row = ownedRow(userId, connectionId);
  if (row.kind !== "vm") assertEntitled(userId);
  if (row.enabled !== 1) return [];
  const tools = await talkToServer(row.url, signal, async () => {
    const client = await connectedClient(row, signal);
    try { return (await client.listTools(undefined, { signal: requestSignal(signal), cacheMode: "bypass" })).tools; }
    finally { await client.close().catch(() => undefined); }
  });
  const policies = toolPolicies(row.id);
  const bindings = new Map<string, McpToolBinding>();
  for (const tool of tools) {
    const policy = policies.get(tool.name) || (row.kind === "vm" ? vmDefaultPolicy(tool.name) : DEFAULT_TOOL_POLICY);
    if (policy === "blocked") continue;
    let advertisedName = mcpToolAlias(row.id, tool.name), suffix = 2;
    while (bindings.has(advertisedName)) advertisedName = `${mcpToolAlias(row.id, tool.name).slice(0, 60)}_${suffix++}`;
    bindings.set(advertisedName, { advertisedName, connectionId: row.id, connectionName: row.name, toolName: tool.name, tool, policy });
  }
  // The virtual computer also moves files to and from private storage; NeuralNetUI runs these itself.
  if (row.kind === "vm") for (const tool of VM_FILE_TOOLS) {
    const policy = policies.get(tool.name) || vmDefaultPolicy(tool.name);
    if (policy !== "blocked") bindings.set(mcpToolAlias(row.id, tool.name), { advertisedName: mcpToolAlias(row.id, tool.name), connectionId: row.id, connectionName: row.name, toolName: tool.name, tool, policy });
  }
  return [...bindings.values()];
}

function bounded(value: string) { return value.length <= MAX_RESULT_CHARS ? value : `${value.slice(0, MAX_RESULT_CHARS)}\n[Result truncated]`; }

export type McpToolProgress = { stage: "tool" | "storage"; progress: number; total?: number; message?: string; name?: string };

/**
 * Runs one MCP tool call. The connection's timeout is a limit on silence, not on total time: every progress
 * notification from the server restarts it, so a long download that keeps reporting is never cut off. Files the
 * server marks for saving (see mcpStorageLink) are then streamed into the caller's private storage the same way.
 */
export async function executeMcpTool(userId: string, binding: McpToolBinding, args: unknown, signal?: AbortSignal, onProgress?: (update: McpToolProgress) => void): Promise<{ result: unknown; content?: ModelContentPart[] }> {
  const row = ownedRow(userId, binding.connectionId);
  if (row.kind !== "vm") assertEntitled(userId);
  if (!row.enabled) throw new AuthError("이 MCP 연결은 비활성화되어 있습니다.", 403);
  if (row.kind === "vm" && isVmFileTool(binding.toolName)) return runVmFileTool(userId, binding.toolName, (args && typeof args === "object" ? args : {}) as Record<string, unknown>, signal ?? AbortSignal.timeout(row.tool_timeout_seconds * 1000), message => onProgress?.({ stage: "storage", progress: 0, message }));
  const timeoutMs = (row.tool_timeout_seconds || DEFAULT_MCP_TOOL_TIMEOUT_SECONDS) * 1000;
  const response = await talkToServer(row.url, signal, async () => {
    const client = await connectedClient(row, signal);
    const quiet = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restart = () => { clearTimeout(timer); timer = setTimeout(() => quiet.abort(new Error(`The MCP tool reported nothing for ${row.tool_timeout_seconds || DEFAULT_MCP_TOOL_TIMEOUT_SECONDS} seconds.`)), timeoutMs); };
    restart();
    try {
      return await client.callTool({ name: binding.toolName, arguments: args && typeof args === "object" ? args as Record<string, unknown> : {} }, {
        signal: signal ? AbortSignal.any([signal, quiet.signal]) : quiet.signal,
        timeout: timeoutMs, resetTimeoutOnProgress: true, toolDefinition: binding.tool,
        onprogress: progress => { restart(); onProgress?.({ stage: "tool", progress: progress.progress, ...(progress.total !== undefined ? { total: progress.total } : {}), ...(progress.message ? { message: progress.message } : {}) }); },
      });
    } catch (error) {
      if (quiet.signal.aborted && !signal?.aborted) throw new AuthError(`MCP 도구가 ${row.tool_timeout_seconds || DEFAULT_MCP_TOOL_TIMEOUT_SECONDS}초 동안 결과도 진행 상황도 보내지 않아 중단했습니다. 오래 걸리는 도구라면 서버가 진행 상황을 보내도록 하거나 연결의 도구 실행 타임아웃을 늘려 주세요.`, 400);
      throw error;
    } finally { clearTimeout(timer); await client.close().catch(() => undefined); }
  });
  const content: ModelContentPart[] = [];
  const summaries: unknown[] = [];
  for (const part of response.content || []) {
    const link = mcpStorageLink(part, row.url);
    if (link) {
      const saved = await saveLinkToStorage(row, userId, link, timeoutMs, signal, onProgress);
      content.push({ type: "text", text: saved.text }); summaries.push(saved.summary);
    }
    else if (part.type === "text") { const text = bounded(part.text); content.push({ type: "text", text }); summaries.push({ type: "text", text }); }
    else if (part.type === "image") { content.push({ type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } }); summaries.push({ type: "image", mimeType: part.mimeType, bytes: Math.ceil(part.data.length * .75) }); }
    else if (part.type === "resource" && "text" in part.resource) { const text = bounded(part.resource.text); content.push({ type: "text", text }); summaries.push({ type: "resource", uri: part.resource.uri, text }); }
    else summaries.push({ type: part.type });
  }
  if (response.structuredContent !== undefined) {
    const text = bounded(JSON.stringify(response.structuredContent));
    content.push({ type: "text", text });
    summaries.push({ type: "structured", text });
  }
  return { result: { connection: row.name, tool: binding.toolName, isError: response.isError === true, content: summaries }, ...(content.length ? { content } : {}) };
}

function formatBytes(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Streams a server file into the caller's private storage. The transfer has no total time limit; it fails only when
 * no data arrives for the connection's timeout (at least a minute). A failed transfer leaves nothing in storage. The
 * server's copy is deleted after a successful save.
 */
async function saveLinkToStorage(row: McpRow, userId: string, link: McpStorageLink, toolTimeoutMs: number, signal: AbortSignal | undefined, onProgress?: (update: McpToolProgress) => void) {
  const headers: Record<string, string> = row.auth_type === "none" || !row.credential ? {} : { authorization: `Bearer ${row.credential}` };
  try {
    await assertNetworkTarget(userId, link.url);
    const response = await fetch(link.url, { headers, redirect: "error", ...(signal ? { signal } : {}) });
    if (!response.ok || !response.body) { await response.body?.cancel().catch(() => undefined); throw new Error(`The MCP server answered ${response.status} for the file.`); }
    let reported = 0;
    const stored = await importStreamToStorage({
      userId, name: link.name, size: link.size, ...(link.sha256 ? { sha256: link.sha256 } : {}), body: response.body,
      idleTimeoutMs: Math.max(60_000, toolTimeoutMs), ...(signal ? { signal } : {}),
      onProgress: received => { const now = Date.now(); if (now - reported < 1000 && received < link.size) return; reported = now; onProgress?.({ stage: "storage", progress: received, total: link.size, name: link.name }); },
    });
    void fetch(link.url, { method: "DELETE", headers, redirect: "error" }).catch(() => undefined);
    const escaped = stored.name.replace(/([\\\]])/g, "\\$1");
    const markdown = `[${escaped}](${stored.url}?download=1)`;
    return {
      text: `Saved "${stored.name}" (${formatBytes(stored.size)}) to the user's private storage. Link for the user: ${markdown}`,
      summary: { type: "saved_to_storage", id: stored.id, name: stored.name, size: stored.size, mimeType: stored.mimeType, url: stored.url, markdown },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      text: `Saving "${link.name}" to the user's private storage failed: ${message} Nothing was kept in storage.`,
      summary: { type: "storage_save_failed", name: link.name, size: link.size, error: message },
    };
  }
}

/** The browser tools a virtual computer carries (Obscura's, run by NeuralNetUI's browser broker), for its permission list. */
async function vmBrowserToolList(userId: string): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
  const [{ readConfig }, { browserToolSpecs }] = await Promise.all([import("./config"), import("./tools/builtin")]);
  return (await browserToolSpecs({ userId, conversationId: "vm-tool-list", config: await readConfig() })).map(spec => ({ name: spec.name, description: spec.description, inputSchema: spec.inputSchema }));
}
