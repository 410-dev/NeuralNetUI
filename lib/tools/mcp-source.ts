import { describeMcpApproval } from "../mcp-approval";
import { executeMcpTool, listMcpConnections, mcpConnectionBindings, mcpEntitlement, toolPolicies, type McpToolBinding, type McpToolProgress } from "../mcp";
import { mcpToolAlias } from "../mcp-utils";
import { vmDefaultPolicy } from "../vm";
import { maskSecureInput, runSecureInputTool, SECURE_INPUT_SPECS } from "../secure-input";
import type { ElicitationAnswer, ElicitationRequest } from "../mcp-stateless";
import { DETAILS_TOOL, matchesToolName, summarize, toolsWithDetails, trimDescription, trimSchema, VM_CORE_TOOLS } from "../mcp-tool-definitions";
import type { McpConnection, McpToolPolicy } from "../types";
import { requestApproval, type ApprovalPolicy } from "./approval";
import { mcpManifest, toolRequirementsMet } from "./catalog";
import { resolveProviderState } from "./state";
import type { ToolProvider, ToolProviderSource, ToolSpec } from "./types";

/** The "user" tier: MCP servers an account registered for itself. One provider per connection. */

const APPROVAL: Record<McpToolPolicy, ApprovalPolicy> = { always_allow: "allow", always_ask: "always_ask", session_ask: "session_ask", blocked: "blocked" };

