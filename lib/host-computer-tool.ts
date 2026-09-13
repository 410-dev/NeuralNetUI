import { spawn, type ChildProcess } from "node:child_process";
import { constants, existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createConnection } from "node:net";
import type { ModelContentPart } from "./document-processing";
import { isHostComputerAvailable } from "./host-environment.ts";
import type { HarnessSettings } from "./types";
import { hostPermissionForAction } from "./host-permissions.ts";
import { saveGeneratedImage } from "./uploads.ts";

export type HostRiskAssessment = { riskLevel: 1 | 2 | 3 | 4 | 5; explanation: string };
export type HostToolExecution = { result: unknown; content?: ModelContentPart[] };

type HostArgs = Record<string, unknown>;
type ManagedProcess = { child: ChildProcess; pid: number; name: string; program: string; startedAt: string };

declare global {
  var neuralChatHostProcesses: Map<string, Map<number, ManagedProcess>> | undefined;
}

const processSessions = globalThis.neuralChatHostProcesses ?? new Map<string, Map<number, ManagedProcess>>();
globalThis.neuralChatHostProcesses = processSessions;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;

function stringArg(args: HostArgs, key: string, required = true) {
  const value = typeof args[key] === "string" ? args[key].trim() : "";
  if (required && !value) throw new Error(`${key} is required.`);
  return value;
}

function resolvedPath(args: HostArgs, key = "path") {
  const value = stringArg(args, key);
  if (value.includes("\0")) throw new Error(`${key} contains an invalid character.`);
  return path.resolve(value);
}

function languageText(locale: string, ko: string, en: string) { return locale.startsWith("ko") ? ko : en; }

export function hostComputerToolDefinition() {
  return {
    type: "function",
    function: {
      name: "host_computer",
      description: "Control the non-containerized computer hosting NeuralNetUI. Search, inspect, read, copy, write, rename, move or delete files; upload a file to temp.hysong.dev; start, list or stop background programs retained for this conversation; run PowerShell or Bash; or capture the current desktop. Every action is checked against the Superadmin trust policy. Use explicit absolute paths and prefer dedicated file actions over shell commands.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["search_files", "inspect_path", "read_file", "copy", "write_file", "rename", "move", "delete", "upload_temp", "start_process", "list_processes", "kill_process", "run_shell", "screenshot"] },
          path: { type: "string", description: "Absolute source path for file actions, or search root" },
          destination: { type: "string", description: "Absolute destination for copy or move" },
          new_name: { type: "string", description: "Filename only for rename" },
          query: { type: "string", description: "Filename glob fragment for search_files, for example *.pdf or report" },
          content: { type: "string", description: "UTF-8 content for write_file" },
          encoding: { type: "string", enum: ["utf8", "base64"], description: "Content encoding for read_file or write_file" },
          overwrite: { type: "boolean" },
          recursive: { type: "boolean" },
          max_results: { type: "integer", minimum: 1, maximum: 500 },
          max_downloads: { type: "integer", minimum: 1, maximum: 100 },
          program: { type: "string", description: "Executable path or command for start_process" },
          arguments: { type: "array", maxItems: 100, items: { type: "string" }, description: "Literal process arguments; no shell expansion" },
          process_name: { type: "string", description: "Readable name retained with the PID" },
          pid: { type: "integer", minimum: 1 },
          shell: { type: "string", enum: ["powershell", "bash"] },
          command: { type: "string", description: "PowerShell or Bash command to run" },
          cwd: { type: "string", description: "Optional absolute working directory" },
          timeout_seconds: { type: "integer", minimum: 1, maximum: 300 },
        },
        required: ["action"], additionalProperties: false,
      },
    },
  };
}

export function isShellHostAction(args: HostArgs) { return String(args.action || "") === "run_shell"; }

