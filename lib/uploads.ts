import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertUploadSignature, extractPdf, isSupportedUploadMimeType, pdfModelContent, type ModelContentPart, type PdfExtraction } from "./document-processing";
import type { StoredAttachment, ToolSettings } from "./types";
import { completeStorageMigration, dataDir, db, storageMigrationCompleted } from "./database";

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

export async function saveUpload(file: File, thumbnail: File | undefined, userId: string, settings: ToolSettings, dimensions?: { width?: number; height?: number }): Promise<StoredAttachment> {
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
    db.prepare(`
      INSERT INTO uploads(id, name, mime_type, size, width, height, created_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, metadata.name, metadata.mimeType, metadata.size, metadata.width ?? null, metadata.height ?? null, new Date().toISOString(), userId);
    return metadata;
  } catch (error) {
    await Promise.all([paths.original, paths.thumbnail, paths.extraction, originalTemp, thumbnailTemp, extractionTemp].map((target) => fs.unlink(target).catch(() => undefined)));
    throw error;
  }
}

export async function readUpload(id: string, userId: string) {
  await ensureLegacyUploadsMigrated();
  assertId(id);
  const row = db.prepare("SELECT id, name, mime_type, size, width, height FROM uploads WHERE id = ? AND user_id = ?").get(id, userId) as UploadRow | undefined;
  if (!row) throw Object.assign(new Error("Attachment not found."), { code: "ENOENT" });
  return { metadata: toAttachment(row), paths: pathsFor(id) };
}

export async function readUploadDataUrl(id: string, userId: string) {
  const { metadata, paths } = await readUpload(id, userId);
  if (!metadata.mimeType.startsWith("image/")) throw new Error("This attachment is not an image.");
  const data = await fs.readFile(/* turbopackIgnore: true */ paths.original);
  return `data:${metadata.mimeType};base64,${data.toString("base64")}`;
}

export async function readUploadModelContent(id: string, userId: string, settings: ToolSettings): Promise<ModelContentPart[]> {
  const { metadata, paths } = await readUpload(id, userId);
  if (metadata.mimeType.startsWith("image/")) return [{ type: "image_url", image_url: { url: await readUploadDataUrl(id, userId) } }];
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
      WHERE u.created_at < ? AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.upload_id = u.id)
    `).all(cutoff) as Array<{ id: string }>;
    for (const row of rows) db.prepare("DELETE FROM uploads WHERE id = ?").run(row.id);
    return rows.map((row) => row.id);
  })();
  await Promise.all(ids.map((id) => deleteUploadFiles(id)));
  return ids.length;
}
