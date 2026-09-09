import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ChatBranch, Conversation, ConversationSummary, StoredAttachment, StoredMessage } from "./types";
import { completeStorageMigration, dataDir, db, storageMigrationCompleted } from "./database";
import { deleteUploadFiles, ensureLegacyUploadsMigrated } from "./uploads";
import { discardChatJobs, hasChatDisposal } from "./chat-disposal";

const messageSchema = z.object({
  id: z.string().min(1),
  revisionGroupId: z.string().min(1).optional(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  reasoning: z.string().optional(),
  reasoningDurationSeconds: z.number().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  completionDurationSeconds: z.number().nonnegative().optional(),
  contextTokens: z.number().int().nonnegative().optional(),
  timeToFirstTokenSeconds: z.number().nonnegative().optional(),
  steps: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("reasoning"), text: z.string(), seconds: z.number().nonnegative().optional() }),
    z.object({ kind: z.literal("content"), text: z.string() }),
    z.object({ kind: z.literal("tools"), ids: z.array(z.string().min(1)) }),
    z.object({ kind: z.literal("compaction"), seconds: z.number().nonnegative().optional(), summary: z.string().optional(), reasoning: z.string().optional() }),
  ])).optional(),
  toolEvents: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    status: z.enum(["calling", "waiting", "completed", "error"]),
    reasoningOffset: z.number().int().nonnegative().optional(),
    arguments: z.unknown().optional(),
    result: z.unknown().optional(),
    startedAt: z.string(),
    completedAt: z.string().optional(),
  })).optional(),
  attachments: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    name: z.string(),
    mimeType: z.string().refine((value) => value.startsWith("image/") || value === "application/pdf", "Unsupported attachment type"),
    size: z.number().nonnegative(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    url: z.string(),
    thumbnailUrl: z.string().optional(),
  })).optional(),
  createdAt: z.string(),
});

const branchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parentBranchId: z.string().optional(),
  forkedFromMessageId: z.string().optional(),
  messages: z.array(messageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const conversationSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().min(1),
  modelId: z.string().min(1),
  reasoningPresetId: z.string().optional(),
  activeBranchId: z.string().min(1),
  temporary: z.boolean().optional(),
  branches: z.array(branchSchema).min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
}).superRefine((conversation, context) => {
  const branchIds = new Set(conversation.branches.map((branch) => branch.id));
  if (!branchIds.has(conversation.activeBranchId)) {
    context.addIssue({ code: "custom", path: ["activeBranchId"], message: "Active branch does not belong to this conversation." });
  }
  for (const [index, branch] of conversation.branches.entries()) {
    if (branch.parentBranchId && !branchIds.has(branch.parentBranchId)) {
      context.addIssue({ code: "custom", path: ["branches", index, "parentBranchId"], message: "Parent branch does not belong to this conversation." });
    }
  }
});

const conversationsDir = path.join(dataDir, "conversations");
const legacyMigrationName = "legacy-conversations-v1";
let legacyMigration: Promise<void> | undefined;

const insertConversation = db.prepare(`
  INSERT INTO conversations(id, title, model_id, reasoning_preset_id, active_branch_id, created_at, updated_at, user_id, temporary)
  VALUES (@id, @title, @modelId, @reasoningPresetId, @activeBranchId, @createdAt, @updatedAt, @userId, @temporary)
`);
const insertBranch = db.prepare(`
  INSERT INTO branches(id, conversation_id, name, parent_branch_id, forked_from_message_id, position, created_at, updated_at)
  VALUES (@id, @conversationId, @name, @parentBranchId, @forkedFromMessageId, @position, @createdAt, @updatedAt)
`);
const insertMessage = db.prepare(`
  INSERT OR IGNORE INTO messages(
    id, conversation_id, revision_group_id, role, content, reasoning, reasoning_duration_seconds,
    input_tokens, output_tokens, reasoning_tokens, total_tokens, completion_duration_seconds, time_to_first_token_seconds, tool_events, steps, created_at
  ) VALUES (
    @id, @conversationId, @revisionGroupId, @role, @content, @reasoning, @reasoningDurationSeconds,
    @inputTokens, @outputTokens, @reasoningTokens, @totalTokens, @completionDurationSeconds, @timeToFirstTokenSeconds, @toolEvents, @steps, @createdAt
  )
`);
const insertBranchMessage = db.prepare("INSERT INTO branch_messages(branch_id, message_id, position) VALUES (?, ?, ?)");
const insertAttachment = db.prepare("INSERT OR IGNORE INTO message_attachments(message_id, upload_id, position) VALUES (?, ?, ?)");

