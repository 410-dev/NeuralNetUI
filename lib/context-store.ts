import { db } from "./database";
import { EMPTY_CONTEXT_STATE, normalizeContextState, type ContextState } from "./context-state";

/**
 * Where a branch's context state lives. A branch without its own row uses its parent's (a fork shares the history
 * before the fork point, and ids the fork does not contain are ignored when applied). A branch compacted before
 * context states existed has its summary converted from the old context_summaries table.
 */

type BranchRow = { parent_branch_id: string | null };

function legacySummary(branchId: string): ContextState | undefined {
  const legacy = db.prepare("SELECT covered_count, summary FROM context_summaries WHERE branch_id = ?").get(branchId) as { covered_count: number; summary: string } | undefined;
  if (!legacy?.covered_count || !legacy.summary.trim()) return undefined;
  // The old summary counted the messages sent to the model, which skipped empty ones.
  const sent = db.prepare(`SELECT m.id FROM branch_messages bm JOIN messages m ON m.id = bm.message_id
    WHERE bm.branch_id = ? AND (m.content <> '' OR (m.tool_events IS NOT NULL AND m.tool_events <> '[]') OR EXISTS (SELECT 1 FROM message_attachments a WHERE a.message_id = m.id))
    ORDER BY bm.position`).all(branchId) as Array<{ id: string }>;
  const through = sent[legacy.covered_count - 1]?.id;
  return through ? { summary: { text: legacy.summary, throughMessageId: through }, overrides: {} } : undefined;
}

export function loadContextState(branchId: string): ContextState {
  let current: string | null = branchId;
  for (let depth = 0; current && depth < 50; depth += 1) {
    const row = db.prepare("SELECT state FROM context_states WHERE branch_id = ?").get(current) as { state: string } | undefined;
    if (row) { try { return normalizeContextState(JSON.parse(row.state)); } catch { return { overrides: {} }; } }
    const legacy = legacySummary(current);
    if (legacy) return legacy;
    current = (db.prepare("SELECT parent_branch_id FROM branches WHERE id = ?").get(current) as BranchRow | undefined)?.parent_branch_id ?? null;
  }
  return { ...EMPTY_CONTEXT_STATE, overrides: {} };
}

/** Stores a branch's own state, even an empty one, so it stops following its parent. */
export function saveContextState(branchId: string, state: ContextState) {
  db.prepare("INSERT INTO context_states(branch_id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(branch_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at")
    .run(branchId, JSON.stringify(normalizeContextState(state)), new Date().toISOString());
}

/** Merges a change into the branch's current state and stores it. */
export function updateContextState(branchId: string, change: (state: ContextState) => ContextState) {
  const next = normalizeContextState(change(loadContextState(branchId)));
  saveContextState(branchId, next);
  return next;
}

export function branchOwnedBy(branchId: string, conversationId: string, userId: string) {
  return Boolean(db.prepare("SELECT 1 FROM branches b JOIN conversations c ON c.id = b.conversation_id WHERE b.id = ? AND c.id = ? AND c.user_id = ? AND c.deleted_at IS NULL").get(branchId, conversationId, userId));
}
