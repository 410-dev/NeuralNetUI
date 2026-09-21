import { promises as fs } from "node:fs";
import { classifyDocument, decodeTextDocument, type ModelContentPart } from "./document-processing.ts";
import { readUpload, readUploadModelContent, saveTextFile, storagePage, type StorageSort } from "./uploads.ts";
import type { ModelConfig, ToolSettings } from "./types.ts";

export type StorageToolPermissions = { read: boolean; write: boolean; maxWrites: number; writesUsed?: number };

export function storageAccessToolDefinition(permissions: StorageToolPermissions = { read:true, write:false, maxWrites:5 }) {
  const actions = [...(permissions.read ? ["search", "read"] : []), ...(permissions.write ? ["write"] : [])];
  return {
    type: "function",
    function: {
      name: "storage_access",
      description: `${permissions.read ? "Search and read files in the current user's private NeuralNetUI storage. " : ""}${permissions.write ? `Create plain-text or Markdown files in private storage (at most ${permissions.maxWrites} files in this conversation). ` : ""}Files belonging to other users and deleted files are never accessible.`,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: actions },
          query: { type: "string", description: "Filename or partial filename. For read, this may be used when file_id is unknown." },
          file_id: { type: "string", description: "Private storage file id returned by search." },
          sort: { type: "string", enum: ["created_desc", "created_asc", "name_asc", "name_desc", "size_asc", "size_desc"], default: "name_asc" },
          limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
          name: { type: "string", description: "Filename for write. A matching .txt or .md extension is added when omitted." },
          kind: { type: "string", enum: ["text", "markdown"], description: "Text format for write." },
          content: { type: "string", description: "Complete UTF-8 text content for write." },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  };
}

function summary(file: { id:string;name:string;mimeType:string;size:number;createdAt?:string }) {
  return { id:file.id, name:file.name, mimeType:file.mimeType, size:file.size, ...(file.createdAt?{createdAt:file.createdAt}:{}) };
}

export async function executeStorageAccessTool(raw: Record<string, unknown>, userId: string, settings: ToolSettings, permissions: StorageToolPermissions = { read:true, write:false, maxWrites:5 }, model?: Pick<ModelConfig, "visionImageMode" | "visionMaxEdgePixels">, signal?: AbortSignal): Promise<{result:unknown;content?:ModelContentPart[]}> {
  signal?.throwIfAborted();
  const action = String(raw.action || "").toLowerCase();
  const query = String(raw.query || "").trim().slice(0, 200);
  if (action === "write") {
    if (!permissions.write) throw new Error("Storage write access is disabled for this session.");
    const maximum=Math.max(1,Math.min(20,Math.floor(permissions.maxWrites)||5));
    if ((permissions.writesUsed || 0) >= maximum) throw new Error(`This conversation has reached its ${maximum}-file storage write limit.`);
    const kind=String(raw.kind || "text").toLowerCase();
    if (kind!=="text"&&kind!=="markdown") throw new Error("Storage writes support only plain text and Markdown.");
    const name=String(raw.name || "").trim(),content=String(raw.content ?? "");
    if (!name) throw new Error("write requires a file name.");
    if (Buffer.byteLength(content,"utf8") > settings.textDownloadLimitMb * 1024 * 1024) throw new Error("The text file exceeds the configured text file limit.");
    const file=await saveTextFile(name,kind,content,userId);
    return { result:{ file:summary(file), kind, created:true, remaining:Math.max(0,maximum-(permissions.writesUsed || 0)-1) } };
  }
  if (!permissions.read) throw new Error("Storage read access is disabled for this session.");
  if (action === "search") {
    const limit = Math.max(1, Math.min(20, Math.floor(Number(raw.limit) || 10)));
    const page = await storagePage(userId, { page:1, pageSize:limit, query, sort:String(raw.sort || "name_asc") as StorageSort, state:"active" });
    return { result:{ query, total:page.total, files:page.files.map(summary), truncated:page.total > page.files.length } };
  }
  if (action !== "read") throw new Error("Storage action must be search or read.");

  let fileId = String(raw.file_id || "").trim();
  if (!fileId) {
    if (!query) throw new Error("read requires file_id or a filename query.");
    const matches = await storagePage(userId, { page:1, pageSize:20, query, sort:"name_asc", state:"active" });
    const exact = matches.files.filter(file => file.name.toLocaleLowerCase() === query.toLocaleLowerCase());
    const candidate = exact.length === 1 ? exact[0] : matches.total === 1 ? matches.files[0] : undefined;
    if (!candidate) return { result:{ error:"The filename is ambiguous or was not found.", query, total:matches.total, files:matches.files.map(summary) } };
    fileId = candidate.id;
  }
  const { metadata, paths } = await readUpload(fileId, userId);
  const kind = classifyDocument(metadata.mimeType, metadata.name);
  if (kind === "image" || kind === "pdf") {
    const content = await readUploadModelContent(metadata.id, userId, settings, model, signal);
    return { result:{ file:summary(metadata), kind, loaded:true }, content:[{type:"text",text:`Loaded private storage file: ${metadata.name}`}, ...content] };
  }
  if (kind === "text") {
    if (metadata.size > settings.textDownloadLimitMb * 1024 * 1024) throw new Error(`${metadata.name} exceeds the configured text file limit.`);
    const decoded = decodeTextDocument(await fs.readFile(paths.original, signal ? { signal } : undefined), metadata.mimeType, settings.textCharacterLimit);
    return { result:{ file:summary(metadata), kind, loaded:true, truncated:decoded.truncated }, content:[{type:"text",text:`[Private storage file: ${metadata.name}]\n\n${decoded.text}`}] };
  }
  throw new Error("This stored file type cannot be loaded into model context.");
}