function storeConversation(record: Conversation, userId: string, guard?: () => boolean) {
  db.transaction(() => {
    const owner = db.prepare("SELECT user_id, title, title_managed, temporary FROM conversations WHERE id = ?").get(record.id) as { user_id: string | null; title: string; title_managed: number; temporary: number } | undefined;
    if (guard && (!guard() || !owner)) throw new Error("Conversation was deleted or its task was replaced.");
    if (owner && owner.user_id !== userId) throw new Error("Conversation not found.");
    const summaries = db.prepare("SELECT cs.* FROM context_summaries cs JOIN branches b ON b.id = cs.branch_id WHERE b.conversation_id = ?").all(record.id) as Array<{branch_id: string; fingerprint: string; covered_count: number; summary: string}>;
    if (owner?.title_managed) record.title = owner.title;
    db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(record.id, userId);
    const temporary = owner ? owner.temporary : Number(record.temporary === true);
    insertConversation.run({ ...record, userId, reasoningPresetId: record.reasoningPresetId ?? null, temporary });
    record.temporary = temporary === 1;
    for (const [branchPosition, branch] of record.branches.entries()) {
      insertBranch.run({
        ...branch,
        conversationId: record.id,
        parentBranchId: branch.parentBranchId ?? null,
        forkedFromMessageId: branch.forkedFromMessageId ?? null,
        position: branchPosition,
      });
    }
    if (owner?.title_managed) db.prepare("UPDATE conversations SET title_managed = 1 WHERE id = ?").run(record.id);
    for (const summary of summaries) if (record.branches.some(b => b.id === summary.branch_id)) db.prepare("INSERT INTO context_summaries VALUES (@branch_id, @fingerprint, @covered_count, @summary)").run(summary);
    for (const branch of record.branches) {
      for (const [messagePosition, message] of branch.messages.entries()) {
        insertMessage.run({
          ...message,
          conversationId: record.id,
          revisionGroupId: message.revisionGroupId ?? null,
          reasoning: message.reasoning ?? null,
          reasoningDurationSeconds: message.reasoningDurationSeconds ?? null,
          inputTokens: message.inputTokens ?? null,
          outputTokens: message.outputTokens ?? null,
          reasoningTokens: message.reasoningTokens ?? null,
          totalTokens: message.totalTokens ?? null,
          completionDurationSeconds: message.completionDurationSeconds ?? null,
          timeToFirstTokenSeconds: message.timeToFirstTokenSeconds ?? null,
          toolEvents: message.toolEvents?.length ? JSON.stringify(message.toolEvents) : null,
          steps: message.steps?.length ? JSON.stringify(message.steps) : null,
        });
        db.prepare("UPDATE messages SET context_tokens = ? WHERE id = ? AND conversation_id = ?").run(message.contextTokens ?? null, message.id, record.id);
        insertBranchMessage.run(branch.id, message.id, messagePosition);
        for (const [attachmentPosition, attachment] of (message.attachments || []).entries()) {
          insertAttachment.run(message.id, attachment.id, attachmentPosition);
        }
      }
    }
  })();
}

async function ensureLegacyConversationsMigrated(userId: string) {
  if (storageMigrationCompleted(legacyMigrationName)) return;
  legacyMigration ??= (async () => {
    await ensureLegacyUploadsMigrated();
    const legacyOwner = db.prepare("SELECT id FROM users WHERE role = 'superadmin' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
    await fs.mkdir(conversationsDir, { recursive: true });
    const files = (await fs.readdir(conversationsDir)).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      try {
        const record = conversationSchema.parse(JSON.parse(await fs.readFile(path.join(conversationsDir, file), "utf8")));
        storeConversation(record, legacyOwner?.id || userId);
      } catch (error) {
        console.error(`Skipping invalid legacy conversation: ${file}`, error);
      }
    }
    completeStorageMigration(legacyMigrationName);
  })().finally(() => { legacyMigration = undefined; });
  await legacyMigration;
}

/**
 * Removes the caller's temporary chats. A temporary chat only exists so the streaming pipeline has
 * somewhere to write while it runs; leaving one, or abandoning the tab, discards it.
 */
export async function discardTemporaryConversations(userId: string, keepId?: string) {
  const rows = db.prepare("SELECT id FROM conversations WHERE user_id = ? AND temporary = 1").all(userId) as Array<{ id: string }>;
  // A chat still streaming in another tab is not abandoned, so leave it for the next sweep.
  const doomed = rows.filter((row) => row.id !== keepId && !hasChatDisposal(row.id, userId));
  for (const { id } of doomed) await deleteConversation(id, userId).catch(() => undefined);
  return doomed.length;
}

/** Turns a temporary chat into an ordinary saved one. */
export function promoteConversation(id: string, userId: string) {
  return db.prepare("UPDATE conversations SET temporary = 0 WHERE id = ? AND user_id = ? AND temporary = 1").run(id, userId).changes > 0;
}

