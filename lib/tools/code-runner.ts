/**
 * The code runner's contract, shared by the server provider and the browser that runs the code. The server never
 * executes anything: it records the request on the tool event, waits, and passes what the browser reports back to
 * the model after bounding it again.
 */

export type CodeLanguage = "javascript" | "python";

export const CODE_FUNCTIONS: Record<string, CodeLanguage> = { run_javascript: "javascript", run_python: "python" };
export const MAX_CODE_CHARS = 100_000;
/** Each captured stream and the return value are cut to this many characters before they reach the model. */
export const MAX_OUTPUT_CHARS = 20_000;
export const DEFAULT_CODE_TIMEOUT_SECONDS = 30;
/** Pyodide is fetched from this pinned CDN release the first time Python runs in a tab, then cached by the browser. */
export const PYODIDE_VERSION = "0.29.5";
export const PYODIDE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** What the server records on the tool event for the browser to run. */
export interface CodeRunRequest { language: CodeLanguage; code: string; timeoutSeconds: number }

/** What the browser reports back, after `normalizeCodeRunResult`. */
export interface CodeRunResult {
  language: CodeLanguage;
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Display form of the last expression (Python) or the returned value (JavaScript), when there is one. */
  result?: string;
  error?: string;
  timedOut?: boolean;
  durationMs?: number;
  truncated?: boolean;
}

function bounded(value: unknown, flags: { truncated: boolean }) {
  const text = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  flags.truncated = true;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n[Output truncated after ${MAX_OUTPUT_CHARS} characters]`;
}

/** Accepts anything a browser might send and keeps only the known, bounded fields. */
export function normalizeCodeRunResult(raw: unknown, language: CodeLanguage): CodeRunResult {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const flags = { truncated: source.truncated === true };
  const stdout = bounded(source.stdout, flags), stderr = bounded(source.stderr, flags);
  const result = source.result === undefined || source.result === null ? undefined : bounded(source.result, flags);
  const error = source.error === undefined || source.error === null || source.error === "" ? undefined : bounded(source.error, flags);
  const timedOut = source.timedOut === true;
  const duration = Number(source.durationMs);
  return {
    language, ok: !error && !timedOut, stdout, stderr,
    ...(result !== undefined ? { result } : {}),
    ...(error ? { error } : {}),
    ...(timedOut ? { timedOut } : {}),
    ...(Number.isFinite(duration) && duration >= 0 ? { durationMs: Math.round(duration) } : {}),
    ...(flags.truncated ? { truncated: true } : {}),
  };
}

/** The request as recorded on a tool event, or undefined when the event does not hold one. */
export function readCodeRunRequest(value: unknown): CodeRunRequest | undefined {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (source.language !== "javascript" && source.language !== "python") return undefined;
  if (typeof source.code !== "string" || !source.code.trim()) return undefined;
  const timeout = Math.floor(Number(source.timeoutSeconds));
  return { language: source.language, code: source.code.slice(0, MAX_CODE_CHARS), timeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 300) : DEFAULT_CODE_TIMEOUT_SECONDS };
}
