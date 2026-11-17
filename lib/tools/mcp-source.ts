import { describeMcpApproval } from "../mcp-approval";
import { executeMcpTool, listMcpConnections, mcpConnectionBindings, mcpEntitlement, type McpToolBinding } from "../mcp";
import type { McpConnection, McpToolPolicy } from "../types";
import { requestApproval, type ApprovalPolicy } from "./approval";
import { mcpManifest } from "./catalog";
import { resolveProviderState } from "./state";
import type { ToolProvider, ToolProviderSource } from "./types";

/** The "user" tier: MCP servers an account registered for itself. One provider per connection. */

const APPROVAL: Record<McpToolPolicy, ApprovalPolicy> = { always_allow: "allow", always_ask: "always_ask", session_ask: "session_ask", blocked: "blocked" };

function connectionProvider(connection: McpConnection, order: number): ToolProvider {
  // Bindings are listed once per request, when the tools are offered, and reused for every call in the reply.
  const bindings = new Map<string, McpToolBinding>();
  return {
    manifest: mcpManifest(connection, order),
    async tools(ctx) {
      const listed = await mcpConnectionBindings(ctx.userId, connection.id, ctx.signal);
      bindings.clear();
      for (const binding of listed) bindings.set(binding.advertisedName, binding);
      return listed.map(binding => ({
        name: binding.advertisedName, sourceName: binding.toolName,
        description: `[MCP: ${binding.connectionName}] ${binding.tool.description || binding.toolName}`,
        inputSchema: (binding.tool.inputSchema || { type: "object", properties: {} }) as Record<string, unknown>,
      }));
    },
    async authorize(name, args, ctx) {
      const binding = bindings.get(name);
      if (!binding) throw new Error(`MCP tool ${name} is not available.`);
      const approval = await requestApproval(ctx, `${binding.connectionId}:${binding.toolName}`, APPROVAL[binding.policy], () => ctx.updateEvent({ arguments: { ...args, _mcpApproval: {
        connectionName: binding.connectionName, toolName: binding.toolName, policy: binding.policy,
        explanation: describeMcpApproval(binding.toolName, binding.tool.description, args, ctx.locale),
      } } }));
      return approval.approved ? { approved: true } : { approved: false, result: { executed: false, rejected: true, connection: binding.connectionName, tool: binding.toolName } };
    },
    execute(name, args, ctx) {
      const binding = bindings.get(name);
      if (!binding) throw new Error(`MCP tool ${name} is not available.`);
      return executeMcpTool(ctx.userId, binding, args, ctx.signal);
    },
  };
}

export const mcpSource: ToolProviderSource = {
  id: "mcp",
  providers(ctx, state) {
    if (!mcpEntitlement(ctx.userId).enabled) return [];
    // Only switched-on connections are built: each one costs a round trip to its server when offered.
    return listMcpConnections(ctx.userId)
      .map((connection, index) => ({ connection, index }))
      .filter(({ connection }) => connection.enabled && resolveProviderState(state, mcpManifest(connection)).enabled)
      .map(({ connection, index }) => connectionProvider(connection, index));
  },
};
