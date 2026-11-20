import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "./database.ts";
import { describeTarget, executableName, fileExists, readExecutableTarget, runExecutable, targetMatchesHost, toolsDir } from "./managed-binaries.ts";
import { remainingStorageBytes, saveHostFile } from "./uploads.ts";
import {
  chooseTrack, estimatedSize, formatSelector, infoHeader, languagesSummary, page, parseSubtitles, pickFormat, SubtitleError, transcriptText, videoUrl, type VideoInfo,
} from "./youtube-subtitles.ts";

/**
 * Built-in YouTube tool: subtitles as text and video downloads into private storage, through a yt-dlp binary the
 * administrator installs and updates from Harness settings. Each account may keep its own YouTube cookies for videos
 * that need a signed-in viewer; a private copy of them is handed to each yt-dlp run because yt-dlp writes the jar back.
 */

export const ytDlpDir = path.join(toolsDir, "yt-dlp");
export const ytDlpPath = path.join(ytDlpDir, executableName("yt-dlp"));
const cookiesDir = path.join(dataDir, "youtube-cookies");
const MAX_COOKIES_BYTES = 1024 * 1024;

export type YoutubeSettings = { maxChars: number; preferredLanguages: string[]; maxDownloadMb: number };
export type YtDlpStatus = { installed: boolean; version?: string; target?: string; matchesHost?: boolean; updatedAt?: string; ffmpeg: boolean; error?: string };

/** The release asset for this server, from https://github.com/yt-dlp/yt-dlp/releases. */
export function ytDlpAssetName(platform = process.platform, arch = process.arch) {
  if (platform === "linux") return arch === "arm64" ? "yt-dlp_linux_aarch64" : arch === "x64" ? "yt-dlp_linux" : undefined;
  if (platform === "darwin") return "yt-dlp_macos";
  if (platform === "win32") return arch === "arm64" ? "yt-dlp_arm64.exe" : arch === "x64" ? "yt-dlp.exe" : arch === "ia32" ? "yt-dlp_x86.exe" : undefined;
  return undefined;
}

let ffmpegCache: { at: number; available: boolean } | undefined;
async function ffmpegAvailable() {
  if (ffmpegCache && Date.now() - ffmpegCache.at < 300_000) return ffmpegCache.available;
  let available = false;
  try { available = (await runExecutable("ffmpeg", ["-version"], { timeoutMs: 10_000 })).code === 0; } catch { available = false; }
  ffmpegCache = { at: Date.now(), available };
  return available;
}

export async function ytDlpStatus(): Promise<YtDlpStatus> {
  const ffmpeg = await ffmpegAvailable();
  try {
    const stats = await fs.stat(ytDlpPath);
    const target = await readExecutableTarget(ytDlpPath);
    const matchesHost = targetMatchesHost(target);
    let version: string | undefined, error: string | undefined;
    if (matchesHost) {
      try { const result = await runExecutable(ytDlpPath, ["--version"], { timeoutMs: 30_000 }); if (result.code === 0) version = result.stdout.trim(); else error = (result.stderr || result.stdout).trim().slice(0, 500); }
      catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    }
    return { installed: true, target: describeTarget(target), matchesHost, updatedAt: stats.mtime.toISOString(), ffmpeg, ...(version ? { version } : {}), ...(error ? { error } : {}) };
  } catch { return { installed: false, ffmpeg }; }
}

export async function ytDlpAvailable() { return fileExists(ytDlpPath); }

/**
 * Installs or updates yt-dlp to the latest stable release for this server. The download is checked against the
 * release's SHA2-256SUMS and against this server's CPU before it replaces the current binary.
 */