function connectionProvider(connection: McpConnection, order: number): ToolProvider {
  // Bindings are listed once per request, when the tools are offered, and reused for every call in the reply.
  const bindings = new Map<string, McpToolBinding>();
  // The virtual computer also carries the browser (Obscura on that computer, one session per chat, the account's
  // shared cookies): NeuralNetUI's browser tools, offered under the computer's name and permissions.
  const browser = new Map<string, { name: string; policy: McpToolPolicy }>();
  const namespace = `mcp_${connection.id.replace(/-/g, "").slice(0, 8)}_`;
  const label = `[MCP: ${connection.name}]`;
  const readOnly = (binding: McpToolBinding) => (binding.tool as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint === true;
  const schemaOf = (binding: McpToolBinding) => (binding.tool.inputSchema || { type: "object", properties: {} }) as Record<string, unknown>;
  const fullSpec = (binding: McpToolBinding): ToolSpec => ({ name: binding.advertisedName, sourceName: binding.toolName, readOnly: readOnly(binding), description: `${label} ${binding.tool.description || binding.toolName}`, inputSchema: schemaOf(binding) });
  // Every function this connection offers in this request, fully described, by the name the model calls: the server's
  // tools and, on a virtual computer, the browser and input-card tools.
  const definitions = new Map<string, ToolSpec>();
  const onDemand = () => connection.toolDefinitions === "on_demand";
  const alwaysFull = (spec: ToolSpec) => connection.kind === "vm" && VM_CORE_TOOLS.has(spec.sourceName ?? spec.name);
  // On demand: a function whose definition the model has not read in this conversation is not run.
  const unread = (name: string, history: Parameters<typeof toolsWithDetails>[0]) => {
    if (!onDemand()) return undefined;
    const spec = definitions.get(name);
    return spec && !alwaysFull(spec) && !toolsWithDetails(history, namespace).has(spec.sourceName ?? spec.name) ? spec : undefined;
  };
  // A held-back call or a details request puts the full definitions into the tool list (ToolExecution.define).
  const heldBack = (target: ToolSpec) => ({
    result: { executed: false, reason: "This tool's full description and argument schema are now in your tool list. Read them, then call the tool again with arguments that match the schema.", tools: [{ name: target.sourceName ?? target.name, call_as: target.name }] },
    define: [target],
  });
  return {
    manifest: mcpManifest(connection, order),
    async tools(ctx) {
      const listed = await mcpConnectionBindings(ctx.userId, connection.id, ctx.signal);
      bindings.clear(); browser.clear(); definitions.clear();
      for (const binding of listed) bindings.set(binding.advertisedName, binding);
      // Input cards need someone at the screen: offered in regular chats, not to the personal agent.
      const browserSpecs = connection.kind === "vm" ? [...await vmBrowserSpecs(ctx), ...(ctx.agent ? [] : SECURE_INPUT_SPECS)] : [];
      const policies = browserSpecs.length ? toolPolicies(connection.id) : new Map<string, McpToolPolicy>();
      const extra = browserSpecs.flatMap(spec => {
        const policy = policies.get(spec.name) || vmDefaultPolicy(spec.name);
        const name = mcpToolAlias(connection.id, spec.name);
        if (policy === "blocked" || bindings.has(name)) return [];
        browser.set(name, { name: spec.name, policy });
        return [{ ...spec, name, sourceName: spec.name, description: `[MCP: ${connection.name}] ${spec.description}` }];
      });
      for (const spec of [...listed.map(fullSpec), ...extra]) definitions.set(spec.name, spec);
      const all = [...definitions.values()];
      const mode = connection.toolDefinitions || (connection.kind === "vm" ? "on_demand" : "trimmed");
      if (mode === "on_demand" && all.length) {
        // Names and one line each; the full definitions come from the details function when the model needs them.
        // Tools already read in this conversation keep their full definitions, so compaction cannot take them away;
        // the virtual computer's everyday tools (VM_CORE_TOOLS) are always sent in full.
        const details = mcpToolAlias(connection.id, DETAILS_TOOL);
        const read = toolsWithDetails(ctx.history(), namespace);
        const prefix = `${label} `;
        return [{
          name: details, sourceName: DETAILS_TOOL, readOnly: true,
          description: `${label} Tools named ${namespace}… whose description is a single line and whose arguments are not listed belong to ${connection.name}. Before calling any of them, call this with their names: it adds their full descriptions and argument schemas to your tool list. A name may end in * for a whole group (e.g. "browser_*").`,
          inputSchema: { type: "object", additionalProperties: false, required: ["names"], properties: { names: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" }, description: "Tool names, as listed (with or without the mcp_… prefix); a trailing * matches every tool starting with the rest" } } },
        }, ...all.map(spec => alwaysFull(spec) || read.has(spec.sourceName ?? spec.name) ? spec : ({
          // Only the summary: the details function says how to get the rest, and a call without it is held back.
          // Repeating a label and a hint on dozens of entries cost as much as the summaries themselves.
          name: spec.name, sourceName: spec.sourceName, readOnly: spec.readOnly,
          description: summarize(spec.description.startsWith(prefix) ? spec.description.slice(prefix.length) : spec.description),
          inputSchema: { type: "object" },
        }))];
      }
      if (mode === "trimmed") return all.map(spec => ({ ...spec, description: trimDescription(spec.description), inputSchema: trimSchema(spec.inputSchema) }));
      return all;
    },
    async authorize(name, args, ctx) {
      if (name === mcpToolAlias(connection.id, DETAILS_TOOL) && onDemand()) return { approved: true };
      // On demand: a tool whose definition the model has not read here is not run; it gets the definition instead.
      const target = unread(name, ctx.history());
      if (target) return { approved: false, ...heldBack(target) };
      const web = browser.get(name);
      if (web) {
        const approval = await requestApproval(ctx, `${connection.id}:${web.name}`, APPROVAL[web.policy], () => ctx.updateEvent({ arguments: { ...args, _mcpApproval: {
          connectionName: connection.name, toolName: web.name, policy: web.policy, explanation: describeMcpApproval(web.name, "", args, ctx.locale),
        } } }));
        return approval.approved ? { approved: true } : { approved: false, result: { executed: false, rejected: true, connection: connection.name, tool: web.name } };
      }
      const binding = bindings.get(name);
      if (!binding) throw new Error(`MCP tool ${name} is not available.`);
      const approval = await requestApproval(ctx, `${binding.connectionId}:${binding.toolName}`, APPROVAL[binding.policy], () => ctx.updateEvent({ arguments: { ...args, _mcpApproval: {
        connectionName: binding.connectionName, toolName: binding.toolName, policy: binding.policy,
        explanation: describeMcpApproval(binding.toolName, binding.tool.description, args, ctx.locale),
      } } }));
      return approval.approved ? { approved: true } : { approved: false, result: { executed: false, rejected: true, connection: binding.connectionName, tool: binding.toolName } };
    },
    async execute(name, args, ctx) {
      if (name === mcpToolAlias(connection.id, DETAILS_TOOL)) {
        const wanted = Array.isArray(args.names) ? args.names.map(item => String(item).trim()).filter(Boolean) : [];
        const all = [...definitions.values()].filter(spec => spec.sourceName !== DETAILS_TOOL);
        const matches = (item: string) => all.filter(spec => matchesToolName(item, spec.sourceName ?? spec.name) || matchesToolName(item, spec.name));
        const found = [...new Set(wanted.flatMap(matches))];
        const missing = wanted.filter(item => !matches(item).length);
        return {
          result: { tools: found.map(spec => ({ name: spec.sourceName ?? spec.name, call_as: spec.name })), ...(found.length ? { note: "Their full descriptions and argument schemas are now in your tool list. Read them there and call the tools directly." } : {}), ...(missing.length ? { unknown: missing } : {}) },
          define: found,
        };
      }
      // The personal agent's automatic runs skip authorize(): the same check applies here.
      const target = unread(name, ctx.history());
      if (target) return heldBack(target);
      const web = browser.get(name);
      if (web) {
        if (SECURE_INPUT_SPECS.some(spec => spec.name === web.name)) return runSecureInputTool(web.name, args, ctx);
        const { browserProvider } = await import("./builtin");
        // Values the person typed into an input card are masked wherever a page shows them back.
        return maskSecureInput(ctx.conversationId, await browserProvider.execute(web.name, args, ctx));
      }
      const binding = bindings.get(name);
      if (!binding) throw new Error(`MCP tool ${name} is not available.`);
      // Long calls (downloads, saves to storage) show their progress on the tool event while they run.
      let shownAt = 0;
      const show = (update: McpToolProgress) => {
        const now = Date.now(); if (now - shownAt < 1000) return; shownAt = now;
        const ko = ctx.locale === "ko";
        const amount = update.total ? `${Math.min(100, Math.round(update.progress / update.total * 100))}%` : "";
        const text = update.stage === "storage"
          ? (ko ? `개인 저장소에 저장 중 ${amount}` : `Saving to private storage ${amount}`)
          : update.message || (ko ? `진행 중 ${amount}` : `Working ${amount}`);
        ctx.updateEvent({ result: { inProgress: true, stage: update.stage, message: text.trim(), ...(update.total ? { progress: update.progress, total: update.total } : {}) } });
      };
      // A server asking the person to approve access (form elicitation) gets a card in the chat; the personal agent
      // has nobody at the screen, so its requests are declined.
      const elicit = ctx.agent ? undefined : async (request: ElicitationRequest): Promise<ElicitationAnswer> => {
        ctx.updateEvent({ arguments: { ...args, _mcpElicitation: { connectionName: binding.connectionName, toolName: binding.toolName, ...request } } });
        const answer = await ctx.waitForUser() as ElicitationAnswer | undefined;
        ctx.updateEvent({ arguments: args });
        return answer && ["accept", "decline", "cancel"].includes(answer.action) ? answer : { action: "cancel" };
      };
      const output = executeMcpTool(ctx.userId, binding, args, ctx.signal, show, elicit);
      return connection.kind === "vm" ? output.then(value => maskSecureInput(ctx.conversationId, value)) : output;
    },
  };
}

export const mcpSource: ToolProviderSource = {
  id: "mcp",
  providers(ctx, state) {
    // The virtual computer does not depend on the plan's MCP allowance; other connections do.
    const entitled = mcpEntitlement(ctx.userId).enabled;
    // Only switched-on connections are built: each one costs a round trip to its server when offered.
    return listMcpConnections(ctx.userId)
      .filter(connection => entitled || connection.kind === "vm")
      .map((connection, index) => ({ connection, index }))
      .filter(({ connection }) => connection.enabled && resolveProviderState(state, mcpManifest(connection)).enabled)
      .map(({ connection, index }) => connectionProvider(connection, index));
  },
};

/** The browser functions, unless the plan manages the browser off for this account. */
async function vmBrowserSpecs(ctx: Parameters<ToolProvider["tools"]>[0]) {
  const { browserProvider, browserToolSpecs } = await import("./builtin");
  if (!toolRequirementsMet(browserProvider.manifest, { role: ctx.role, disabledTools: ctx.disabledTools, managedTools: ctx.managedTools })) return [];
  return browserToolSpecs(ctx).catch(() => []);
}