export function isTemporaryConversation(id: string, userId: string) {
  const row = db.prepare("SELECT temporary FROM conversations WHERE id = ? AND user_id = ?").get(id, userId) as { temporary: number } | undefined;
  return row?.temporary === 1;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  await ensureLegacyConversationsMigrated(userId);
  return db.prepare(`
    SELECT c.id, c.title, c.active_branch_id AS activeBranchId, COUNT(b.id) AS branchCount, c.updated_at AS updatedAt
    FROM conversations c
    LEFT JOIN branches b ON b.conversation_id = c.id
    WHERE c.user_id = ? AND c.temporary = 0
    GROUP BY c.id
    ORDER BY c.updated_at DESC
  `).all(userId) as ConversationSummary[];
}

type ConversationRow = {
  id: string;
  title: string;
  model_id: string;
  reasoning_preset_id: string | null;
  active_branch_id: string;
  created_at: string;
  updated_at: string;
  temporary: number;
};
type BranchRow = {
  id: string;
  name: string;
  parent_branch_id: string | null;
  forked_from_message_id: string | null;
  created_at: string;
  updated_at: string;
};
type MessageRow = {
  branch_id: string;
  id: string;
  revision_group_id: string | null;
  role: "user" | "assistant";
  content: string;
  reasoning: string | null;
  reasoning_duration_seconds: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  completion_duration_seconds: number | null;
  time_to_first_token_seconds: number | null;
  context_tokens: number | null;
  tool_events: string | null;
  steps: string | null;
  created_at: string;
};
type AttachmentRow = {
  message_id: string;
  id: string;
  name: string;
  mime_type: string;
  size: number;
  width: number | null;
  height: number | null;
};

