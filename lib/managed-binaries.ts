import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { dataDir } from "./database.ts";

/**
 * Executables an administrator places in the harness (Obscura, yt-dlp). They live under data/tools so they survive a
 * container rebuild, and every file is checked against this server's operating system and CPU before it is kept.
 */
export const toolsDir = path.join(dataDir, "tools");

export type ExecutableOs = "linux" | "darwin" | "win32";
export type ExecutableArch = "x64" | "arm64" | "ia32" | "arm" | "unknown";
export type ExecutableTarget = { os: ExecutableOs; archs: ExecutableArch[] };

const ELF_MACHINES: Record<number, ExecutableArch> = { 0x3e: "x64", 0xb7: "arm64", 0x03: "ia32", 0x28: "arm" };
const MACHO_CPUS: Record<number, ExecutableArch> = { 0x01000007: "x64", 0x0100000c: "arm64", 0x07: "ia32", 0x0c: "arm" };
const PE_MACHINES: Record<number, ExecutableArch> = { 0x8664: "x64", 0xaa64: "arm64", 0x014c: "ia32", 0x01c4: "arm" };

/** Reads the executable header (ELF, Mach-O including universal binaries, or PE). Undefined when it is not one. */
export function executableTarget(header: Buffer): ExecutableTarget | undefined {
  if (header.length >= 20 && header.readUInt32BE(0) === 0x7f454c46) {
    const little = header[5] !== 2;
    const machine = little ? header.readUInt16LE(18) : header.readUInt16BE(18);
    return { os: "linux", archs: [ELF_MACHINES[machine] || "unknown"] };
  }
  if (header.length >= 8) {
    const magicLE = header.readUInt32LE(0);
    if (magicLE === 0xfeedfacf || magicLE === 0xfeedface) return { os: "darwin", archs: [MACHO_CPUS[header.readInt32LE(4)] || "unknown"] };
    if (header.readUInt32BE(0) === 0xcafebabe) {
      const count = header.readUInt32BE(4);
      // Java class files share this magic; a universal binary lists only a handful of architectures.
      if (count > 0 && count < 16 && header.length >= 8 + count * 20) {
        const archs = Array.from({ length: count }, (_, index) => MACHO_CPUS[header.readInt32BE(8 + index * 20)] || "unknown");
        return { os: "darwin", archs };
      }
    }
  }
  if (header.length >= 0x40 && header.toString("latin1", 0, 2) === "MZ") {
    const offset = header.readUInt32LE(0x3c);
    if (offset + 6 <= header.length && header.toString("latin1", offset, offset + 4) === "PE\0\0") {
      return { os: "win32", archs: [PE_MACHINES[header.readUInt16LE(offset + 4)] || "unknown"] };
    }
  }
  return undefined;
}

export function hostTarget(): { os: string; arch: string } { return { os: process.platform, arch: process.arch }; }

export function targetMatchesHost(target: ExecutableTarget | undefined, host = hostTarget()) {
  return Boolean(target && target.os === host.os && target.archs.includes(host.arch as ExecutableArch));
}

export function describeTarget(target: ExecutableTarget | undefined) {
  if (!target) return "not an executable";
  return `${target.os}/${target.archs.join("+")}`;
}

export async function readExecutableTarget(file: string) {
  const handle = await fs.open(file, "r");
  try {
    const header = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return executableTarget(header.subarray(0, bytesRead));
  } finally { await handle.close(); }
}

export const executableName = (name: string) => process.platform === "win32" ? `${name}.exe` : name;

/**
 * Streams an uploaded executable to a temporary file next to its destination, checks its header against this server
 * and only then moves it into place, so a wrong file never replaces a working one.
 */
export async function installUploadedExecutable(body: WebReadableStream<Uint8Array> | ReadableStream<Uint8Array>, destination: string, maxBytes: number) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.upload`;
  let received = 0;
  try {
    const source = Readable.fromWeb(body as WebReadableStream<Uint8Array>);
    source.on("data", (chunk: Buffer) => { received += chunk.length; if (received > maxBytes) source.destroy(new Error(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`)); });
    await pipeline(source, createWriteStream(temporary, { mode: 0o700, flags: "wx" }));
    if (!received) throw new Error("The uploaded file is empty.");
    const target = await readExecutableTarget(temporary);
    const host = hostTarget();
    if (!target) throw new Error("The uploaded file is not an executable (ELF, Mach-O or PE).");
    if (!targetMatchesHost(target, host)) throw new Error(`The executable is built for ${describeTarget(target)}, but this server is ${host.os}/${host.arch}.`);
    await fs.chmod(temporary, 0o755);
    await fs.rename(temporary, destination);
    return { size: received, target };
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export type RunResult = { code: number | null; stdout: string; stderr: string };

/** Runs an executable with a time limit and bounded output. Never goes through a shell. */
export function runExecutable(file: string, args: string[], options: { timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv; maxOutput?: number } = {}): Promise<RunResult> {
  const maxOutput = options.maxOutput ?? 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "", settled = false;
    const finish = (error?: Error, code: number | null = null) => {
      if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve({ code, stdout, stderr });
    };
    const abort = () => { child.kill("SIGKILL"); finish(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Stopped.")); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error(`${path.basename(file)} did not finish within ${Math.round((options.timeoutMs ?? 30_000) / 1000)} seconds.`)); }, options.timeoutMs ?? 30_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < maxOutput) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < maxOutput) stderr += chunk.toString("utf8"); });
    child.on("error", error => finish(error));
    child.on("close", code => finish(undefined, code));
  });
}

export async function fileExists(file: string) {
  try { return (await fs.stat(file)).isFile(); } catch { return false; }
}
