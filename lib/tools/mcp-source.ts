import { describeMcpApproval } from "../mcp-approval";
import { executeMcpTool, listMcpConnections, mcpConnectionBindings, mcpEntitlement, toolPolicies, type McpToolBinding, type McpToolProgress } from "../mcp";
import { mcpToolAlias } from "../mcp-utils";
import { vmDefaultPolicy } from "../vm";
import { maskSecureInput, runSecureInputTool, SECURE_INPUT_SPECS } from "../secure-input";
import { DETAILS_TOOL, summarize, toolsWithDetails, trimDescription, trimSchema } from "../mcp-tool-definitions";
import type { McpConnection, McpToolPolicy } from "../types";
import { requestApproval, type ApprovalPolicy } from "./approval";
import { mcpManifest, toolRequirementsMet } from "./catalog";
import { resolveProviderState } from "./state";
import type { ToolProvider, ToolProviderSource } from "./types";

/** The "user" tier: MCP servers an account registered for itself. One provider per connection. */

const APPROVAL: Record<McpToolPolicy, ApprovalPolicy> = { always_allow: "allow", always_ask: "always_ask", session_ask: "session_ask", blocked: "blocked" };

function connectionProvider(connection: McpConnection, order: number): ToolProvider {
  // Bindings are listed once per request, when the tools are offered, and reused for every call in the reply.
  const bindings = new Map<string, McpToolBinding>();
  // The virtual computer also carries the browser (Obscura on that computer, one session per chat, the account's
  // shared cookies): NeuralNetUI's browser tools, offered under the computer's name and permissions.
  const browser = new Map<string, { name: string; policy: McpToolPolicy }>();
  const namespace = `mcp_${connection.id.replace(/-/g, "").slice(0, 8)}_`;
  return {
    manifest: mcpManifest(connection, order),
    async tools(ctx) {
      const listed = await mcpConnectionBindings(ctx.userId, connection.id, ctx.signal);
      bindings.clear(); browser.clear();
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
      const mode = connection.kind === "vm" ? "full" : connection.toolDefinitions || "trimmed";
      const label = `[MCP: ${connection.name}]`;
      const readOnly = (binding: McpToolBinding) => (binding.tool as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint === true;
      const schemaOf = (binding: McpToolBinding) => (binding.tool.inputSchema || { type: "object", properties: {} }) as Record<string, unknown>;
      if (mode === "on_demand" && listed.length) {
        // Names and one line each; the full definitions come from the details function when the model needs them.
        const details = mcpToolAlias(connection.id, DETAILS_TOOL);
        return [{
          name: details, sourceName: DETAILS_TOOL, readOnly: true,
          description: `${label} Returns the full description and argument schema of tools of this connection. Call it with the tools you are about to use before calling them; their listed descriptions are one-line summaries and their arguments are not shown until then.`,
          inputSchema: { type: "object", additionalProperties: false, required: ["names"], properties: { names: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" }, description: "Tool names, as listed (with or without the mcp_… prefix)" } } },
        }, ...listed.map(binding => ({
          name: binding.advertisedName, sourceName: binding.toolName, readOnly: readOnly(binding),
          description: `${label} ${summarize(binding.tool.description || binding.toolName)} (Arguments: call ${details} first.)`,
          inputSchema: { type: "object", additionalProperties: true, properties: {} },
        })), ...extra];
      }
      return [...listed.map(binding => ({
        name: binding.advertisedName, sourceName: binding.toolName, readOnly: readOnly(binding),
        description: `${label} ${mode === "trimmed" ? trimDescription(binding.tool.description || binding.toolName) : binding.tool.description || binding.toolName}`,
        inputSchema: mode === "trimmed" ? trimSchema(schemaOf(binding)) : schemaOf(binding),
      })), ...extra];
    },
    async authorize(name, args, ctx) {
      if (name === mcpToolAlias(connection.id, DETAILS_TOOL) && connection.toolDefinitions === "on_demand") return { approved: true };
      // On demand: a tool whose definition the model has not read here is not run; it gets the definition instead.
      if (connection.toolDefinitions === "on_demand" && connection.kind !== "vm") {
        const target = bindings.get(name);
        if (target && !toolsWithDetails(ctx.history(), namespace).has(target.toolName)) {
          return { approved: false, result: { executed: false, reason: "Read the tool's definition first. It is below; call the tool again with arguments that match its schema.", tools: [definitionOf(target)] } };
        }
      }
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
        const wanted = Array.isArray(args.names) ? args.names.map(item => String(item)) : [];
        const all = [...bindings.values()];
        const found = wanted.flatMap(item => all.filter(binding => binding.toolName === item || binding.advertisedName === item)).filter((binding, index, list) => list.indexOf(binding) === index);
        const missing = wanted.filter(item => !all.some(binding => binding.toolName === item || binding.advertisedName === item));
        return { result: { tools: found.map(definitionOf), ...(missing.length ? { unknown: missing } : {}) } };
      }
      // The personal agent's automatic runs skip authorize(): the same check applies here.
      if (connection.toolDefinitions === "on_demand" && connection.kind !== "vm") {
        const target = bindings.get(name);
        if (target && !toolsWithDetails(ctx.history(), namespace).has(target.toolName)) return { result: { executed: false, reason: "Read the tool's definition first. It is below; call the tool again with arguments that match its schema.", tools: [definitionOf(target)] } };
      }
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
      const output = executeMcpTool(ctx.userId, binding, args, ctx.signal, show);
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

/** A tool's full definition as the server describes it, under the name the model calls it by. */
function definitionOf(binding: McpToolBinding) {
  return { name: binding.toolName, call_as: binding.advertisedName, description: binding.tool.description || "", input_schema: binding.tool.inputSchema || { type: "object", properties: {} } };
}
