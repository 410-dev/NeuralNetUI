import { createWriteStream, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Tool } from "@modelcontextprotocol/client";
import { dataDir, db } from "./database";
import { readUpload, remainingStorageBytes, saveHostFile } from "./uploads";
import { vmBaseUrl, vmConnection, vmHeaders } from "./vm";

/** Tools NeuralNetUI adds to the virtual computer's own: moving files between it and the account's private storage. */
export const VM_FILE_TOOLS: Tool[] = [
  { name: "copy_to_storage", description: "Copy a file from the virtual computer's workspace into the user's private storage in NeuralNetUI and get a download link to show the user. Use it for results the user should keep or download (videos, documents, archives).",
    inputSchema: { type: "object", additionalProperties: false, required: ["path"], properties: { path: { type: "string", description: "File path in the workspace (relative to its home or absolute inside it)." }, filename: { type: "string", description: "Name to store it under (default: the file's name)." } } },
    annotations: { readOnlyHint: true } } as Tool,
  { name: "copy_from_storage", description: "Copy a file from the user's private storage (or an attachment in this chat) to the virtual computer's workspace. Name the file by its storage id or its exact file name.",
    inputSchema: { type: "object", additionalProperties: false, required: ["file", "path"], properties: { file: { type: "string", description: "Storage file id, or its exact name." }, path: { type: "string", description: "Destination path in the workspace." } } } } as Tool,
];
export const isVmFileTool = (name: string) => VM_FILE_TOOLS.some(tool => tool.name === name);

const formatBytes = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export async function runVmFileTool(userId: string, name: string, args: Record<string, unknown>, signal: AbortSignal, onProgress?: (message: string) => void) {
  const vm = vmConnection(userId);
  if (!vm) throw new Error("No virtual computer is connected.");
  const base = vmBaseUrl(vm.url);
  if (name === "copy_to_storage") {
    const source = String(args.path || "").trim();
    if (!source) throw new Error("A path is required.");
    const limit = remainingStorageBytes(userId);
    if (limit <= 0) throw new Error("Private storage is full.");
    const response = await fetch(`${base}/files?path=${encodeURIComponent(source)}`, { headers: vmHeaders(vm), signal });
    if (!response.ok || !response.body) throw new Error((await response.text().catch(() => "")) || `The virtual computer answered ${response.status}.`);
    const size = Number(response.headers.get("content-length") || 0);
    if (size > limit) throw new Error(`The file (${formatBytes(size)}) is larger than the ${formatBytes(limit)} left in private storage.`);
    const work = path.join(dataDir, "tmp", `vm-${randomUUID()}`);
    await fs.mkdir(work, { recursive: true, mode: 0o700 });
    try {
      const file = path.join(work, "file.bin");
      let received = 0, shown = 0;
      const counted = Readable.fromWeb(response.body as never).on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > limit) counted.destroy(new Error(`The file is larger than the ${formatBytes(limit)} left in private storage.`));
        const now = Date.now(); if (now - shown > 1000) { shown = now; onProgress?.(`${formatBytes(received)}${size ? ` / ${formatBytes(size)}` : ""}`); }
      });
      await pipeline(counted, createWriteStream(file, { mode: 0o600 }));
      const stored = await saveHostFile(file, userId, String(args.filename || "").trim() || path.posix.basename(source));
      return { result: { type: "saved_to_storage", id: stored.metadata.id, name: stored.metadata.name, size: received, url: stored.metadata.url }, content: [{ type: "text" as const, text: `Saved "${stored.metadata.name}" (${formatBytes(received)}) to the user's private storage. Link for the user: ${stored.markdown}` }] };
    } finally { await fs.rm(work, { recursive: true, force: true }).catch(() => undefined); }
  }
  if (name === "copy_from_storage") {
    const wanted = String(args.file || "").trim(), destination = String(args.path || "").trim();
    if (!wanted || !destination) throw new Error("A file and a destination path are required.");
    const row = db.prepare("SELECT id FROM uploads WHERE user_id = ? AND deleted_at IS NULL AND (id = ? OR name = ?) ORDER BY created_at DESC LIMIT 1").get(userId, wanted, wanted) as { id: string } | undefined;
    if (!row) throw new Error(`No file "${wanted}" in private storage.`);
    const stored = await readUpload(row.id, userId);
    const stat = await fs.stat(stored.paths.original);
    onProgress?.(formatBytes(stat.size));
    const { createReadStream } = await import("node:fs");
    const response = await fetch(`${base}/files?path=${encodeURIComponent(destination)}`, { method: "PUT", headers: { ...vmHeaders(vm), "Content-Length": String(stat.size), "Content-Type": "application/octet-stream" }, body: Readable.toWeb(createReadStream(stored.paths.original)) as never, signal, duplex: "half" } as RequestInit);
    const body = await response.json().catch(() => ({})) as { path?: string; size?: number; error?: string };
    if (!response.ok) throw new Error(body.error || `The virtual computer answered ${response.status}.`);
    return { result: { copied: true, name: stored.metadata.name, path: body.path, size: body.size }, content: [{ type: "text" as const, text: `Copied "${stored.metadata.name}" (${formatBytes(stat.size)}) to ${body.path} on the virtual computer.` }] };
  }
  throw new Error(`Unknown file tool ${name}.`);
}
