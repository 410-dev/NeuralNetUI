import type { UsagePlan } from "./types.ts";

export type PlanSaveState = "pending" | "saving" | "saved" | "error";
export type PlanSaveEvent = { id: string; state: PlanSaveState; plan?: UsagePlan; error?: string };

function fingerprint(plan: UsagePlan) {
  const { name, servedModelIds, modelWeights, tokenLimits, storageQuotaBytes, trashQuotaBytes, mcpEnabled, maxMcpConnections, artifactHtmlEnabled } = plan;
  return JSON.stringify({ name: name.trim(), servedModelIds, modelWeights, tokenLimits, storageQuotaBytes, trashQuotaBytes, mcpEnabled, maxMcpConnections, artifactHtmlEnabled });
}

/** Coalesces edits while serializing full-plan PUTs for each plan. */
export class PlanAutosave {
  private readonly latest = new Map<string, UsagePlan>();
  private readonly saved = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly blocked = new Set<string>();
  private readonly write: (draft: UsagePlan) => Promise<UsagePlan>;
  private readonly onChange: (event: PlanSaveEvent) => void;
  private readonly debounceMs: number;

  constructor(write: (draft: UsagePlan) => Promise<UsagePlan>, onChange: (event: PlanSaveEvent) => void, debounceMs = 600) {
    this.write = write; this.onChange = onChange; this.debounceMs = debounceMs;
  }

  seed(plans: UsagePlan[]) {
    for (const plan of plans) {
      this.saved.set(plan.id, fingerprint(plan));
      if (!this.latest.has(plan.id)) this.latest.set(plan.id, structuredClone(plan));
    }
  }

  draftFor(plan: UsagePlan): UsagePlan { return structuredClone(this.latest.get(plan.id) || plan); }

  edit(plan: UsagePlan) {
    if (!plan.id || this.blocked.has(plan.id)) return;
    this.latest.set(plan.id, structuredClone(plan));
    this.clearTimer(plan.id);
    if (fingerprint(plan) === this.saved.get(plan.id) && !this.tails.has(plan.id)) return;
    this.onChange({ id: plan.id, state: "pending" });
    if (plan.name.trim()) this.timers.set(plan.id, setTimeout(() => { void this.flush(plan.id); }, this.debounceMs));
  }

  flush(id: string): Promise<void> {
    this.clearTimer(id);
    const prior = this.tails.get(id) || Promise.resolve();
    const next = prior.then(async () => {
      const draft = this.latest.get(id);
      if (this.blocked.has(id) || !draft || !draft.name.trim() || fingerprint(draft) === this.saved.get(id)) return;
      const submitted = structuredClone(draft);
      this.onChange({ id, state: "saving" });
      try {
        const result = await this.write(submitted);
        this.saved.set(id, fingerprint(result));
        if (this.blocked.has(id)) return;
        this.onChange({ id, state: fingerprint(this.latest.get(id)!) === this.saved.get(id) ? "saved" : "pending", plan: result });
      } catch (error) {
        if (!this.blocked.has(id)) this.onChange({ id, state: "error", error: error instanceof Error ? error.message : String(error) });
      }
    });
    this.tails.set(id, next);
    void next.finally(() => { if (this.tails.get(id) === next) this.tails.delete(id); });
    return next;
  }

  async cancel(id: string) {
    this.blocked.add(id); this.clearTimer(id);
    await this.tails.get(id);
  }

  resume(id: string) { this.blocked.delete(id); const draft = this.latest.get(id); if (draft) this.edit(draft); }
  forget(id: string) { this.clearTimer(id); this.blocked.add(id); this.latest.delete(id); this.saved.delete(id); }
  flushAll(): Promise<void[]> { return Promise.all([...this.latest.keys()].map(id => this.flush(id))); }

  private clearTimer(id: string) { const timer = this.timers.get(id); if (timer) clearTimeout(timer); this.timers.delete(id); }
}
