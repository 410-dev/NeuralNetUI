import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ChatBranch, Conversation, ConversationSummary, StoredAttachment, StoredMessage } from "./types";
import { completeStorageMigration, dataDir, db, storageMigrationCompleted } from "./database";
import { deleteUploadFiles, ensureLegacyUploadsMigrated } from "./uploads";

const messageSchema = z.object({
  id: z.string().min(1),
  revisionGroupId: z.string().min(1).optional(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  reasoning: z.string().optional(),
  reasoningDurationSeconds: z.number().nonnegative().optional(),
  attachments: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    name: z.string(),
    mimeType: z.string().startsWith("image/"),
    size: z.number().nonnegative(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    url: z.string(),
    thumbnailUrl: z.string(),
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
  INSERT INTO conversations(id, title, model_id, reasoning_preset_id, active_branch_id, created_at, updated_at)
  VALUES (@id, @title, @modelId, @reasoningPresetId, @activeBranchId, @createdAt, @updatedAt)
`);
const insertBranch = db.prepare(`
  INSERT INTO branches(id, conversation_id, name, parent_branch_id, forked_from_message_id, position, created_at, updated_at)
  VALUES (@id, @conversationId, @name, @parentBranchId, @forkedFromMessageId, @position, @createdAt, @updatedAt)
`);
const insertMessage = db.prepare(`
  INSERT OR IGNORE INTO messages(id, conversation_id, revision_group_id, role, content, reasoning, reasoning_duration_seconds, created_at)
  VALUES (@id, @conversationId, @revisionGroupId, @role, @content, @reasoning, @reasoningDurationSeconds, @createdAt)
`);
const insertBranchMessage = db.prepare("INSERT INTO branch_messages(branch_id, message_id, position) VALUES (?, ?, ?)");
const insertAttachment = db.prepare("INSERT OR IGNORE INTO message_attachments(message_id, upload_id, position) VALUES (?, ?, ?)");

function storeConversation(record: Conversation) {
  db.transaction(() => {
    db.prepare("DELETE FROM conversations WHERE id = ?").run(record.id);
    insertConversation.run({ ...record, reasoningPresetId: record.reasoningPresetId ?? null });
    for (const [branchPosition, branch] of record.branches.entries()) {
      insertBranch.run({
        ...branch,
        conversationId: record.id,
        parentBranchId: branch.parentBranchId ?? null,
        forkedFromMessageId: branch.forkedFromMessageId ?? null,
        position: branchPosition,
      });
    }
    for (const branch of record.branches) {
      for (const [messagePosition, message] of branch.messages.entries()) {
        insertMessage.run({
          ...message,
          conversationId: record.id,
          revisionGroupId: message.revisionGroupId ?? null,
          reasoning: message.reasoning ?? null,
          reasoningDurationSeconds: message.reasoningDurationSeconds ?? null,
        });
        insertBranchMessage.run(branch.id, message.id, messagePosition);
        for (const [attachmentPosition, attachment] of (message.attachments || []).entries()) {
          insertAttachment.run(message.id, attachment.id, attachmentPosition);
        }
      }
    }
  })();
}

async function ensureLegacyConversationsMigrated() {
  if (storageMigrationCompleted(legacyMigrationName)) return;
  legacyMigration ??= (async () => {
    await ensureLegacyUploadsMigrated();
    await fs.mkdir(conversationsDir, { recursive: true });
    const files = (await fs.readdir(conversationsDir)).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      try {
        const record = conversationSchema.parse(JSON.parse(await fs.readFile(path.join(conversationsDir, file), "utf8")));
        storeConversation(record);
      } catch (error) {
        console.error(`Skipping invalid legacy conversation: ${file}`, error);
      }
    }
    completeStorageMigration(legacyMigrationName);
  })().finally(() => { legacyMigration = undefined; });
  await legacyMigration;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  await ensureLegacyConversationsMigrated();
  return db.prepare(`
    SELECT c.id, c.title, c.active_branch_id AS activeBranchId, COUNT(b.id) AS branchCount, c.updated_at AS updatedAt
    FROM conversations c
    LEFT JOIN branches b ON b.conversation_id = c.id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
  `).all() as ConversationSummary[];
}

type ConversationRow = {
  id: string;
  title: string;
  model_id: string;
  reasoning_preset_id: string | null;
  active_branch_id: string;
  created_at: string;
  updated_at: string;
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

export async function readConversation(id: string): Promise<Conversation | null> {
  await ensureLegacyConversationsMigrated();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid conversation id");
  const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | undefined;
  if (!conversation) return null;

  const branchRows = db.prepare("SELECT id, name, parent_branch_id, forked_from_message_id, created_at, updated_at FROM branches WHERE conversation_id = ? ORDER BY position").all(id) as BranchRow[];
  const messageRows = db.prepare(`
    SELECT bm.branch_id, m.id, m.revision_group_id, m.role, m.content, m.reasoning, m.reasoning_duration_seconds, m.created_at
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
      url: `/api/uploads/${row.id}`, thumbnailUrl: `/api/uploads/${row.id}?variant=thumbnail`,
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
    branches,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
  });
}

export async function writeConversation(input: unknown): Promise<Conversation> {
  await Promise.all([ensureLegacyConversationsMigrated(), ensureLegacyUploadsMigrated()]);
  const parsed = conversationSchema.parse(input);
  storeConversation(parsed);
  return parsed;
}

export async function deleteConversation(id: string) {
  await ensureLegacyConversationsMigrated();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid conversation id");
  const orphanedIds = db.transaction(() => {
    const candidates = db.prepare(`
      SELECT DISTINCT ma.upload_id AS id
      FROM message_attachments ma
      JOIN messages m ON m.id = ma.message_id
      WHERE m.conversation_id = ?
    `).all(id) as Array<{ id: string }>;
    const result = db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    if (!result.changes) throw Object.assign(new Error("Conversation not found."), { code: "ENOENT" });
    const orphaned = candidates.filter(({ id: uploadId }) => {
      const row = db.prepare("SELECT 1 FROM message_attachments WHERE upload_id = ? LIMIT 1").get(uploadId);
      return !row;
    });
    for (const { id: uploadId } of orphaned) db.prepare("DELETE FROM uploads WHERE id = ?").run(uploadId);
    return orphaned.map(({ id: uploadId }) => uploadId);
  })();
  await Promise.all(orphanedIds.map((uploadId) => deleteUploadFiles(uploadId)));
}
