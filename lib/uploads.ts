import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { StoredAttachment } from "./types";
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
    thumbnailUrl: `/api/uploads/${row.id}?variant=thumbnail`,
  };
}

export async function ensureLegacyUploadsMigrated() {
  if (storageMigrationCompleted(legacyMigrationName)) return;
  legacyMigration ??= (async () => {
    await fs.mkdir(uploadsDir, { recursive: true });
    const files = (await fs.readdir(uploadsDir)).filter((file) => file.endsWith(".json"));
    const insert = db.prepare(`
      INSERT OR IGNORE INTO uploads(id, name, mime_type, size, width, height, created_at)
      VALUES (@id, @name, @mimeType, @size, @width, @height, @createdAt)
    `);
    const migrate = db.transaction((records: Array<StoredAttachment & { createdAt: string }>) => {
      for (const record of records) insert.run(record);
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

export async function saveUpload(file: File, thumbnail: File, dimensions?: { width?: number; height?: number }): Promise<StoredAttachment> {
  await ensureLegacyUploadsMigrated();
  if (!file.type.startsWith("image/")) throw new Error("Only image uploads are supported.");
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} exceeds the 20 MB limit.`);
  if (!thumbnail.type.startsWith("image/")) throw new Error("Invalid thumbnail.");
  const id = randomUUID();
  const paths = pathsFor(id);
  const metadata: StoredAttachment = {
    id, name: file.name.slice(0, 240), mimeType: file.type, size: file.size,
    width: dimensions?.width, height: dimensions?.height,
    url: `/api/uploads/${id}`, thumbnailUrl: `/api/uploads/${id}?variant=thumbnail`,
  };
  await fs.mkdir(uploadsDir, { recursive: true });
  try {
    await Promise.all([
      fs.writeFile(paths.original, Buffer.from(await file.arrayBuffer()), { mode: 0o600 }),
      fs.writeFile(paths.thumbnail, Buffer.from(await thumbnail.arrayBuffer()), { mode: 0o600 }),
    ]);
    db.prepare(`
      INSERT INTO uploads(id, name, mime_type, size, width, height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, metadata.name, metadata.mimeType, metadata.size, metadata.width ?? null, metadata.height ?? null, new Date().toISOString());
    return metadata;
  } catch (error) {
    await Promise.all([paths.original, paths.thumbnail].map((target) => fs.unlink(target).catch(() => undefined)));
    throw error;
  }
}

export async function readUpload(id: string) {
  await ensureLegacyUploadsMigrated();
  assertId(id);
  const row = db.prepare("SELECT id, name, mime_type, size, width, height FROM uploads WHERE id = ?").get(id) as UploadRow | undefined;
  if (!row) throw Object.assign(new Error("Image not found."), { code: "ENOENT" });
  return { metadata: toAttachment(row), paths: pathsFor(id) };
}

export async function readUploadDataUrl(id: string) {
  const { metadata, paths } = await readUpload(id);
  const data = await fs.readFile(/* turbopackIgnore: true */ paths.original);
  return `data:${metadata.mimeType};base64,${data.toString("base64")}`;
}

export async function deleteUpload(id: string) {
  await ensureLegacyUploadsMigrated();
  assertId(id);
  const references = db.prepare("SELECT COUNT(*) AS count FROM message_attachments WHERE upload_id = ?").get(id) as { count: number };
  if (references.count) throw new Error("This image is attached to a saved conversation.");
  db.prepare("DELETE FROM uploads WHERE id = ?").run(id);
  await deleteUploadFiles(id);
}

export async function deleteUploadFiles(id: string) {
  const paths = pathsFor(id);
  await Promise.all(Object.values(paths).map((target) => fs.unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  })));
}