export function hostActionRequiresApproval(settings: Pick<HarnessSettings, "hostTrustMode" | "hostTrustedPermissions">, args: HostArgs, riskLevel: HostRiskAssessment["riskLevel"]) {
  if (settings.hostTrustMode === "full") return false;
  if (settings.hostTrustMode === "none") return true;
  const permission = hostPermissionForAction(args, riskLevel);
  return !permission || settings.hostTrustedPermissions[permission] !== true;
}

export function deterministicHostAssessment(args: HostArgs, locale = "en"): HostRiskAssessment {
  const action = String(args.action || "");
  const source = typeof args.path === "string" ? path.resolve(args.path) : "";
  const destination = typeof args.destination === "string" ? path.resolve(args.destination) : "";
  const descriptions: Record<string, [HostRiskAssessment["riskLevel"], string, string]> = {
    search_files: [1, `${source}에서 이름이 “${String(args.query || "*")}”와 일치하는 파일·폴더의 경로와 메타데이터를 검색합니다. 파일 내용은 읽지 않습니다.`, `Search ${source} for files and folders matching “${String(args.query || "*")}” and return paths and metadata without reading file contents.`],
    inspect_path: [1, `${source}의 종류, 크기, 수정 시각과 권한을 확인하며 내용은 읽지 않습니다.`, `Inspect the type, size, modified time, and permissions of ${source} without reading its contents.`],
    read_file: [2, `${source}의 실제 파일 내용을 ${String(args.encoding || "utf8")} 형식으로 읽습니다.`, `Read the actual contents of ${source} as ${String(args.encoding || "utf8")}.`],
    copy: [3, `${source}을(를) ${destination}(으)로 복사${args.overwrite ? "하고 기존 대상을 덮어씁니다" : "합니다"}.`, `Copy ${source} to ${destination}${args.overwrite ? ", replacing an existing destination" : ""}.`],
    write_file: [3, `${source}에 ${String(args.encoding || "utf8")} 형식의 파일 내용을 ${args.overwrite ? "원자적으로 쓰거나 교체합니다" : "새로 씁니다"}.`, `${args.overwrite ? "Atomically write or replace" : "Create"} ${source} with ${String(args.encoding || "utf8")} content.`],
    rename: [3, `${source}의 이름을 같은 폴더 안의 “${String(args.new_name || "")}”(으)로 바꿉니다.`, `Rename ${source} to “${String(args.new_name || "")}” in the same folder.`],
    move: [args.overwrite ? 4 : 3, `${source}을(를) ${destination}(으)로 이동${args.overwrite ? "하고 기존 대상을 영구적으로 교체합니다" : "합니다"}.`, `Move ${source} to ${destination}${args.overwrite ? ", permanently replacing an existing destination" : ""}.`],
    delete: [4, `${source}${args.recursive ? " 및 그 안의 모든 항목" : ""}을(를) 영구 삭제합니다. 휴지통으로 이동하지 않습니다.`, `Permanently delete ${source}${args.recursive ? " and everything below it" : ""}; it will not be moved to trash.`],
    upload_temp: [3, `${source}의 내용을 temp.hysong.dev에 업로드하고 최대 ${Number(args.max_downloads || 1)}회 다운로드 가능한 링크를 만듭니다.`, `Upload the contents of ${source} to temp.hysong.dev and create a link allowing up to ${Number(args.max_downloads || 1)} downloads.`],
    start_process: [3, `프로그램 “${String(args.program || "")}”을(를) 인수 ${JSON.stringify(args.arguments || [])}와 함께 백그라운드에서 시작하고 PID와 이름을 이 대화에 보관합니다.`, `Start “${String(args.program || "")}” in the background with arguments ${JSON.stringify(args.arguments || [])}, retaining its PID and name for this conversation.`],
    list_processes: [1, "이 대화에서 시작한 백그라운드 프로그램의 PID, 이름, 실행 파일과 시작 시각을 확인합니다.", "List the PID, name, executable, and start time of background programs started in this conversation."],
    kill_process: [4, `이 대화에서 시작해 기록한 PID ${Number(args.pid || 0)} 프로세스를 종료합니다.`, `Terminate PID ${Number(args.pid || 0)}, which must be a process retained for this conversation.`],
    screenshot: [2, "호스트 컴퓨터의 현재 전체 화면을 캡처하여 모델의 시각 맥락으로 전달합니다.", "Capture the host computer's current full screen and provide it as visual context to the model."],
  };
  const entry = descriptions[action];
  if (!entry) return { riskLevel: 5, explanation: languageText(locale, `알 수 없는 호스트 작업 “${action}”을 요청합니다.`, `Request unknown host action “${action}”.`) };
  return { riskLevel: entry[0], explanation: locale.startsWith("ko") ? entry[1] : entry[2] };
}

