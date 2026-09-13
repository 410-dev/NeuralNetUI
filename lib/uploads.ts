import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertUploadSignature, extractPdf, isSupportedUploadMimeType, pdfModelContent, type ModelContentPart, type PdfExtraction } from "./document-processing.ts";
import type { StorageFile, StoredAttachment, ToolSettings } from "./types.ts";
import { completeStorageMigration, dataDir, db, storageMigrationCompleted } from "./database.ts";

const uploadsDir = path.join(dataDir, "uploads");
const legacyMigrationName = "legacy-uploads-v1";
let legacyMigration: Promise<void> | undefined;

function assertId(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid upload id");
}

const pathsFor = (id: string) => {
  assertId(id);
  return {
    original: path.join(uploadsDir, `${id}.original`),
    thumbnail: path.join(uploadsDir, `${id}.thumbnail`),
    extraction: path.join(uploadsDir, `${id}.pdf.json`),
    metadata: path.join(uploadsDir, `${id}.json`),
  };
};

type UploadRow = {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  width: number | null;
  height: number | null;
  created_at?: string;
  retained?: number;
  reference_count?: number;
};

function toAttachment(row: UploadRow): StoredAttachment {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    url: `/api/uploads/${row.id}`,
    ...(row.mime_type.startsWith("image/") ? { thumbnailUrl: `/api/uploads/${row.id}?variant=thumbnail` } : {}),
  };
}

export async function ensureLegacyUploadsMigrated() {
  if (storageMigrationCompleted(legacyMigrationName)) return;
  legacyMigration ??= (async () => {
    await fs.mkdir(uploadsDir, { recursive: true });
    const files = (await fs.readdir(uploadsDir)).filter((file) => file.endsWith(".json"));
    const legacyOwner = db.prepare("SELECT id FROM users WHERE role = 'superadmin' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO uploads(id, name, mime_type, size, width, height, created_at, user_id)
      VALUES (@id, @name, @mimeType, @size, @width, @height, @createdAt, @userId)
    `);
    const migrate = db.transaction((records: Array<StoredAttachment & { createdAt: string }>) => {
      for (const record of records) insert.run({ ...record, userId: legacyOwner?.id ?? null });
      completeStorageMigration(legacyMigrationName);
    });
    const records: Array<StoredAttachment & { createdAt: string }> = [];
    for (const file of files) {
      try {
        const value = JSON.parse(await fs.readFile(path.join(uploadsDir, file), "utf8")) as StoredAttachment;
        assertId(value.id);
        if (!value.mimeType?.startsWith("image/") || !Number.isFinite(value.size)) continue;
        records.push({ ...value, createdAt: new Date().toISOString() });
      } catch (error) {
        console.error(`Skipping invalid legacy upload metadata: ${file}`, error);
      }
    }
    migrate(records);
  })().finally(() => { legacyMigration = undefined; });
  await legacyMigration;
}

function insertWithinQuota(row: { id:string; name:string; mimeType:string; size:number; width?:number; height?:number; userId:string; retained:boolean }) {
  db.transaction(() => {
    const quota = db.prepare("SELECT storage_quota_bytes AS quota FROM users WHERE id = ?").get(row.userId) as { quota: number } | undefined;
    if (!quota) throw new Error("Storage owner not found.");
    const used = (db.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM uploads WHERE user_id = ?").get(row.userId) as { bytes: number }).bytes;
    if (used + row.size > quota.quota) throw new Error(`Storage quota exceeded (${used + row.size} / ${quota.quota} bytes).`);
    db.prepare(`INSERT INTO uploads(id, name, mime_type, size, width, height, created_at, user_id, retained) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.name, row.mimeType, row.size, row.width ?? null, row.height ?? null, new Date().toISOString(), row.userId, Number(row.retained));
  })();
}