export async function updateYtDlp(signal?: AbortSignal): Promise<YtDlpStatus> {
  const asset = ytDlpAssetName();
  if (!asset) throw new Error(`yt-dlp has no release build for ${process.platform}/${process.arch}.`);
  const release = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
  const timeout = AbortSignal.timeout(10 * 60_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const sums = await fetch(`${release}/SHA2-256SUMS`, { signal: combined });
  if (!sums.ok) throw new Error(`The yt-dlp checksum list could not be downloaded (${sums.status}).`);
  const expected = (await sums.text()).split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts[1]?.replace(/^\*/, "") === asset)?.[0]?.toLowerCase();
  if (!expected) throw new Error(`The yt-dlp release does not list ${asset}.`);
  const response = await fetch(`${release}/${asset}`, { signal: combined });
  if (!response.ok || !response.body) throw new Error(`yt-dlp could not be downloaded (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("The downloaded yt-dlp does not match the release checksum.");
  await fs.mkdir(ytDlpDir, { recursive: true });
  const temporary = `${ytDlpPath}.${randomUUID()}.download`;
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o755 });
    const target = await readExecutableTarget(temporary);
    if (!targetMatchesHost(target)) throw new Error(`The downloaded yt-dlp is built for ${describeTarget(target)}, not this server.`);
    await fs.rename(temporary, ytDlpPath);
  } catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error; }
  return ytDlpStatus();
}

export async function removeYtDlp() { await fs.unlink(ytDlpPath).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }

// ---------------------------------------------------------------------------------------------------------------
// Server-wide cookies, managed with yt-dlp in Harness settings

const sharedCookiesPath = path.join(cookiesDir, "shared.txt");
/** Earlier releases kept one file per account; such a file is still used when no server-wide file is set. */
const personalCookiesPath = (userId: string) => path.join(cookiesDir, `${userId.replace(/[^A-Za-z0-9_-]/g, "_")}.txt`);

export async function youtubeCookiesStatus() {
  try { const stats = await fs.stat(sharedCookiesPath); return { present: true, updatedAt: stats.mtime.toISOString(), size: stats.size }; }
  catch { return { present: false }; }
}

/** Stores the server's cookies.txt (Netscape format, as exported by browser extensions). */
export async function saveYoutubeCookies(text: string) {
  const content = text.replace(/^﻿/, "");
  if (Buffer.byteLength(content) > MAX_COOKIES_BYTES) throw new Error("The cookie file is larger than 1 MB.");
  const lines = content.split(/\r?\n/).filter(line => line.trim() && !line.startsWith("#") || line.startsWith("#HttpOnly_"));
  const valid = lines.filter(line => line.replace(/^#HttpOnly_/, "").split("\t").length >= 7);
  if (!valid.length) throw new Error("This is not a Netscape cookies.txt file. Export the cookies of youtube.com in the Netscape format.");
  if (!valid.some(line => /(^|\.)youtube\.com\t|(^|\.)google\.com\t/i.test(line.replace(/^#HttpOnly_/, "")))) throw new Error("The file has no youtube.com or google.com cookies.");
  await fs.mkdir(cookiesDir, { recursive: true, mode: 0o700 });
  const target = sharedCookiesPath, temporary = `${target}.${randomUUID()}.tmp`;
  const normalized = content.startsWith("# Netscape HTTP Cookie File") || content.startsWith("# HTTP Cookie File") ? content : `# Netscape HTTP Cookie File\n${content}`;
  await fs.writeFile(temporary, normalized, { mode: 0o600, flag: "wx" });
  await fs.rename(temporary, target);
  return youtubeCookiesStatus();
}

export async function deleteYoutubeCookies() { await fs.unlink(sharedCookiesPath).catch(() => undefined); }

// ---------------------------------------------------------------------------------------------------------------
// Running yt-dlp

async function workDir() {
  const dir = path.join(dataDir, "tmp", `yt-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

async function baseArgs(userId: string, work: string) {
  const args = ["--no-playlist", "--no-warnings", "--ignore-config", "--no-cache-dir", "--socket-timeout", "20", "--retries", "2",
    // YouTube's player needs a JavaScript runtime for the full format list; Node is always here.
    "--js-runtimes", `node:${process.execPath}`];
  const cookies = await fileExists(sharedCookiesPath) ? sharedCookiesPath : await fileExists(personalCookiesPath(userId)) ? personalCookiesPath(userId) : undefined;
  if (cookies) {
    const copy = path.join(work, "cookies.txt");
    await fs.copyFile(cookies, copy); await fs.chmod(copy, 0o600).catch(() => undefined);
    args.push("--cookies", copy);
  }
  return args;
}

function ytDlpError(stderr: string, fallback: string) {
  const line = stderr.split(/\r?\n/).map(item => item.trim()).filter(Boolean).reverse().find(item => item.startsWith("ERROR:")) || stderr.trim().split(/\r?\n/).at(-1) || "";
  const message = line.replace(/^ERROR:\s*/, "").trim();
  const hint = /sign in to confirm|not a bot|cookies/i.test(message) ? " Add your YouTube cookies in Settings > General > YouTube cookies and try again." : "";
  return new SubtitleError(`${fallback}${message ? `: ${message}` : "."}${hint}`);
}

async function videoInfo(userId: string, canonical: string, work: string, signal: AbortSignal): Promise<VideoInfo> {
  if (!await ytDlpAvailable()) throw new SubtitleError("yt-dlp is not installed. An administrator can install it in Harness settings.");
  const result = await runExecutable(ytDlpPath, [...await baseArgs(userId, work), "--skip-download", "--dump-single-json", canonical], { timeoutMs: 120_000, signal, maxOutput: 64 * 1024 * 1024 });
  if (result.code !== 0) throw ytDlpError(result.stderr, "YouTube did not return this video");
  try { return JSON.parse(result.stdout) as VideoInfo; } catch { throw new SubtitleError("yt-dlp returned unreadable video information."); }
}

export async function youtubeSubtitles(input: { userId: string; url: string; language?: string; timestamps?: boolean; offset?: number; settings: YoutubeSettings; signal: AbortSignal }) {
  const { url: canonical } = videoUrl(input.url);
  const work = await workDir();
  try {
    const info = await videoInfo(input.userId, canonical, work, input.signal);
    const track = chooseTrack(info, (input.language || "").trim(), input.settings.preferredLanguages);
    const chosen = pickFormat(track);
    const response = await fetch(chosen.url, { signal: AbortSignal.any([input.signal, AbortSignal.timeout(60_000)]) });
    if (!response.ok) throw new SubtitleError(`The subtitle file could not be downloaded (${response.status}).`);
    const raw = await response.text();
    const text = transcriptText(parseSubtitles(raw, chosen.ext), input.timestamps === true);
    if (!text) throw new SubtitleError("The subtitle track is empty.");
    const offset = Math.max(0, Math.floor(input.offset || 0));
    const window = page(text, offset, input.settings.maxChars);
    const kind = track.kind === "manual" ? "uploaded subtitles" : track.translated ? "automatic captions, machine-translated" : "automatic captions";
    const lines = [...infoHeader(info, canonical), `Subtitles: ${track.language} (${kind})`,
      `Characters ${offset}–${offset + window.text.length} of ${text.length}${window.next !== undefined ? `; call again with offset=${window.next} for the rest` : "; this is the end"}`];
    return `${lines.join("\n")}\n\n${window.text}`;
  } finally { await fs.rm(work, { recursive: true, force: true }).catch(() => undefined); }
}

export async function youtubeLanguages(input: { userId: string; url: string; signal: AbortSignal }) {
  const { url: canonical } = videoUrl(input.url);
  const work = await workDir();
  try {
    const info = await videoInfo(input.userId, canonical, work, input.signal);
    const summary = languagesSummary(info);
    return [...infoHeader(info, canonical),
      `Spoken language: ${info.language || summary.autoSpoken.join(", ") || "unknown"}`,
      `Uploaded subtitles: ${summary.manual.join(", ") || "none"}`,
      `Automatic captions (spoken language): ${summary.autoSpoken.join(", ") || "none"}`,
      `Machine-translated automatic captions: ${summary.autoTranslated} languages`].join("\n");
  } finally { await fs.rm(work, { recursive: true, force: true }).catch(() => undefined); }
}

const human = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await folderSize(full);
    else total += await fs.stat(full).then(stats => stats.size, () => 0);
  }
  return total;
}

/**
 * Downloads a video into private storage. The limit is the smaller of what is left in the account's storage and the
 * harness's per-video cap; the download stops as soon as its files pass it, and nothing is kept then.
 */
export async function downloadYoutubeVideo(input: { userId: string; url: string; maxHeight?: number; settings: YoutubeSettings; signal: AbortSignal; onProgress?: (message: string, progress?: number, total?: number) => void }) {
  const { url: canonical } = videoUrl(input.url);
  const remaining = remainingStorageBytes(input.userId);
  const limit = Math.min(remaining, input.settings.maxDownloadMb * 1024 * 1024);
  if (remaining <= 0) throw new SubtitleError("Private storage is full, so the video cannot be saved.");
  const work = await workDir();
  const output = path.join(work, "out");
  try {
    await fs.mkdir(output, { recursive: true });
    const canMerge = await ffmpegAvailable();
    const selector = formatSelector(input.maxHeight, canMerge);
    input.onProgress?.("Looking up the video");
    const args = await baseArgs(input.userId, work);
    const probe = await runExecutable(ytDlpPath, [...args, "-f", selector, "--skip-download", "--dump-single-json", canonical], { timeoutMs: 120_000, signal: input.signal, maxOutput: 64 * 1024 * 1024 });
    if (probe.code !== 0) throw ytDlpError(probe.stderr, "YouTube did not return this video");
    const info = JSON.parse(probe.stdout) as VideoInfo;
    const expected = estimatedSize(info);
    if (expected && expected > limit) throw new SubtitleError(`The video is about ${human(expected)}, more than the ${human(limit)} that can be saved${limit === remaining ? " (space left in private storage)" : ""}. Ask for a lower max_height.`);
    const file = await new Promise<string>((resolve, reject) => {
      const child = spawn(ytDlpPath, [...args, "-f", selector, "--newline", "--no-part", "--max-filesize", String(limit), "-o", path.join(output, "%(title).150B [%(id)s].%(ext)s"),
        "--print", "after_move:filepath", canonical], { cwd: work, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let stdout = "", stderr = "", failure: Error | undefined, shownAt = 0;
      const stop = (error: Error) => { if (!failure) { failure = error; child.kill("SIGKILL"); } };
      const abort = () => stop(input.signal.reason instanceof Error ? input.signal.reason : new Error("The download was stopped."));
      input.signal.addEventListener("abort", abort, { once: true });
      // yt-dlp's own limit applies per format; the folder is also watched so merged or unannounced sizes stay bounded.
      const watcher = setInterval(() => { void folderSize(output).then(size => { if (size > limit) stop(new SubtitleError(`The download passed the ${human(limit)} that can be saved, so it was stopped and nothing was kept.`)); }); }, 2000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        const lines = stdout.split(/\r?\n/);
        for (const line of lines.slice(-4)) {
          const match = /\[download\]\s+([\d.]+)% of\s+~?\s*([\d.]+)([KMG]i?B)/.exec(line);
          if (match && Date.now() - shownAt > 1000) {
            shownAt = Date.now();
            const unit = { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3 }[match[3]] || 1;
            const total = Number(match[2]) * unit;
            input.onProgress?.(`Downloading ${match[1]}% of ${human(total)}`, Number(match[1]), 100);
          } else if (/^\[(Merger|ExtractAudio|VideoConvertor|FixupM3u8)\]/.test(line) && Date.now() - shownAt > 1000) { shownAt = Date.now(); input.onProgress?.("Merging video and audio"); }
        }
        if (stdout.length > 1_000_000) stdout = stdout.slice(-200_000);
      });
      child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 20_000) stderr += chunk.toString("utf8"); });
      child.on("error", error => stop(error));
      child.on("close", code => {
        clearInterval(watcher); input.signal.removeEventListener("abort", abort);
        if (failure) return reject(failure);
        if (code !== 0) return reject(ytDlpError(stderr, "The download failed"));
        const printed = stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line && path.isAbsolute(line) && line.startsWith(output)).at(-1);
        if (!printed) return reject(new SubtitleError("The download did not produce a file (it may have been larger than the limit)."));
        resolve(printed);
      });
    });
    const size = (await fs.stat(file)).size;
    if (size > remainingStorageBytes(input.userId)) throw new SubtitleError(`The video is ${human(size)}, more than the space left in private storage, so it was not saved.`);
    input.onProgress?.("Saving to private storage");
    const stored = await saveHostFile(file, input.userId, path.basename(file));
    return {
      text: [`Downloaded: ${info.title || path.basename(file)}`, `Channel: ${info.channel || info.uploader || "(unknown)"}`,
        `Resolution: ${info.resolution || "audio only"}; format: ${info.format_id || "?"}; size: ${human(size)}`,
        `Saved "${stored.metadata.name}" to the user's private storage. Link for the user: ${stored.markdown}`].join("\n"),
      saved: { id: stored.metadata.id, name: stored.metadata.name, size, mimeType: stored.metadata.mimeType, url: stored.metadata.url, markdown: stored.markdown },
    };
  } finally { await fs.rm(work, { recursive: true, force: true }).catch(() => undefined); }
}
