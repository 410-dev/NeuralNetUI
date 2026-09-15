import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const data = await mkdtemp(path.join(os.tmpdir(), "neural-google-browser-"));
process.env.NEURAL_CHAT_DATA_DIR = data; process.env.NEURAL_CHAT_DB_PATH = path.join(data, "qa.sqlite3");
const { executeBrowserTool } = await import("../lib/browser-tool.ts"); const { db } = await import("../lib/database.ts");
const settings = { maxToolRounds:8,maxBrowserTabs:3,maxMultipleChoiceQuestions:3,maxAttachmentsPerMessage:12,textDownloadLimitMb:1,textCharacterLimit:24_000,imageDownloadLimitMb:10,imageUploadLimitMb:20,pdfSizeLimitMb:25,pdfPageLimit:100,pdfTextCharacterLimit:100_000,pdfVisionPageLimit:6,pdfProcessingTimeoutSeconds:30,temporaryFileTtlMinutes:60,orphanUploadTtlHours:24 };
let sessionId = "";
try {
  const opened = await executeBrowserTool("google-browser-smoke", JSON.stringify({ action: "open", url: "https://accounts.google.com/", wait_seconds: 1 }), settings);
  const result = opened.result; assert.ok(result && typeof result === "object"); sessionId = String(result.sessionId || ""); assert.ok(sessionId);
  const visible = `${result.title || ""}\n${result.text || ""}`; assert.doesNotMatch(visible, /browser or app may not be secure|브라우저 또는 앱이 안전하지 않을 수 있습니다/i);
  assert.match(String(result.url || ""), /^https:\/\/accounts\.google\.com\//); console.log("PASS: installed stable browser opens the Google Accounts sign-in surface without an immediate unsafe-browser rejection");
} finally {
  if (sessionId) await executeBrowserTool("google-browser-smoke", JSON.stringify({ action: "close", session_id: sessionId }), settings).catch(() => undefined);
  db.close(); await rm(data, { recursive: true, force: true });
}