export async function saveUpload(file: File, thumbnail: File | undefined, userId: string, settings: ToolSettings, dimensions?: { width?: number; height?: number }, retained = false): Promise<StoredAttachment> {
  await ensureLegacyUploadsMigrated();
  const pdf = file.type.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const mimeType = pdf ? "application/pdf" : file.type.toLowerCase();
  if (!isSupportedUploadMimeType(mimeType)) throw new Error("Only safe raster images and PDF files are supported.");
  const sizeLimitMb = pdf ? settings.pdfSizeLimitMb : settings.imageUploadLimitMb;
  if (file.size > sizeLimitMb * 1024 * 1024) throw new Error(`${file.name} exceeds the configured ${sizeLimitMb} MB limit.`);
  if (!pdf && (!thumbnail || !isSupportedUploadMimeType(thumbnail.type) || !thumbnail.type.startsWith("image/") || thumbnail.size > settings.imageUploadLimitMb * 1024 * 1024)) throw new Error("Invalid thumbnail.");
  const id = randomUUID();
  const paths = pathsFor(id);
  const metadata: StoredAttachment = {
    id, name: file.name.slice(0, 240), mimeType, size: file.size,
    width: dimensions?.width, height: dimensions?.height,
    url: `/api/uploads/${id}`, ...(pdf ? {} : { thumbnailUrl: `/api/uploads/${id}?variant=thumbnail` }),
  };
  await fs.mkdir(uploadsDir, { recursive: true });
  const originalTemp = `${paths.original}.${randomUUID()}.tmp`;
  const thumbnailTemp = `${paths.thumbnail}.${randomUUID()}.tmp`;
  const extractionTemp = `${paths.extraction}.${randomUUID()}.tmp`;
  try {
    const original = Buffer.from(await file.arrayBuffer());
    assertUploadSignature(original, mimeType);
    await fs.writeFile(originalTemp, original, { mode: 0o600 });
    if (pdf) {
      const extraction = await extractPdf(originalTemp, settings);
      await fs.writeFile(extractionTemp, JSON.stringify(extraction), { encoding: "utf8", mode: 0o600 });
    } else if (thumbnail) {
      const thumbnailData = Buffer.from(await thumbnail.arrayBuffer()); assertUploadSignature(thumbnailData, thumbnail.type);
      await fs.writeFile(thumbnailTemp, thumbnailData, { mode: 0o600 });
    }
    await fs.rename(originalTemp, paths.original);
    if (pdf) await fs.rename(extractionTemp, paths.extraction);
    else await fs.rename(thumbnailTemp, paths.thumbnail);
    insertWithinQuota({ ...metadata, userId, retained });
    return metadata;
  } catch (error) {
    await Promise.all([paths.original, paths.thumbnail, paths.extraction, originalTemp, thumbnailTemp, extractionTemp].map((target) => fs.unlink(target).catch(() => undefined)));
    throw error;
  }
}