function globRegex(query: string) {
  const escaped = query.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(escaped || ".*", "i");
}

async function searchFiles(root: string, query: string, maximum: number) {
  const matcher = globRegex(query); const found: Array<Record<string, unknown>> = []; const pending = [root]; let visitedDirectories = 0;
  while (pending.length && found.length < maximum && visitedDirectories < 10_000) {
    const directory = pending.shift()!;
    visitedDirectories += 1;
    let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) {
      if (directory === root) throw error; continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (matcher.test(entry.name)) {
        const stats = await fs.lstat(fullPath).catch(() => undefined);
        found.push({ path: fullPath, type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other", size: stats?.size, modifiedAt: stats?.mtime.toISOString() });
        if (found.length >= maximum) break;
      }
      if (entry.isDirectory()) pending.push(fullPath);
    }
  }
  return { root, query, matches: found, visitedDirectories, truncated: pending.length > 0 || found.length >= maximum };
}

async function atomicWrite(target: string, data: Buffer, overwrite: boolean) {
  if (data.length > MAX_WRITE_BYTES) throw new Error(`Content exceeds the ${MAX_WRITE_BYTES}-byte write limit.`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (!overwrite) await fs.access(target, constants.F_OK).then(() => { throw new Error("Destination already exists; set overwrite to replace it."); }, () => undefined);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  const backup = `${temporary}.bak`;
  await fs.writeFile(temporary, data, { flag: "wx", mode: 0o600 });
  try {
    if (overwrite && existsSync(target)) {
      await fs.rename(target, backup);
      try { await fs.rename(temporary, target); } catch (error) { await fs.rename(backup, target).catch(() => undefined); throw error; }
      await fs.rm(backup, { force: true });
    } else await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined); }
}

function assertNotFilesystemRoot(target: string) {
  if (path.parse(target).root === target) throw new Error("A filesystem root cannot be used as a destructive target.");
}

async function movePath(source: string, destination: string, overwrite: boolean) {
  assertNotFilesystemRoot(source); assertNotFilesystemRoot(destination);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const exists = await fs.lstat(destination).then(() => true, () => false);
  if (exists && !overwrite) throw new Error("Destination already exists; set overwrite to replace it.");
  const backup = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.bak`);
  if (exists) await fs.rename(destination, backup);
  try {
    try { await fs.rename(source, destination); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.moving`);
      try { await fs.cp(source, temporary, { recursive: true, errorOnExist: true, preserveTimestamps: true }); await fs.rename(temporary, destination); await fs.rm(source, { recursive: true, force: false }); }
      finally { await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined); }
    }
    if (exists) await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (exists) await fs.rename(backup, destination).catch(() => undefined);
    throw error;
  }
}

