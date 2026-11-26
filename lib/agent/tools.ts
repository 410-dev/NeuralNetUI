import type { ToolProvider, ToolProviderSource, ToolRequestContext, ToolSpec } from "../tools/types.ts";
import type { ToolProviderManifest } from "../tools/catalog.ts";
import { addAgentItem, addAgentSchedule, getAgentSchedule, listAgentItems, listAgentRuns, listAgentSchedules, removeAgentItem, removeAgentSchedule, updateAgentItem, updateAgentSchedule, type AgentItemKind } from "./store.ts";
import { AGENT_PROVIDER_ID } from "./policy.ts";

/** What the agent tools need from the agent runtime, passed in so this module does not import it. */
export type AgentToolHandlers = {
  minIntervalMinutes(userId: string): number;
  spawnSubagent(userId: string, input: { title: string; instructions: string }): Promise<{ id: string; status: string }>;
  notifyUser(userId: string, input: { message: string; runId?: string }): Promise<void>;
};

const manifest = (functions: string[]): ToolProviderManifest => ({
  id: AGENT_PROVIDER_ID, origin: "builtin", section: "agent", order: 0, icon: "list-checks", defaultEnabled: true,
  label: { en: "Agent workboard", ko: "에이전트 워크보드" },
  description: { en: "The personal agent's workboard, wakeups and subagents.", ko: "개인 에이전트의 워크보드, 예약 실행, 서브에이전트." },
  functions: functions.map(name => ({ name, label: { en: name, ko: name }, description: { en: name, ko: name } })),
});

const ITEM_KINDS = ["todo", "event", "memory"];
const TIME = { type: "string", description: "ISO 8601 date-time with offset, e.g. 2026-11-26T18:00:00+09:00" };

function specs(mode: "main" | "sub"): ToolSpec[] {
  const list: ToolSpec[] = [
    { name: "workboard_list", readOnly: true, description: "Read the workboard: to-dos, events (the person's schedule as the agent tracks it), memories (durable facts about the person and their preferences), scheduled wakeups and recurring work, and recent subagents. Read it before planning.", inputSchema: { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["todo", "event", "memory", "schedules", "subagents"], description: "Only this section; omit for all." } } } },
    { name: "workboard_add", description: "Add a to-do, an event or a memory. Save memories for facts that matter later (names, preferences, standing requests). Events need starts_at.", inputSchema: { type: "object", additionalProperties: false, required: ["kind", "title"], properties: { kind: { type: "string", enum: ITEM_KINDS }, title: { type: "string" }, body: { type: "string" }, status: { type: "string", description: "To-dos: open, doing or done." }, starts_at: TIME, ends_at: TIME } } },
    { name: "workboard_update", description: "Change a workboard item by id (from workboard_list). Omitted fields stay; null clears a time.", inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string" }, status: { type: "string" }, starts_at: { ...TIME, type: ["string", "null"] }, ends_at: { ...TIME, type: ["string", "null"] } } } },
    { name: "workboard_remove", description: "Delete a workboard item by id.", inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } } },
    { name: "notify_wakeup", description: "Schedule work for later. At the time, a dedicated subagent wakes up with the instructions and works on its own (it can notify the person). One-time: give at or in_minutes (\"remind me in 5 hours\" → in_minutes 300). Recurring: give every_minutes (checking an inbox, a web page, a channel or a topic), optionally with at for the first run. Write instructions that make sense to a subagent with no other context, including what to compare against and when to notify.", inputSchema: { type: "object", additionalProperties: false, required: ["title", "instructions"], properties: { title: { type: "string" }, instructions: { type: "string" }, at: TIME, in_minutes: { type: "number", minimum: 0 }, every_minutes: { type: "number", minimum: 1 } } } },
    { name: "update_wakeup", description: "Change or pause a scheduled wakeup by id (from workboard_list kind schedules).", inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" }, title: { type: "string" }, instructions: { type: "string" }, at: TIME, every_minutes: { type: "number", minimum: 1 }, enabled: { type: "boolean" } } } },
    { name: "cancel_wakeup", description: "Delete a scheduled wakeup or recurring work by id.", inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } } },
  ];
  if (mode === "main") list.push({ name: "spawn_subagent", description: "Hand a task to a subagent that works in its own session with the same tools, so this chat stays short. Use it for anything needing several tool calls, reading long material or waiting. The subagent's result comes back to you as a message; tell the person what matters then. Give complete, self-contained instructions.", inputSchema: { type: "object", additionalProperties: false, required: ["title", "instructions"], properties: { title: { type: "string", description: "A few words naming the task." }, instructions: { type: "string" } } } });
  else list.push({ name: "notify_user", description: "Send the person a message in the agent chat (and a push notification when they are away). Use it only for something worth their attention: a reminder they asked for, an important email, a conflict, a change they are tracking. Keep it short and specific.", inputSchema: { type: "object", additionalProperties: false, required: ["message"], properties: { message: { type: "string" } } } });
  return list;
}

