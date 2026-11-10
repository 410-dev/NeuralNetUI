/**
 * Plain-text chat attachments. Shared by the browser and the server, so it imports nothing from Node.
 * A text attachment is read by the model as text, served back to the browser as `text/plain`, and
 * never rendered as markup.
 */

const TEXT_ATTACHMENT_EXTENSIONS: Record<string, string> = {
  ".txt": "text/plain", ".text": "text/plain", ".log": "text/plain", ".ini": "text/plain", ".cfg": "text/plain", ".conf": "text/plain",
  ".env": "text/plain", ".rst": "text/plain", ".tex": "text/plain", ".srt": "text/plain", ".vtt": "text/plain",
  ".md": "text/markdown", ".markdown": "text/markdown", ".mdx": "text/markdown",
  ".csv": "text/csv", ".tsv": "text/tab-separated-values",
  ".json": "application/json", ".jsonl": "application/json", ".xml": "application/xml",
  ".yaml": "application/yaml", ".yml": "application/yaml", ".toml": "application/toml",
  ".html": "text/html", ".htm": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript", ".cjs": "text/javascript", ".jsx": "text/jsx",
  ".ts": "text/typescript", ".tsx": "text/typescript", ".py": "text/x-python", ".sql": "text/x-sql",
  ".sh": "text/x-shellscript", ".ps1": "text/plain", ".c": "text/plain", ".h": "text/plain", ".cpp": "text/plain",
  ".java": "text/plain", ".go": "text/plain", ".rs": "text/plain", ".rb": "text/plain", ".php": "text/plain",
  ".swift": "text/plain", ".kt": "text/plain",
};

const TEXT_APPLICATION_TYPES = new Set(["application/json", "application/xml", "application/yaml", "application/x-yaml", "application/toml"]);

function baseType(value: string) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function extensionOf(name: string) {
  const match = /\.[^./\\]+$/.exec(String(name || "").toLowerCase());
  return match ? match[0] : "";
}

/** True for a stored attachment type that is read as plain text. */
export function isTextAttachmentType(mimeType: string) {
  const mime = baseType(mimeType);
  return mime.startsWith("text/") || TEXT_APPLICATION_TYPES.has(mime);
}

/** The stored type for a selected file when it is a plain-text attachment, otherwise undefined. */
export function textAttachmentMimeType(name: string, declaredType = "") {
  const byExtension = TEXT_ATTACHMENT_EXTENSIONS[extensionOf(name)];
  if (byExtension) return byExtension;
  const declared = baseType(declaredType);
  return isTextAttachmentType(declared) ? declared : undefined;
}

/** `accept` attribute fragment for file pickers. */
export const TEXT_ATTACHMENT_ACCEPT = ["text/plain", "text/markdown", "text/csv", ...Object.keys(TEXT_ATTACHMENT_EXTENSIONS)].join(",");
