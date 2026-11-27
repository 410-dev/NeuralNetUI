/**
 * The stateless MCP transport (protocol 2026-07-28) that Google's Workspace MCP servers speak: no initialize
 * session; every POST carries MCP-Protocol-Version, Mcp-Method and (for tools/call) Mcp-Name headers, and the
 * protocol version, client info and capabilities in params._meta. Declaring form elicitation lets the server ask the
 * person for approval instead of leaving data out (Gmail answers DATA_PROTECTION_POLICY omissions otherwise): it
 * returns resultType "input_required" with inputRequests and a requestState, and the same call is sent again with
 * the person's answers in params.inputResponses.
 */
export const STATELESS_PROTOCOL_VERSION = "2026-07-28";

export type ElicitationField = { key: string; type: "enum" | "string" | "number" | "boolean"; title?: string; description?: string; options?: Array<{ value: string; label: string }>; required: boolean };
export type ElicitationRequest = { key: string; message: string; fields: ElicitationField[] };
export type ElicitationAnswer = { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };

/** Servers spoken to this way: Google's Workspace MCP servers. */
export function usesStatelessProtocol(url: string) {
  try { return /\.googleapis\.com$/.test(new URL(url).hostname); } catch { return false; }
}

function meta() {
  return { "io.modelcontextprotocol/protocolVersion": STATELESS_PROTOCOL_VERSION, "io.modelcontextprotocol/clientInfo": { name: "NeuralNetUI", version: "3.0.0" }, "io.modelcontextprotocol/clientCapabilities": { elicitation: { form: {} } } };
}

/** The JSON-RPC message of a response sent as JSON or as an event stream (the last message with a result or error). */
export function parseRpcResponse(text: string): { result?: Record<string, unknown>; error?: { code?: number; message?: string } } {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const messages = trimmed.split(/\r?\n\r?\n/).map(block => block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n")).filter(Boolean).map(data => { try { return JSON.parse(data); } catch { return undefined; } }).filter(Boolean);
  const final = messages.reverse().find(message => message && ("result" in message || "error" in message));
  if (!final) throw new Error("The MCP server sent no result.");
  return final;
}

export async function statelessRequest(url: string, token: string | undefined, method: string, params: Record<string, unknown>, options: { fetch?: typeof fetch; signal?: AbortSignal; name?: string } = {}) {
  const request = options.fetch ?? fetch;
  const response = await request(url, {
    method: "POST", signal: options.signal,
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": STATELESS_PROTOCOL_VERSION, "Mcp-Method": method, ...(options.name ? { "Mcp-Name": options.name } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: { ...params, _meta: meta() } }),
  });
  const text = await response.text();
  let message: ReturnType<typeof parseRpcResponse>;
  try { message = parseRpcResponse(text); }
  catch { throw new Error(`The MCP server answered ${response.status}: ${text.slice(0, 200)}`); }
  if (message.error) throw new Error(`MCP error ${message.error.code ?? ""}: ${message.error.message || "unknown"}`.trim());
  if (!response.ok) throw new Error(`The MCP server answered ${response.status}.`);
  return message.result || {};
}

/** The questions of an input_required result, as fields the input card can show. */
export function elicitationRequests(result: Record<string, unknown>): ElicitationRequest[] {
  const requests = result.inputRequests && typeof result.inputRequests === "object" ? result.inputRequests as Record<string, { method?: string; params?: { message?: string; requestedSchema?: { properties?: Record<string, Record<string, unknown>>; required?: string[] } } }> : {};
  return Object.entries(requests).map(([key, request]) => {
    const schema = request.params?.requestedSchema || {};
    const required = new Set(schema.required || []);
    const fields = Object.entries(schema.properties || {}).map(([field, property]): ElicitationField => {
      const enumValues = Array.isArray(property.enum) ? property.enum.map(String) : Array.isArray(property.oneOf) ? (property.oneOf as Array<{ const?: unknown }>).map(item => String(item.const)) : undefined;
      const names = Array.isArray(property.enumNames) ? property.enumNames.map(String) : Array.isArray(property.oneOf) ? (property.oneOf as Array<{ title?: unknown; const?: unknown }>).map(item => String(item.title ?? item.const)) : undefined;
      const type = enumValues ? "enum" : property.type === "boolean" ? "boolean" : property.type === "number" || property.type === "integer" ? "number" : "string";
      return { key: field, type, title: typeof property.title === "string" ? property.title : undefined, description: typeof property.description === "string" ? property.description : undefined, required: required.has(field),
        ...(enumValues ? { options: enumValues.map((value, index) => ({ value, label: names?.[index] || value })) } : {}) };
    });
    return { key, message: request.params?.message || "", fields };
  });
}

/**
 * tools/call with elicitation: an input_required result is put to the person through `elicit` and the call is sent
 * again with the answers (a few rounds at most). Without `elicit` (nobody at the screen) the requests are declined.
 */
export async function statelessToolCall(url: string, token: () => Promise<string | undefined>, name: string, args: Record<string, unknown>, options: { fetch?: typeof fetch; signal?: AbortSignal; elicit?: (request: ElicitationRequest) => Promise<ElicitationAnswer> } = {}) {
  let extra: Record<string, unknown> = {};
  for (let round = 0; round < 4; round++) {
    const result = await statelessRequest(url, await token(), "tools/call", { name, arguments: args, ...extra }, { fetch: options.fetch, signal: options.signal, name });
    if (result.resultType !== "input_required") return result as { content?: Array<Record<string, unknown>>; structuredContent?: unknown; isError?: boolean };
    const responses: Record<string, ElicitationAnswer> = {};
    for (const request of elicitationRequests(result)) responses[request.key] = options.elicit ? await options.elicit(request) : { action: "decline" };
    extra = { requestState: result.requestState, inputResponses: responses };
  }
  throw new Error("The MCP server kept asking for input.");
}

export async function statelessListTools(url: string, token: string | undefined, options: { fetch?: typeof fetch; signal?: AbortSignal } = {}) {
  const tools: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await statelessRequest(url, token, "tools/list", cursor ? { cursor } : {}, options);
    tools.push(...(Array.isArray(result.tools) ? result.tools as Array<Record<string, unknown>> : []));
    cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
    if (!cursor) break;
  }
  return tools;
}
