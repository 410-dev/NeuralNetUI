import { promises as fs } from "node:fs";
import { classifyDocument, decodeTextDocument, type ModelContentPart } from "./document-processing.ts";
import { readUpload, readUploadModelContent, storagePage, type StorageSort } from "./uploads.ts";
import type { ModelConfig, ToolSettings } from "./types.ts";

export function storageAccessToolDefinition() {
  return {
    type: "function",
    function: {
      name: "storage_access",
      description: "Search and read files in the current user's private NeuralNetUI storage. Use search when the user mentions a stored filename without an attachment, then read the matching file by id. Images are returned to vision-capable models, PDFs return extracted text and rendered pages when needed, and safe text files return decoded text. Files belonging to other users and deleted files are never accessible.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["search", "read"] },
          query: { type: "string", description: "Filename or partial filename. For read, this may be used when file_id is unknown." },
          file_id: { type: "string", description: "Private storage file id returned by search." },
          sort: { type: "string", enum: ["created_desc", "created_asc", "name_asc", "name_desc", "size_asc", "size_desc"], default: "name_asc" },
          limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
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

export async function executeStorageAccessTool(raw: Record<string, unknown>, userId: string, settings: ToolSettings, model?: Pick<ModelConfig, "visionImageMode" | "visionMaxEdgePixels">): Promise<{result:unknown;content?:ModelContentPart[]}> {
  const action = String(raw.action || "").toLowerCase();
  const query = String(raw.query || "").trim().slice(0, 200);
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
    const content = await readUploadModelContent(metadata.id, userId, settings, model);
    return { result:{ file:summary(metadata), kind, loaded:true }, content:[{type:"text",text:`Loaded private storage file: ${metadata.name}`}, ...content] };
  }
  if (kind === "text") {
    if (metadata.size > settings.textDownloadLimitMb * 1024 * 1024) throw new Error(`${metadata.name} exceeds the configured text file limit.`);
    const decoded = decodeTextDocument(await fs.readFile(paths.original), metadata.mimeType, settings.textCharacterLimit);
    return { result:{ file:summary(metadata), kind, loaded:true, truncated:decoded.truncated }, content:[{type:"text",text:`[Private storage file: ${metadata.name}]\n\n${decoded.text}`}] };
  }
  throw new Error("This stored file type cannot be loaded into model context.");
}
