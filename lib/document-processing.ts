import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolSettings } from "./types";

export type DocumentKind = "text" | "pdf" | "image" | "archive" | "binary";
export type ModelContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type PdfExtraction = {
  pageLimit: number;
  characterLimit: number;
  pageCount: number;
  processedPages: number;
  text: string;
  truncated: boolean;
  encrypted: boolean;
  renderedPages: Array<{ page: number; path: string; mimeType: "image/jpeg" }>;
};

const TEXT_APPLICATION_TYPES = new Set([
  "application/json", "application/ld+json", "application/xml", "application/xhtml+xml",
  "application/javascript", "application/x-javascript", "application/sql",
  "application/x-www-form-urlencoded", "application/yaml", "application/x-yaml",
]);
const IMAGE_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);
const ARCHIVE_TYPES = new Set([
  "application/zip", "application/x-zip-compressed", "application/x-rar-compressed",
  "application/vnd.rar", "application/x-7z-compressed", "application/gzip", "application/x-tar",
]);

function baseMimeType(contentType: string) {
  return contentType.split(";", 1)[0].trim().toLowerCase();
}

export function isSupportedUploadMimeType(mimeType: string) {
  const normalized = baseMimeType(mimeType);
  return normalized === "application/pdf" || IMAGE_UPLOAD_TYPES.has(normalized);
}

export function classifyDocument(contentType: string, filename = ""): DocumentKind {
  const mime = baseMimeType(contentType);
  const extension = path.extname(filename).toLowerCase();
  if (mime === "application/pdf" || extension === ".pdf") return "pdf";
  if (mime.startsWith("image/") || [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"].includes(extension)) return "image";
  if (ARCHIVE_TYPES.has(mime) || [".zip", ".rar", ".7z", ".gz", ".tgz", ".tar"].includes(extension)) return "archive";
  if (mime.startsWith("text/") || TEXT_APPLICATION_TYPES.has(mime) || mime.endsWith("+json") || mime.endsWith("+xml")) return "text";
  return "binary";
}

function charsetFrom(contentType: string) {
  return /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1] || "utf-8";
}

function assertTextLike(buffer: Buffer) {
  if (!buffer.length) return;
  let controls = 0;
  for (const byte of buffer.subarray(0, Math.min(buffer.length, 8_192))) {
    if (byte === 0) throw new Error("The response is binary data, not readable text.");
    if (byte < 9 || byte > 13 && byte < 32) controls += 1;
  }
  if (controls / Math.min(buffer.length, 8_192) > 0.02) throw new Error("The response is binary data, not readable text.");
}

export function decodeTextDocument(buffer: Buffer, contentType: string, characterLimit: number) {
  assertTextLike(buffer);
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charsetFrom(contentType), { fatal: true }); }
  catch { decoder = new TextDecoder("utf-8", { fatal: true }); }
  let text: string;
  try { text = decoder.decode(buffer); }
  catch { throw new Error("The response text uses an unsupported or invalid character encoding."); }
  const mime = baseMimeType(contentType);
  if (mime === "application/json" || mime.endsWith("+json")) {
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Preserve malformed JSON as text. */ }
  }
  const truncated = text.length > characterLimit;
  return { text: text.slice(0, characterLimit), truncated };
}

export function sniffRasterMimeType(buffer: Buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp" && /^(avif|avis)$/.test(buffer.subarray(8, 12).toString("ascii"))) return "image/avif";
  return undefined;
}

export function sniffDocument(buffer: Buffer, declaredType: string, filename = ""): DocumentKind {
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (sniffRasterMimeType(buffer)) return "image";
  if (buffer.subarray(0, 2).toString("binary") === "PK") return "archive";
  const classified = classifyDocument(declaredType, filename);
  if (classified !== "binary") return classified;
  try { decodeTextDocument(buffer.subarray(0, Math.min(buffer.length, 8_192)), declaredType, 8_192); return "text"; }
  catch { return "binary"; }
}