export async function readConversation(id: string, userId: string): Promise<Conversation | null> {
  await ensureLegacyConversationsMigrated(userId);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid conversation id");
  const conversation = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(id, userId) as ConversationRow | undefined;
  if (!conversation) return null;

  const branchRows = db.prepare("SELECT id, name, parent_branch_id, forked_from_message_id, created_at, updated_at FROM branches WHERE conversation_id = ? ORDER BY position").all(id) as BranchRow[];
  const messageRows = db.prepare(`
    SELECT bm.branch_id, m.id, m.revision_group_id, m.role, m.content, m.reasoning, m.reasoning_duration_seconds,
           m.input_tokens, m.output_tokens, m.reasoning_tokens, m.total_tokens, m.completion_duration_seconds, m.time_to_first_token_seconds, m.context_tokens, m.tool_events, m.steps, m.created_at
    FROM branch_messages bm
    JOIN messages m ON m.id = bm.message_id
    JOIN branches b ON b.id = bm.branch_id
    WHERE b.conversation_id = ?
    ORDER BY b.position, bm.position
  `).all(id) as MessageRow[];
  const attachmentRows = db.prepare(`
    SELECT ma.message_id, u.id, u.name, u.mime_type, u.size, u.width, u.height
    FROM message_attachments ma
    JOIN uploads u ON u.id = ma.upload_id
    JOIN messages m ON m.id = ma.message_id
    WHERE m.conversation_id = ?
    ORDER BY ma.message_id, ma.position
  `).all(id) as AttachmentRow[];

  const attachments = new Map<string, StoredAttachment[]>();
  for (const row of attachmentRows) {
    const values = attachments.get(row.message_id) || [];
    values.push({
      id: row.id, name: row.name, mimeType: row.mime_type, size: row.size,
      width: row.width ?? undefined, height: row.height ?? undefined,
      url: `/api/uploads/${row.id}`, ...(row.mime_type.startsWith("image/") ? { thumbnailUrl: `/api/uploads/${row.id}?variant=thumbnail` } : {}),
    });
    attachments.set(row.message_id, values);
  }
  const messagesByBranch = new Map<string, StoredMessage[]>();
  for (const row of messageRows) {
    const values = messagesByBranch.get(row.branch_id) || [];
    values.push({
      id: row.id,
      revisionGroupId: row.revision_group_id ?? undefined,
      role: row.role,
      content: row.content,
      reasoning: row.reasoning ?? undefined,
      reasoningDurationSeconds: row.reasoning_duration_seconds ?? undefined,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      reasoningTokens: row.reasoning_tokens ?? undefined,
      totalTokens: row.total_tokens ?? undefined,
      completionDurationSeconds: row.completion_duration_seconds ?? undefined,
      contextTokens: row.context_tokens ?? undefined,
      timeToFirstTokenSeconds: row.time_to_first_token_seconds ?? undefined,
      toolEvents: row.tool_events ? JSON.parse(row.tool_events) : undefined,
      steps: row.steps ? JSON.parse(row.steps) : undefined,
      attachments: attachments.get(row.id),
      createdAt: row.created_at,
    });
    messagesByBranch.set(row.branch_id, values);
  }
  const branches: ChatBranch[] = branchRows.map((row) => ({
    id: row.id,
    name: row.name,
    parentBranchId: row.parent_branch_id ?? undefined,
    forkedFromMessageId: row.forked_from_message_id ?? undefined,
    messages: messagesByBranch.get(row.id) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  return conversationSchema.parse({
    id: conversation.id,
    title: conversation.title,
    modelId: conversation.model_id,
    reasoningPresetId: conversation.reasoning_preset_id ?? undefined,
    activeBranchId: conversation.active_branch_id,
    temporary: conversation.temporary === 1,
    branches,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
  });
}

export async function writeConversation(input: unknown, userId: string, guard?: () => boolean): Promise<Conversation> {
  await Promise.all([ensureLegacyConversationsMigrated(userId), ensureLegacyUploadsMigrated()]);
  const parsed = conversationSchema.parse(input);
  const attachmentIds = parsed.branches.flatMap((branch) => branch.messages.flatMap((message) => message.attachments?.map((attachment) => attachment.id) || []));
  for (const uploadId of new Set(attachmentIds)) {
    if (!db.prepare("SELECT 1 FROM uploads WHERE id = ? AND user_id = ?").get(uploadId, userId)) throw new Error("Conversation contains an inaccessible attachment.");
  }
  storeConversation(parsed, userId, guard);
  return parsed;
}

export async function deleteConversation(id: string, userId: string) {
  await ensureLegacyConversationsMigrated(userId);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid conversation id");
  const orphanedIds = db.transaction(() => {
    const candidates = db.prepare(`
      SELECT DISTINCT ma.upload_id AS id
      FROM message_attachments ma
      JOIN messages m ON m.id = ma.message_id
      WHERE m.conversation_id = ? AND m.conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)
    `).all(id, userId) as Array<{ id: string }>;
    const result = db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId);
    if (!result.changes) throw Object.assign(new Error("Conversation not found."), { code: "ENOENT" });
    const orphaned = candidates.filter(({ id: uploadId }) => {
      const row = db.prepare("SELECT 1 FROM message_attachments WHERE upload_id = ? LIMIT 1").get(uploadId);
      return !row;
    });
    for (const { id: uploadId } of orphaned) db.prepare("DELETE FROM uploads WHERE id = ?").run(uploadId);
    return orphaned.map(({ id: uploadId }) => uploadId);
  })();
  discardChatJobs(userId, id);
  await Promise.all(orphanedIds.map((uploadId) => deleteUploadFiles(uploadId)));
}

export async function deleteAllConversations(userId: string) {
  const conversations = await listConversations(userId);
  for (const conversation of conversations) await deleteConversation(conversation.id, userId);
  await discardTemporaryConversations(userId);
  return conversations.length;
}

export function renameConversation(id: string, userId: string, title: string, automatic = false) {
  const clean = z.string().trim().min(1).max(200).parse(title);
  return db.prepare(`UPDATE conversations SET title = ?, title_managed = 1 WHERE id = ? AND user_id = ? ${automatic ? "AND title_managed = 0" : ""}`).run(clean, id, userId).changes > 0;
}

export async function searchConversations(userId: string, query: string) {
  await ensureLegacyConversationsMigrated(userId);
  const needle = query.trim().slice(0, 200).toLocaleLowerCase();
  if (!needle) return [];
  const rows = db.prepare(`SELECT c.id, c.title, c.active_branch_id AS activeBranchId, b.id AS branchId, b.name AS branchName, m.content
    FROM conversations c JOIN branches b ON b.conversation_id = c.id JOIN branch_messages bm ON bm.branch_id = b.id JOIN messages m ON m.id = bm.message_id
    WHERE c.user_id = ? AND c.temporary = 0 ORDER BY c.updated_at DESC, b.position, bm.position`).all(userId) as Array<{id:string;title:string;activeBranchId:string;branchId:string;branchName:string;content:string}>;
  const seen = new Set<string>();
  return rows.filter(row => { const key = row.id + ":" + row.branchId; if (seen.has(key) || !(row.content.toLocaleLowerCase().includes(needle) || row.title.toLocaleLowerCase().includes(needle))) return false; seen.add(key); return true; }).slice(0, 100).map(row => { const at = row.content.toLocaleLowerCase().indexOf(needle); return {...row, content: row.content.slice(Math.max(0, at - 60), Math.max(0, at - 60) + 240), otherBranch: row.branchId !== row.activeBranchId}; });
}
