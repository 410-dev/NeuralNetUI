import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Client, StreamableHTTPClientTransport, type AuthProvider, type Tool } from "@modelcontextprotocol/client";
import { z } from "zod";
import { AuthError } from "./auth";
import { db } from "./database";
import type { McpAuthType, McpConnection, McpEntitlement, McpToolInfo, McpToolPolicy } from "./types";
import type { ModelContentPart } from "./document-processing";
import { classifyMcpAddress, mcpToolAlias } from "./mcp-utils";

const MAX_RESULT_CHARS = 100_000;
const CONNECTION_TIMEOUT_MS = 20_000;
const DEFAULT_TOOL_POLICY: McpToolPolicy = "session_ask";

type McpRow = {
  id: string; user_id: string; name: string; description: string; url: string;
  auth_type: McpAuthType; credential: string; enabled: number; created_at: string; updated_at: string;
};

const connectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().default(""),
  url: z.string().trim().url().max(2000).refine(value => { const url=new URL(value);return ["http:", "https:"].includes(url.protocol)&&!url.username&&!url.password; }, "MCP URL은 사용자 정보가 없는 HTTP(S) 주소여야 합니다."),
  authType: z.enum(["oauth", "api_key", "none"]),
  credential: z.string().max(8000).optional().default(""),
  enabled: z.boolean().optional().default(true),
});

