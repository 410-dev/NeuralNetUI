import type { ArtifactKind } from "./types.ts";

export type StorageFileViewKind = ArtifactKind | "text" | "image" | "pdf" | "binary";

const extensionOf = (name: string) => name.toLowerCase().match(/\.([^.]+)$/)?.[1] || "";
const baseMimeType = (mimeType: string) => mimeType.toLowerCase().split(";", 1)[0].trim();

export function storageFileViewKind(name: string, mimeType: string): StorageFileViewKind {
  const extension = extensionOf(name), mime = baseMimeType(mimeType);
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (mime === "text/html" || mime === "application/xhtml+xml" || extension === "html" || extension === "htm") return "html";
  if (mime === "text/csv" || extension === "csv") return "csv";
  if (mime === "application/json" || mime.endsWith("+json") || extension === "json") return "json";
  if (mime === "application/xml" || mime === "text/xml" || mime.endsWith("+xml") || extension === "xml") return "xml";
  if (mime === "text/markdown" || ["md", "mdown", "markdown"].includes(extension)) return "markdown";
  if (mime.startsWith("text/") || ["application/javascript", "application/typescript", "application/yaml", "application/x-yaml", "application/toml", "application/sql"].includes(mime) || ["jsonl", "yaml", "yml", "toml", "ini", "conf", "log", "sql", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "sh", "bash", "zsh", "ps1"].includes(extension)) return "text";
  return "binary";
}

export function isEditableStorageFile(name: string, mimeType: string) {
  return ["html", "csv", "json", "xml", "markdown", "text"].includes(storageFileViewKind(name, mimeType));
}

export function storageFileLanguage(name: string, mimeType: string) {
  const kind = storageFileViewKind(name, mimeType);
  if (kind !== "text") return kind;
  return extensionOf(name) || "text";
}
