import { toolRequirementsMet } from "./catalog.ts";
import { resolveProviderState, type ToolState } from "./state.ts";
import type { ToolCallContext, ToolContext, ToolExecution, ToolProvider, ToolProviderSource, ToolRequestContext, ToolSpec } from "./types.ts";

const FUNCTION_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

type Binding = { provider: ToolProvider; ctx: ToolContext; spec: ToolSpec };

export interface ResolvedTools {
  /** OpenAI-compatible `tools` entries, in provider order. */
  definitions: Array<Record<string, unknown>>;
  /** Function names that were offered but dropped, with the reason, for the server log. */
  rejected: Array<{ provider: string; name: string; reason: string }>;
  has(name: string): boolean;
  releasesModel(name: string): boolean;
  execute(name: string, args: Record<string, unknown>, call: Omit<ToolCallContext, keyof ToolContext>): Promise<ToolExecution>;
}

/** The single conversion from a provider's MCP-shaped spec to what the model receives. */
export function toModelTool(spec: ToolSpec): Record<string, unknown> {
  return { type: "function", function: { name: spec.name, description: spec.description, parameters: spec.inputSchema || { type: "object", properties: {} } } };
}

/** Reads an OpenAI `tools` entry back into a spec, for executors that already build that format. */
export function specFromModelTool(definition: Record<string, unknown>): ToolSpec {
  const fn = (definition.function || {}) as { name?: string; description?: string; parameters?: Record<string, unknown> };
  return { name: String(fn.name || ""), description: String(fn.description || ""), inputSchema: fn.parameters || { type: "object", properties: {} } };
}

function environmentOf(ctx: ToolRequestContext) {
  return { role: ctx.role, disabledTools: ctx.disabledTools, managedTools: ctx.managedTools };
}

function declared(provider: ToolProvider, spec: ToolSpec) {
  const { functions, functionPrefix } = provider.manifest;
  if (functionPrefix) return spec.name.startsWith(functionPrefix);
  return functions.some(fn => fn.name === spec.name);
}

/**
 * Collects every enabled, available provider for one request and fixes the function name → provider map for the
 * whole reply. A name the model invents, or one belonging to a switched-off provider, is not in the map and
 * therefore cannot run. Function name collisions keep the first provider and drop the later one.
 */
export async function resolveTools(request: ToolRequestContext, state: ToolState, sources: ToolProviderSource[]): Promise<ResolvedTools> {
  const providers = (await Promise.all(sources.map(source => source.providers(request, state)))).flat();
  const environment = environmentOf(request);
  const offered = await Promise.all(providers.map(async provider => {
    const settings = resolveProviderState(state, provider.manifest);
    if (!settings.enabled || !toolRequirementsMet(provider.manifest, environment)) return undefined;
    const ctx: ToolContext = { ...request, options: settings.options, ...(settings.functions ? { functions: settings.functions } : {}) };
    if (provider.available && !await provider.available(ctx)) return undefined;
    const specs = await provider.tools(ctx);
    const allowed = settings.functions ? new Set(settings.functions) : undefined;
    return { provider, ctx, specs: allowed ? specs.filter(spec => allowed.has(spec.sourceName ?? spec.name)) : specs };
  }));
  const bindings = new Map<string, Binding>();
  const rejected: ResolvedTools["rejected"] = [];
  for (const entry of offered) {
    if (!entry) continue;
    for (const spec of entry.specs) {
      const reject = (reason: string) => rejected.push({ provider: entry.provider.manifest.id, name: spec.name, reason });
      if (!FUNCTION_NAME.test(spec.name)) { reject("invalid name"); continue; }
      if (!declared(entry.provider, spec)) { reject("not declared by the provider manifest"); continue; }
      if (bindings.has(spec.name)) { reject(`already provided by ${bindings.get(spec.name)!.provider.manifest.id}`); continue; }
      bindings.set(spec.name, { provider: entry.provider, ctx: entry.ctx, spec });
    }
  }
  return {
    definitions: [...bindings.values()].map(binding => toModelTool(binding.spec)),
    rejected,
    has: name => bindings.has(name),
    releasesModel: name => bindings.get(name)?.provider.releasesModelWhileRunning === true,
    async execute(name, args, call) {
      const binding = bindings.get(name);
      if (!binding) throw new Error(`Tool ${name} is not enabled.`);
      const ctx: ToolCallContext = { ...binding.ctx, ...call };
      const gated = binding.ctx.gate ? await binding.ctx.gate({ providerId: binding.provider.manifest.id, name, sourceName: binding.spec.sourceName ?? name, readOnlyHint: binding.spec.readOnly, args, ctx }) : "provider";
      if (typeof gated === "object") return { result: gated.result };
      if (gated === "run") return binding.provider.execute(name, args, ctx);
      const authorization = await binding.provider.authorize?.(name, args, ctx);
      if (authorization && !authorization.approved) return { result: authorization.result };
      return binding.provider.execute(name, args, ctx);
    },
  };
}