function publicConnection(row: McpRow): McpConnection {
  return { id: row.id, name: row.name, description: row.description || undefined, url: row.url, authType: row.auth_type, hasCredential: Boolean(row.credential), enabled: row.enabled === 1, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function mcpEntitlement(userId: string): McpEntitlement {
  const row = db.prepare(`SELECT p.mcp_enabled AS enabled,p.max_mcp_connections AS maximum,
    (SELECT COUNT(*) FROM mcp_connections m WHERE m.user_id=u.id) AS used
    FROM users u LEFT JOIN plans p ON p.id=u.plan_id WHERE u.id=?`).get(userId) as { enabled: number | null; maximum: number | null; used: number } | undefined;
  return { enabled: row?.enabled === 1, maxConnections: row?.maximum || 0, usedConnections: row?.used || 0 };
}

export function listMcpConnections(userId: string): McpConnection[] {
  return (db.prepare("SELECT * FROM mcp_connections WHERE user_id=? ORDER BY created_at,name").all(userId) as McpRow[]).map(publicConnection);
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
  assertEntitled(userId, true);
  const value = connectionSchema.parse(input);
  if (value.authType !== "none" && !value.credential.trim()) throw new AuthError("선택한 인증 방식의 토큰 또는 API 키를 입력해 주세요.", 400);
  const id = randomUUID(), stamp = new Date().toISOString();
  try {
    db.prepare("INSERT INTO mcp_connections(id,user_id,name,description,url,auth_type,credential,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, userId, value.name, value.description, value.url, value.authType, value.authType === "none" ? "" : value.credential.trim(), value.enabled ? 1 : 0, stamp, stamp);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new AuthError("같은 이름의 MCP 연결이 이미 있습니다.", 409);
    throw error;
  }
  return publicConnection(ownedRow(userId, id));
}

export function updateMcpConnection(userId: string, id: string, input: unknown): McpConnection {
  assertEntitled(userId);
  const previous = ownedRow(userId, id), value = connectionSchema.parse(input);
  const credential = value.authType === "none" ? "" : value.credential.trim() || (value.authType === previous.auth_type ? previous.credential : "");
  if (value.authType !== "none" && !credential) throw new AuthError("선택한 인증 방식의 토큰 또는 API 키를 입력해 주세요.", 400);
  try {
    db.prepare("UPDATE mcp_connections SET name=?,description=?,url=?,auth_type=?,credential=?,enabled=?,updated_at=? WHERE id=? AND user_id=?")
      .run(value.name, value.description, value.url, value.authType, credential, value.enabled ? 1 : 0, new Date().toISOString(), id, userId);
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

function requestSignal(signal?: AbortSignal) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(CONNECTION_TIMEOUT_MS)]) : AbortSignal.timeout(CONNECTION_TIMEOUT_MS);
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
  const transport = new StreamableHTTPClientTransport(new URL(row.url), { ...(authProvider ? { authProvider } : {}),fetch:guardedFetch });
  const client = new Client({ name: "NeuralNetUI", version: "3.0.0" }, { cachePartition: row.user_id });
  await client.connect(transport, { signal: requestSignal(signal) });
  return client;
}

function toolPolicies(connectionId: string) {
  return new Map((db.prepare("SELECT tool_name,policy FROM mcp_tool_policies WHERE connection_id=?").all(connectionId) as Array<{tool_name:string;policy:McpToolPolicy}>).map(item=>[item.tool_name,item.policy]));
}

export async function listMcpTools(userId: string, connectionId: string, signal?: AbortSignal): Promise<McpToolInfo[]> {
  assertEntitled(userId);
  const row=ownedRow(userId,connectionId);
  if(!row.enabled)throw new AuthError("이 MCP 연결은 비활성화되어 있습니다.",403);
  const policies=toolPolicies(connectionId),client=await connectedClient(row,signal);
  try {
    const result=await client.listTools(undefined,{signal:requestSignal(signal),cacheMode:"bypass"});
    return result.tools.map(tool=>({name:tool.name,description:tool.description,inputSchema:tool.inputSchema,policy:policies.get(tool.name)||DEFAULT_TOOL_POLICY}));
  } finally { await client.close().catch(()=>undefined); }
}

export function saveMcpToolPolicies(userId:string,connectionId:string,input:unknown){
  assertEntitled(userId);ownedRow(userId,connectionId);
  const source=input&&typeof input==="object"?input as Record<string,unknown>:{};
  const entries=Array.isArray(source.tools)?source.tools:[];
  const parsed=entries.map(item=>{const value=item&&typeof item==="object"?item as Record<string,unknown>:{};const name=String(value.name||"").trim(),policy=String(value.policy||"") as McpToolPolicy;if(!name||name.length>200||!["blocked","always_ask","session_ask","always_allow"].includes(policy))throw new AuthError("올바르지 않은 MCP 도구 정책입니다.",400);return{name,policy};});
  const stamp=new Date().toISOString(),statement=db.prepare("INSERT INTO mcp_tool_policies(connection_id,tool_name,policy,updated_at) VALUES(?,?,?,?) ON CONFLICT(connection_id,tool_name) DO UPDATE SET policy=excluded.policy,updated_at=excluded.updated_at");
  db.transaction(()=>{for(const item of parsed)statement.run(connectionId,item.name,item.policy,stamp);})();
  return {saved:parsed.length};
}

export async function testMcpConnection(userId: string, input: unknown & { id?: string }, signal?: AbortSignal) {
  assertEntitled(userId);
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const previous = typeof source.id === "string" ? ownedRow(userId, source.id) : undefined;
  const value = connectionSchema.parse(source);
  const credential = value.authType === "none" ? "" : value.credential.trim() || (previous?.auth_type === value.authType ? previous.credential : "");
  if (value.authType !== "none" && !credential) throw new AuthError("연결 테스트에 사용할 토큰 또는 API 키를 입력해 주세요.", 400);
  const row: McpRow = { id: previous?.id || "test", user_id: userId, name: value.name, description: value.description, url: value.url, auth_type: value.authType, credential, enabled: 1, created_at: "", updated_at: "" };
  const client = await connectedClient(row, signal);
  try { const result = await client.listTools(undefined, { signal: requestSignal(signal), cacheMode: "bypass" }); return { toolCount: result.tools.length, tools: result.tools.slice(0, 20).map(tool => tool.name) }; }
  finally { await client.close().catch(() => undefined); }
}

export type McpToolBinding = { advertisedName: string; connectionId: string; connectionName: string; toolName: string; tool: Tool; policy: McpToolPolicy };

export async function mcpToolDefinitions(userId: string, selectedIds: string[], selectedTools: Record<string,string[]> = {}, signal?: AbortSignal): Promise<{ definitions: Array<Record<string, unknown>>; bindings: Map<string, McpToolBinding> }> {
  if (!selectedIds.length) return { definitions: [], bindings: new Map() };
  assertEntitled(userId);
  const ids = [...new Set(selectedIds)].slice(0, 100);
  const rows = ids.map(id => ownedRow(userId, id)).filter(row => row.enabled === 1);
  const listed = await Promise.all(rows.map(async row => {
    const client = await connectedClient(row, signal);
    try { return { row, tools: (await client.listTools(undefined, { signal: requestSignal(signal), cacheMode: "bypass" })).tools, policies:toolPolicies(row.id) }; }
    finally { await client.close().catch(() => undefined); }
  }));
  const definitions: Array<Record<string, unknown>> = [], bindings = new Map<string, McpToolBinding>();
  for (const { row, tools, policies } of listed) for (const tool of tools) {
    const policy=policies.get(tool.name)||DEFAULT_TOOL_POLICY;
    if(policy==="blocked"||(Object.hasOwn(selectedTools,row.id)&&!selectedTools[row.id].includes(tool.name)))continue;
    let advertisedName = mcpToolAlias(row.id, tool.name), suffix = 2;
    while (bindings.has(advertisedName)) advertisedName = `${mcpToolAlias(row.id, tool.name).slice(0, 60)}_${suffix++}`;
    bindings.set(advertisedName, { advertisedName, connectionId: row.id, connectionName: row.name, toolName: tool.name, tool, policy });
    definitions.push({ type: "function", function: { name: advertisedName, description: `[MCP: ${row.name}] ${tool.description || tool.name}`, parameters: tool.inputSchema || { type: "object", properties: {} } } });
  }
  return { definitions, bindings };
}

function bounded(value: string) { return value.length <= MAX_RESULT_CHARS ? value : `${value.slice(0, MAX_RESULT_CHARS)}\n[Result truncated]`; }

export async function executeMcpTool(userId: string, binding: McpToolBinding, args: unknown, signal?: AbortSignal): Promise<{ result: unknown; content?: ModelContentPart[] }> {
  assertEntitled(userId);
  const row = ownedRow(userId, binding.connectionId);
  if (!row.enabled) throw new AuthError("이 MCP 연결은 비활성화되어 있습니다.", 403);
  const client = await connectedClient(row, signal);
  try {
    const response = await client.callTool({ name: binding.toolName, arguments: args && typeof args === "object" ? args as Record<string, unknown> : {} }, { signal: requestSignal(signal), toolDefinition: binding.tool });
    const content: ModelContentPart[] = [];
    const summaries: unknown[] = [];
    for (const part of response.content || []) {
      if (part.type === "text") { const text = bounded(part.text); content.push({ type: "text", text }); summaries.push({ type: "text", text }); }
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
  } finally { await client.close().catch(() => undefined); }
}