const str = (value: unknown) => typeof value === "string" ? value : undefined;
const timeArg = (value: unknown) => value === null ? null : str(value);

/** The agent's own tools, offered only in agent sessions. */
export function agentToolSource(handlers: AgentToolHandlers): ToolProviderSource {
  return {
    id: "agent",
    providers(request: ToolRequestContext): ToolProvider[] {
      const agent = request.agent;
      if (!agent) return [];
      const offered = specs(agent.mode);
      const provider: ToolProvider = {
        manifest: manifest(offered.map(spec => spec.name)),
        tools: () => offered,
        async execute(name, args) {
          const userId = agent.userId;
          if (name === "workboard_list") {
            const kind = str(args.kind);
            const out: Record<string, unknown> = {};
            if (!kind || ITEM_KINDS.includes(kind)) for (const itemKind of kind ? [kind] : ITEM_KINDS) out[`${itemKind}s`] = listAgentItems(userId, itemKind as AgentItemKind).slice(0, 200);
            if (!kind || kind === "schedules") out.schedules = listAgentSchedules(userId).slice(0, 200);
            if (!kind || kind === "subagents") out.subagents = listAgentRuns(userId, { limit: 20 }).runs.map(({ id, kind: runKind, title, status, result, error, createdAt, finishedAt }) => ({ id, kind: runKind, title, status, result: result?.slice(0, 1500), error, createdAt, finishedAt }));
            return { result: out };
          }
          if (name === "workboard_add") return { result: addAgentItem(userId, { kind: str(args.kind) as AgentItemKind, title: str(args.title), body: str(args.body), status: str(args.status), startsAt: str(args.starts_at), endsAt: str(args.ends_at) }) };
          if (name === "workboard_update") return { result: updateAgentItem(userId, String(args.id || ""), { title: str(args.title), body: str(args.body), status: str(args.status), startsAt: timeArg(args.starts_at), endsAt: timeArg(args.ends_at) }) };
          if (name === "workboard_remove") return { result: { removed: removeAgentItem(userId, String(args.id || "")) } };
          if (name === "notify_wakeup") return { result: addAgentSchedule(userId, { title: str(args.title), instructions: str(args.instructions), at: str(args.at), inMinutes: typeof args.in_minutes === "number" ? args.in_minutes : undefined, everyMinutes: typeof args.every_minutes === "number" ? args.every_minutes : undefined }, handlers.minIntervalMinutes(userId)) };
          if (name === "update_wakeup") {
            const id = String(args.id || "");
            if (!getAgentSchedule(userId, id)) throw new Error("Schedule not found.");
            return { result: updateAgentSchedule(userId, id, { title: str(args.title), instructions: str(args.instructions), at: str(args.at), everyMinutes: typeof args.every_minutes === "number" ? args.every_minutes : undefined, enabled: typeof args.enabled === "boolean" ? args.enabled : undefined }, handlers.minIntervalMinutes(userId)) };
          }
          if (name === "cancel_wakeup") return { result: { removed: removeAgentSchedule(userId, String(args.id || "")) } };
          if (name === "spawn_subagent") return { result: await handlers.spawnSubagent(userId, { title: String(args.title || ""), instructions: String(args.instructions || "") }) };
          if (name === "notify_user") { await handlers.notifyUser(userId, { message: String(args.message || ""), runId: agent.runId }); return { result: { delivered: true } }; }
          throw new Error(`Unknown agent tool ${name}.`);
        },
      };
      return [provider];
    },
  };
}