/** Save tool-generated imagery as an owned retained file; native LM Studio can read this path directly. */
export async function saveGeneratedImage(buffer: Buffer, userId: string, name = `host-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`, dimensions?: { width?: number; height?: number }, mimeType = "image/png") {
  assertUploadSignature(buffer, mimeType);
  const id = randomUUID(); const paths = pathsFor(id);
  const metadata: StoredAttachment = { id, name: name.slice(0, 240), mimeType, size: buffer.length, width: dimensions?.width, height: dimensions?.height, url: `/api/uploads/${id}`, thumbnailUrl: `/api/uploads/${id}?variant=thumbnail` };
  await fs.mkdir(uploadsDir, { recursive: true });
  const temporary = `${paths.original}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, buffer, { mode: 0o600 });
    await fs.rename(temporary, paths.original);
    insertWithinQuota({ ...metadata, userId, retained: true });
    return { metadata, path: paths.original };
  } catch (error) {
    await Promise.all([temporary, paths.original].map(target=>fs.unlink(target).catch(()=>undefined)));
    throw error;
  }
}

export async function storageSummary(userId: string) {
  await ensureLegacyUploadsMigrated();
  const account = db.prepare("SELECT storage_quota_bytes AS quotaBytes FROM users WHERE id = ?").get(userId) as { quotaBytes: number } | undefined;
  if (!account) throw Object.assign(new Error("Storage owner not found."), { code: "ENOENT" });
  const files = db.prepare(`
    SELECT u.id, u.name, u.mime_type, u.size, u.width, u.height, u.created_at, u.retained,
      (SELECT COUNT(*) FROM message_attachments ma WHERE ma.upload_id = u.id) AS reference_count
    FROM uploads u WHERE u.user_id = ? ORDER BY u.created_at DESC
  `).all(userId) as UploadRow[];
  const mapped: StorageFile[] = files.map(row=>({ ...toAttachment(row), createdAt: row.created_at!, referenceCount: row.reference_count || 0, retained: row.retained === 1 }));
  return { quotaBytes: account.quotaBytes, usedBytes: mapped.reduce((sum,file)=>sum+file.size,0), files: mapped };
}

export async function readUpload(id: string, userId: string) {
  await ensureLegacyUploadsMigrated();
  assertId(id);
  const row = db.prepare("SELECT id, name, mime_type, size, width, height FROM uploads WHERE id = ? AND user_id = ?").get(id, userId) as UploadRow | undefined;
  if (!row) throw Object.assign(new Error("Attachment not found."), { code: "ENOENT" });
  return { metadata: toAttachment(row), paths: pathsFor(id) };
}

export async function readManagedUpload(id: string, userId: string) { return readUpload(id, userId); }

export async function readUploadDataUrl(id: string, userId: string) {
  const { metadata, paths } = await readUpload(id, userId);
  if (!metadata.mimeType.startsWith("image/")) throw new Error("This attachment is not an image.");
  const data = await fs.readFile(/* turbopackIgnore: true */ paths.original);
  return `data:${metadata.mimeType};base64,${data.toString("base64")}`;
}

export async function readUploadModelContent(id: string, userId: string, settings: ToolSettings): Promise<ModelContentPart[]> {
  const { metadata, paths } = await readUpload(id, userId);
  if (metadata.mimeType.startsWith("image/")) return [{ type: "image_file", file_path: paths.original, mime_type: metadata.mimeType }];
  if (metadata.mimeType === "application/pdf") {
    let cached: PdfExtraction | undefined;
    try {
      const candidate = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ paths.extraction, "utf8")) as PdfExtraction;
      if (candidate.pageLimit === settings.pdfPageLimit && candidate.characterLimit === settings.pdfTextCharacterLimit) cached = candidate;
    } catch { /* Rebuild missing or stale extraction cache. */ }
    if (!cached) {
      cached = await extractPdf(paths.original, settings);
      const cacheTemp = `${paths.extraction}.${randomUUID()}.tmp`;
      try { await fs.writeFile(cacheTemp, JSON.stringify(cached), { encoding: "utf8", mode: 0o600 }); await fs.rename(cacheTemp, paths.extraction); }
      finally { await fs.unlink(cacheTemp).catch(() => undefined); }
    }
    const processed = await pdfModelContent(paths.original, metadata.name, settings, cached);
    return processed.content;
  }
  throw new Error("Unsupported attachment type.");
}

export async function deleteUpload(id: string, userId: string) {
  await ensureLegacyUploadsMigrated();
  assertId(id);
  const owned = db.prepare("SELECT 1 FROM uploads WHERE id = ? AND user_id = ?").get(id, userId);
  if (!owned) throw Object.assign(new Error("Attachment not found."), { code: "ENOENT" });
  const references = db.prepare("SELECT COUNT(*) AS count FROM message_attachments WHERE upload_id = ?").get(id) as { count: number };
  if (references.count) throw new Error("This file is attached to a saved conversation.");
  db.prepare("DELETE FROM uploads WHERE id = ? AND user_id = ?").run(id, userId);
  await deleteUploadFiles(id);
}

export async function deleteUploadFiles(id: string) {
  const paths = pathsFor(id);
  await Promise.all(Object.values(paths).map((target) => fs.unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  })));
}

export async function cleanupOrphanedUploads(settings: ToolSettings) {
  await ensureLegacyUploadsMigrated();
  const cutoff = new Date(Date.now() - settings.orphanUploadTtlHours * 60 * 60 * 1_000).toISOString();
  const ids = db.transaction(() => {
    const rows = db.prepare(`
      SELECT u.id FROM uploads u
      WHERE u.created_at < ? AND u.retained = 0 AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.upload_id = u.id)
    `).all(cutoff) as Array<{ id: string }>;
    for (const row of rows) db.prepare("DELETE FROM uploads WHERE id = ?").run(row.id);
    return rows.map((row) => row.id);
  })();
  await Promise.all(ids.map((id) => deleteUploadFiles(id)));
  return ids.length;
}
