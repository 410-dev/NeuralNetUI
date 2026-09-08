import { abortable, delayWithSignal } from "./chat-progress.ts";
import type { ChatWaitPhase, ModelWaitPolicy } from "./types.ts";

export type ResidentModel = { id: string; identifiers: string[]; instanceIds: string[]; busy?: boolean };
export type ResidencyAdapter = {
  list(signal: AbortSignal): Promise<ResidentModel[]>;
  load(model: string, signal: AbortSignal): Promise<void>;
  unload(model: ResidentModel, signal: AbortSignal): Promise<void>;
};
export type UsageStore = { get(server: string, model: string): { count: number; lastUsed: number }; record(server: string, model: string): unknown };
export class ModelBusyError extends Error {}
type ServerState = { tail: Promise<void>; locking: number; pending: number; active: Map<string, number>; serialActive: number; listeners: Set<() => void> };
type Admission = { server: string; model: string; limit: number; policy: ModelWaitPolicy; adapter?: ResidencyAdapter; signal: AbortSignal; onPhase?: (phase: ChatWaitPhase) => void };

/** One admission/load lock per physical server; leases last for the entire chat job. */
export class ModelResidencyManager {
  private servers = new Map<string, ServerState>();
  private usage: UsageStore;
  constructor(usage: UsageStore) { this.usage = usage; }

  async acquire(options: Admission): Promise<() => void> {
    const { server, signal } = options; signal.throwIfAborted();
    let state = this.servers.get(server);
    if (!state) { state = { tail: Promise.resolve(), locking: 0, pending: 0, active: new Map(), serialActive: 0, listeners: new Set() }; this.servers.set(server, state); }
    const current = state; current.pending++;
    // The background admission retains its lock until any dispatched mutation settles,
    // even if the caller cancels, so another request cannot race a half-finished load.
    const admission = this.admit(options, current).finally(() => { current.pending--; this.cleanup(server, current); });
    return abortable(admission, signal);
  }

  private cleanup(server: string, state: ServerState) {
    if (!state.pending && !state.active.size && this.servers.get(server) === state) this.servers.delete(server);
  }

  private async admit(options: Admission, state: ServerState): Promise<() => void> {
    const { server, model, limit, policy, adapter, signal, onPhase = () => {} } = options;
    for (;;) {
      signal.throwIfAborted();
      let unlock!: () => void;
      const previous = state.tail;
      state.tail = new Promise(resolve => { unlock = resolve; });
      if (state.locking++ > 0) onPhase("waiting-session");
      await previous;
      let wait = false;
      try {
        signal.throwIfAborted();
        if ((policy === "serial" && state.active.size > 0) || state.serialActive > 0) wait = true;
        else {
          let resident: ResidentModel | undefined;
          if (adapter) {
            onPhase("preparing-response");
            let loaded = await adapter.list(AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
            resident = loaded.find(item => item.identifiers.includes(model));
            if (!resident) {
              while (limit > 0 && loaded.reduce((sum, item) => sum + item.instanceIds.length, 0) >= limit) {
                const candidates = loaded.filter(item => !item.busy && !item.identifiers.some(id => (state.active.get(id) || 0) > 0));
                const stats = (item: ResidentModel) => item.identifiers.reduce((total, id) => { const usage = this.usage.get(server, id); return { count: total.count + usage.count, lastUsed: Math.max(total.lastUsed, usage.lastUsed) }; }, { count: 0, lastUsed: 0 });
                candidates.sort((a, b) => stats(a).count - stats(b).count || stats(a).lastUsed - stats(b).lastUsed || a.id.localeCompare(b.id));
                const victim = candidates[0];
                if (!victim) { wait = true; break; }
                signal.throwIfAborted(); onPhase("freeing-space");
                try { await adapter.unload(victim, AbortSignal.timeout(300_000)); }
                catch (error) { if (error instanceof ModelBusyError) { wait = true; break; } throw error; }
                signal.throwIfAborted();
                const refreshed = await adapter.list(AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
                if (refreshed.some(item => item.instanceIds.some(id => victim.instanceIds.includes(id)))) throw new Error("The model server did not release the unloaded model.");
                loaded = refreshed;
              }
              if (!wait) {
                signal.throwIfAborted(); onPhase("loading-model");
                await adapter.load(model, AbortSignal.timeout(300_000));
                signal.throwIfAborted();
                const refreshed = await adapter.list(AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
                resident = refreshed.find(item => item.identifiers.includes(model));
                if (!resident) throw new Error("The model server did not confirm that the requested model is loaded.");
              }
            }
          }
          if (!wait) {
            signal.throwIfAborted();
            const key = resident?.id || model;
            this.usage.record(server, key);
            state.active.set(key, (state.active.get(key) || 0) + 1);
            if (policy === "serial") state.serialActive++;
            let released = false;
            const release = () => {
              if (released) return; released = true;
              signal.removeEventListener("abort", release);
              const count = (state.active.get(key) || 1) - 1;
              if (count) state.active.set(key, count); else state.active.delete(key);
              if (policy === "serial") state.serialActive--;
              for (const wake of [...state.listeners]) wake();
              this.cleanup(server, state);
            };
            signal.addEventListener("abort", release, { once: true });
            if (signal.aborted) { release(); signal.throwIfAborted(); }
            return release;
          }
        }
      } finally { state.locking--; unlock(); }
      onPhase("waiting-session");
      // A bounded recheck also notices server-side unloads and advertised busy changes.
      const controller = new AbortController();
      const wake = () => controller.abort();
      state.listeners.add(wake);
      try { await delayWithSignal(1_000, AbortSignal.any([signal, controller.signal])); }
      catch { signal.throwIfAborted(); }
      finally { state.listeners.delete(wake); }
    }
  }
}