async function captureCommand(program: string, argv: string[], timeoutMs: number, cwd?: string) {
  return new Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number | null }>((resolve, reject) => {
    const child = spawn(program, argv, { cwd, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let stdoutSize = 0; let stderrSize = 0; let timedOut = false;
    const collect = (chunks: Buffer[], chunk: Buffer, current: number) => { const remaining = Math.max(0, MAX_OUTPUT_BYTES - current); if (remaining) chunks.push(chunk.subarray(0, remaining)); return current + chunk.length; };
    child.stdout?.on("data", (chunk: Buffer) => { stdoutSize = collect(stdout, chunk, stdoutSize); });
    child.stderr?.on("data", (chunk: Buffer) => { stderrSize = collect(stderr, chunk, stderrSize); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", exitCode => { clearTimeout(timer); if (timedOut) return reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)} seconds.`)); resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode }); });
  });
}

function shellExecutable(shell: string) {
  if (shell === "bash") return { program: process.platform === "win32" ? "bash.exe" : "bash", args: ["-lc"] };
  if (shell !== "powershell") throw new Error("shell must be powershell or bash.");
  return { program: process.platform === "win32" ? "powershell.exe" : "pwsh", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] };
}

async function uploadTemporary(filePath: string, maxDownloads: number) {
  const stats = await fs.stat(filePath); if (!stats.isFile()) throw new Error("Only regular files can be uploaded.");
  const metadata = new URLSearchParams({ filename: path.basename(filePath), size: String(stats.size), max_downloads: String(maxDownloads) });
  const response = await fetch("https://temp.hysong.dev/api/curl/uploads", { method: "POST", body: metadata, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Upload initialization failed (${response.status}).`);
  const [uploadId, uploadToken, chunkSizeText, totalChunksText] = (await response.text()).trim().split("\t");
  const chunkSize = Number(chunkSizeText); const totalChunks = Number(totalChunksText);
  if (!uploadId || !uploadToken || !Number.isSafeInteger(chunkSize) || chunkSize <= 0 || !Number.isSafeInteger(totalChunks) || totalChunks < 0) throw new Error("Upload service returned invalid metadata.");
  const handle = await fs.open(filePath, "r");
  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const length = Math.min(chunkSize, stats.size - index * chunkSize); const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, index * chunkSize);
      const part = await fetch(`https://temp.hysong.dev/api/uploads/${encodeURIComponent(uploadId)}/chunks/${index}`, { method: "PUT", headers: { "X-Upload-Token": uploadToken, "Content-Type": "application/octet-stream" }, body: buffer, signal: AbortSignal.timeout(60_000) });
      if (!part.ok) throw new Error(`Upload chunk ${index + 1}/${totalChunks} failed (${part.status}).`);
    }
  } finally { await handle.close(); }
  const complete = await fetch(`https://temp.hysong.dev/api/curl/uploads/${encodeURIComponent(uploadId)}/complete`, { method: "POST", headers: { "X-Upload-Token": uploadToken }, signal: AbortSignal.timeout(20_000) });
  if (!complete.ok) throw new Error(`Upload completion failed (${complete.status}).`);
  const resultText = (await complete.text()).trim();
  return { uploaded: true, filename: path.basename(filePath), size: stats.size, maxDownloads, response: resultText };
}

async function screenshot() {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "neural-chat-screen-")); const target = path.join(work, "screen.png");
  try {
    if (process.platform === "win32" && process.env.NEURAL_CHAT_WINDOWS_SERVICE === "1") {
      const buffer = await trayScreenshot();
      return { buffer, source: "interactive-tray" };
    }
    if (process.platform === "win32") {
      const escaped = target.replace(/'/g, "''");
      const script = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); try{$g.CopyFromScreen($b.Left,$b.Top,0,0,$i.Size);$i.Save('${escaped}',[System.Drawing.Imaging.ImageFormat]::Png)}finally{$g.Dispose();$i.Dispose()}`;
      const shell = shellExecutable("powershell"); const result = await captureCommand(shell.program, [...shell.args, script], 30_000); if (result.exitCode !== 0) throw new Error(result.stderr.toString("utf8") || "Screenshot command failed.");
    } else if (process.platform === "darwin") {
      const result = await captureCommand("screencapture", ["-x", target], 30_000); if (result.exitCode !== 0) throw new Error(result.stderr.toString("utf8") || "Screenshot command failed.");
    } else {
      const tool = existsSync("/usr/bin/gnome-screenshot") ? "/usr/bin/gnome-screenshot" : existsSync("/usr/bin/import") ? "/usr/bin/import" : "";
      if (!tool) throw new Error("No supported screenshot utility was found (gnome-screenshot or ImageMagick import). ");
      const argv = tool.endsWith("gnome-screenshot") ? ["-f", target] : ["-window", "root", target];
      const result = await captureCommand(tool, argv, 30_000); if (result.exitCode !== 0) throw new Error(result.stderr.toString("utf8") || "Screenshot command failed.");
    }
    const buffer = await fs.readFile(target);
    return { buffer, source: "host" };
  } finally { await fs.rm(work, { recursive: true, force: true }).catch(() => undefined); }
}

async function trayScreenshot() {
  return new Promise<Buffer>((resolve, reject) => {
    const socket = createConnection("\\\\.\\pipe\\NeuralNetUI.HostAgent"); let response = ""; let settled = false;
    const finish = (error?: Error, value?: Buffer) => { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : resolve(value!); };
    socket.setTimeout(15_000, () => finish(new Error("The interactive tray screenshot bridge timed out.")));
    socket.on("connect", () => socket.write('{"action":"screenshot"}\n'));
    socket.on("data", chunk => { response += chunk.toString("utf8"); if (response.length > 70 * 1024 * 1024) return finish(new Error("The tray screenshot response was too large.")); const newline = response.indexOf("\n"); if (newline < 0) return; try { const payload = JSON.parse(response.slice(0, newline)) as { ok?: boolean; data?: string; error?: string }; if (!payload.ok || !payload.data) return finish(new Error(payload.error || "The tray screenshot bridge failed.")); finish(undefined, Buffer.from(payload.data, "base64")); } catch { finish(new Error("The tray screenshot bridge returned invalid data.")); } });
    socket.on("error", error => finish(new Error(`Unable to reach the interactive tray screenshot bridge: ${error.message}`)));
  });
}

export async function executeHostComputerTool(sessionKey: string, args: HostArgs, userId?: string): Promise<HostToolExecution> {
  if (!isHostComputerAvailable()) throw new Error("The host computer tool is unavailable in a containerized environment.");
  const action = stringArg(args, "action");
  if (action === "search_files") { const root = resolvedPath(args); return { result: await searchFiles(root, stringArg(args, "query", false) || "*", Math.max(1, Math.min(500, Number(args.max_results || 100)))) }; }
  if (action === "inspect_path") { const target = resolvedPath(args); const stats = await fs.lstat(target); return { result: { path: target, type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : stats.isSymbolicLink() ? "symlink" : "other", size: stats.size, createdAt: stats.birthtime.toISOString(), modifiedAt: stats.mtime.toISOString(), mode: stats.mode.toString(8), readable: await fs.access(target, constants.R_OK).then(() => true, () => false), writable: await fs.access(target, constants.W_OK).then(() => true, () => false) } }; }
  if (action === "read_file") { const target = resolvedPath(args); const stats = await fs.stat(target); if (!stats.isFile()) throw new Error("Path is not a regular file."); if (stats.size > MAX_READ_BYTES) throw new Error(`File exceeds the ${MAX_READ_BYTES}-byte read limit.`); const buffer = await fs.readFile(target); const encoding = args.encoding === "base64" ? "base64" : "utf8"; return { result: { path: target, encoding, size: buffer.length, content: buffer.toString(encoding) } }; }
  if (action === "write_file") { const target = resolvedPath(args); const encoding = args.encoding === "base64" ? "base64" : "utf8"; const data = Buffer.from(String(args.content || ""), encoding); await atomicWrite(target, data, args.overwrite === true); return { result: { path: target, written: data.length, atomic: true } }; }
  if (action === "copy") { const source = resolvedPath(args); const destination = resolvedPath(args, "destination"); await fs.cp(source, destination, { recursive: args.recursive === true, force: args.overwrite === true, errorOnExist: args.overwrite !== true, preserveTimestamps: true }); return { result: { source, destination, copied: true } }; }
  if (action === "rename") { const source = resolvedPath(args); const name = stringArg(args, "new_name"); if (name !== path.basename(name) || name === "." || name === "..") throw new Error("new_name must be a filename without a path."); const destination = path.join(path.dirname(source), name); await fs.access(destination).then(() => { throw new Error("The renamed destination already exists."); }, () => undefined); await fs.rename(source, destination); return { result: { source, destination, renamed: true } }; }
  if (action === "move") { const source = resolvedPath(args); const destination = resolvedPath(args, "destination"); await movePath(source, destination, args.overwrite === true); return { result: { source, destination, moved: true } }; }
  if (action === "delete") { const target = resolvedPath(args); assertNotFilesystemRoot(target); const stats = await fs.lstat(target); if (stats.isDirectory() && args.recursive !== true) await fs.rmdir(target); else await fs.rm(target, { recursive: args.recursive === true, force: false }); return { result: { path: target, deleted: true, recoverable: false } }; }
  if (action === "upload_temp") return { result: await uploadTemporary(resolvedPath(args), Math.max(1, Math.min(100, Number(args.max_downloads || 1)))) };
  if (action === "list_processes") { const session = processSessions.get(sessionKey); return { result: { processes: [...(session?.values() || [])].map(item => ({ pid: item.pid, name: item.name, program: item.program, startedAt: item.startedAt })) } }; }
  if (action === "start_process") {
    const program = stringArg(args, "program"); const argv = Array.isArray(args.arguments) ? args.arguments.map(String) : []; const cwd = args.cwd ? path.resolve(String(args.cwd)) : undefined;
    const child = spawn(program, argv, { cwd, detached: false, windowsHide: true, shell: false, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    if (!child.pid) throw new Error("The background program did not return a PID.");
    const session = processSessions.get(sessionKey) || new Map<number, ManagedProcess>(); processSessions.set(sessionKey, session);
    const managed = { child, pid: child.pid, name: stringArg(args, "process_name", false) || path.basename(program), program, startedAt: new Date().toISOString() }; session.set(child.pid, managed);
    child.once("exit", () => { session.delete(managed.pid); if (!session.size) processSessions.delete(sessionKey); }); child.unref();
    return { result: { pid: managed.pid, name: managed.name, program, startedAt: managed.startedAt } };
  }
  if (action === "kill_process") { const pid = Math.floor(Number(args.pid)); const session = processSessions.get(sessionKey); const managed = session?.get(pid); if (!managed) throw new Error("That PID was not started by the host tool in this conversation."); const signalled = managed.child.kill(); return { result: { pid, name: managed.name, signalled } }; }
  if (action === "run_shell") { const shell = shellExecutable(stringArg(args, "shell")); const command = stringArg(args, "command"); const timeout = Math.max(1, Math.min(300, Number(args.timeout_seconds || 60))) * 1000; const result = await captureCommand(shell.program, [...shell.args, command], timeout, args.cwd ? path.resolve(String(args.cwd)) : undefined); return { result: { shell: args.shell, exitCode: result.exitCode, stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8"), truncated: result.stdout.length >= MAX_OUTPUT_BYTES || result.stderr.length >= MAX_OUTPUT_BYTES } }; }
  if (action === "screenshot") {
    if (!userId) throw new Error("A storage owner is required for screenshots.");
    const captured = await screenshot();
    const stored = await saveGeneratedImage(captured.buffer, userId);
    return {
      result: { screenshot:true, mimeType:"image/png", size:captured.buffer.length, source:captured.source, attachment:stored.metadata, storage:"user" },
      content: [{ type:"text", text:`Current host-computer screenshot stored as ${stored.metadata.name}.` }, { type:"image_file", file_path:stored.path, mime_type:"image/png" }] satisfies ModelContentPart[],
    };
  }
  throw new Error(`Unknown host computer action: ${action}`);
}

export function closeHostComputerSession(sessionKey: string) {
  const session = processSessions.get(sessionKey); if (!session) return 0;
  let signalled = 0;
  for (const managed of session.values()) if (managed.child.kill()) signalled += 1;
  processSessions.delete(sessionKey);
  return signalled;
}
