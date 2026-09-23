import assert from "node:assert/strict";
import test from "node:test";
import type { UsagePlan } from "./types.ts";
import { PlanAutosave } from "./plan-autosave.ts";

const plan = (name: string): UsagePlan => ({ id: "plan-1", name, servedModelIds: [], modelWeights: {}, tokenLimits: [], storageQuotaBytes: 1024 ** 3, trashQuotaBytes: 2 * 1024 ** 3, mcpEnabled: false, maxMcpConnections: 0 });

test("rapid plan edits save serially and keep the newest value", async () => {
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const writes: string[] = []; const states: string[] = [];
  const autosave = new PlanAutosave(async draft => { writes.push(draft.name); if (draft.name === "Second") await firstGate; return draft; }, event => states.push(event.state), 1000);
  autosave.seed([plan("First")]);
  autosave.edit(plan("Second"));
  const first = autosave.flush("plan-1");
  await Promise.resolve();
  autosave.edit(plan("Third"));
  const second = autosave.flush("plan-1");
  assert.deepEqual(writes, ["Second"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(writes, ["Second", "Third"]);
  assert.equal(autosave.draftFor(plan("First")).name, "Third");
  assert.equal(states.at(-1), "saved");
});

test("failed autosave retains the draft and can be retried", async () => {
  let attempts = 0; const states: string[] = [];
  const autosave = new PlanAutosave(async draft => { if (++attempts === 1) throw Error("Offline"); return draft; }, event => states.push(event.state), 1000);
  autosave.seed([plan("First")]);
  autosave.edit(plan("Edited"));
  await autosave.flush("plan-1");
  assert.equal(states.at(-1), "error");
  assert.equal(autosave.draftFor(plan("First")).name, "Edited");
  await autosave.flush("plan-1");
  assert.equal(attempts, 2);
  assert.equal(states.at(-1), "saved");
});

test("cancel waits for the active save and prevents queued writes before deletion", async () => {
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const writes: string[] = [];
  const autosave = new PlanAutosave(async draft => { writes.push(draft.name); await firstGate; return draft; }, () => {}, 1000);
  autosave.seed([plan("First")]);
  autosave.edit(plan("Second"));
  const first = autosave.flush("plan-1");
  await Promise.resolve();
  autosave.edit(plan("Third"));
  const second = autosave.flush("plan-1");
  const cancelled = autosave.cancel("plan-1");
  releaseFirst();
  await Promise.all([first, second, cancelled]);
  assert.deepEqual(writes, ["Second"]);
});