export function assertUploadSignature(buffer: Buffer, mimeType: string) {
  const mime = baseMimeType(mimeType);
  if (mime === "application/pdf" && buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("The selected PDF has an invalid file signature.");
  if (IMAGE_UPLOAD_TYPES.has(mime) && sniffRasterMimeType(buffer.subarray(0, 32)) !== mime) throw new Error("The selected image type does not match its file signature.");
}

function pythonInterpreter() {
  const virtualEnvPython = path.join(process.cwd(), ".python", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const embeddedPython = path.join(process.cwd(), ".python", "python.exe");
  return process.env.NEURAL_CHAT_PYTHON || (existsSync(virtualEnvPython) ? virtualEnvPython : existsSync(embeddedPython) ? embeddedPython : process.platform === "win32" ? "python" : "python3");
}

async function runPdfProcessor(filePath: string, settings: ToolSettings, renderDirectory?: string): Promise<PdfExtraction> {
  const script = path.join(process.cwd(), "scripts", "process-pdf.py");
  const args = [script, filePath, "--max-pages", String(settings.pdfPageLimit), "--max-chars", String(settings.pdfTextCharacterLimit)];
  if (renderDirectory) args.push("--render-dir", renderDirectory, "--max-render-pages", String(settings.pdfVisionPageLimit));
  return new Promise((resolve, reject) => {
    const child = spawn(pythonInterpreter(), args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let outputSize = 0; let settled = false;
    const outputLimit = settings.pdfTextCharacterLimit * 4 + 250_000;
    const finish = (error?: Error, result?: PdfExtraction) => {
      if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result!);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error(`PDF processing exceeded ${settings.pdfProcessingTimeoutSeconds} seconds.`)); }, settings.pdfProcessingTimeoutSeconds * 1_000);
    child.stdout.on("data", (chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > outputLimit) { child.kill(); finish(new Error("PDF processor returned more text than the configured limit permits.")); return; }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => { if (Buffer.concat(stderr).length < 64_000) stderr.push(chunk); });
    child.on("error", (error) => finish(new Error(`Unable to start the PDF processor: ${error.message}`)));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error(Buffer.concat(stderr).toString("utf8").trim() || "PDF processing failed."));
      try { finish(undefined, JSON.parse(Buffer.concat(stdout).toString("utf8")) as PdfExtraction); }
      catch { finish(new Error("PDF processor returned invalid output.")); }
    });
  });
}

export async function extractPdf(filePath: string, settings: ToolSettings) {
  return runPdfProcessor(filePath, settings);
}

export async function cleanupTemporaryDocuments(settings: ToolSettings) {
  const tempRoot = os.tmpdir(); const cutoff = Date.now() - settings.temporaryFileTtlMinutes * 60 * 1_000;
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await fs.readdir(tempRoot, { withFileTypes: true }); } catch { return 0; }
  const candidates = entries.filter((entry) => entry.isDirectory() && (entry.name.startsWith("neural-chat-download-") || entry.name.startsWith("neural-chat-pdf-")));
  let removed = 0;
  for (const entry of candidates) {
    const target = path.join(tempRoot, entry.name);
    try {
      const metadata = await fs.stat(target);
      if (metadata.mtimeMs >= cutoff) continue;
      await fs.rm(target, { recursive: true, force: true }); removed += 1;
    } catch { /* Another request or the OS may already have removed it. */ }
  }
  return removed;
}

export async function pdfModelContent(filePath: string, label: string, settings: ToolSettings, cached?: PdfExtraction): Promise<{ result: Record<string, unknown>; content: ModelContentPart[] }> {
  await cleanupTemporaryDocuments(settings);
  let workDir: string | undefined;
  try {
    let extraction = cached || await runPdfProcessor(filePath, settings);
    if (!extraction.text.trim() && settings.pdfVisionPageLimit > 0) {
      workDir = await fs.mkdtemp(path.join(os.tmpdir(), "neural-chat-pdf-"));
      extraction = await runPdfProcessor(filePath, settings, workDir);
    }
    const description = `[PDF: ${label}; ${extraction.pageCount} page(s); processed ${extraction.processedPages}${extraction.truncated ? "; truncated by configured limits" : ""}]`;
    const content: ModelContentPart[] = [{ type: "text", text: extraction.text.trim() ? `${description}\n\n${extraction.text}` : `${description}\nNo extractable text was found. Review the rendered page images.` }];
    for (const rendered of extraction.renderedPages) {
      const image = await fs.readFile(rendered.path);
      content.push({ type: "image_url", image_url: { url: `data:${rendered.mimeType};base64,${image.toString("base64")}` } });
    }
    return {
      result: {
        type: "pdf", name: label, pageCount: extraction.pageCount, processedPages: extraction.processedPages,
        extractedTextPreview: extraction.text.slice(0, 4_000), renderedPages: extraction.renderedPages.map((item) => item.page), truncated: extraction.truncated,
      },
      content,
    };
  } finally {
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
