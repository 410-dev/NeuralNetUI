import { PYODIDE_BASE_URL, type CodeLanguage, type CodeRunRequest } from "./tools/code-runner.ts";

/**
 * Runs model-written code in this browser, never on the server.
 *
 * Isolation: every language gets a hidden iframe sandboxed with `allow-scripts` only, so it has an opaque origin and
 * cannot read the app's cookies, storage or DOM. Its Content-Security-Policy blocks all network access (Python may
 * reach only the pinned Pyodide CDN). The code itself runs in a Web Worker inside that iframe, which keeps the page
 * responsive and lets a timeout stop runaway code by terminating the worker.
 */

const CDN_ORIGIN = new URL(PYODIDE_BASE_URL).origin;

/** Worker body for JavaScript. A fresh worker runs each call, so nothing carries over between calls. */
const JAVASCRIPT_WORKER = `
const AsyncFunction = (async () => {}).constructor;
const show = value => {
  if (typeof value === "string") return value;
  try { const text = JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() + "n" : item, 2); return text === undefined ? String(value) : text; }
  catch { return String(value); }
};
self.onmessage = async event => {
  const { id, code } = event.data;
  const stdout = [], stderr = [];
  const write = target => (...items) => target.push(items.map(show).join(" "));
  const sandboxConsole = { log: write(stdout), info: write(stdout), debug: write(stdout), table: write(stdout), dir: write(stdout), warn: write(stderr), error: write(stderr) };
  self.postMessage({ id, type: "started" });
  const started = performance.now();
  try {
    const value = await new AsyncFunction("console", code)(sandboxConsole);
    self.postMessage({ id, type: "done", stdout: stdout.join("\\n"), stderr: stderr.join("\\n"), result: value === undefined ? undefined : show(value), durationMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ id, type: "done", stdout: stdout.join("\\n"), stderr: stderr.join("\\n"), error: error && error.stack ? String(error.stack) : String(error), durationMs: performance.now() - started });
  }
};`;

/** Worker body for Python. The interpreter stays loaded for the tab; each call gets fresh globals. */
const PYTHON_WORKER = `
const BASE = ${JSON.stringify(PYODIDE_BASE_URL)};
let ready;
const load = () => { importScripts(BASE + "pyodide.js"); return loadPyodide({ indexURL: BASE }); };
self.onmessage = async event => {
  const { id, code } = event.data;
  const stdout = [], stderr = [];
  let python;
  try { python = await (ready ||= load()); }
  catch (error) { ready = undefined; self.postMessage({ id, type: "done", stdout: "", stderr: "", error: "Python could not be loaded in this browser: " + String(error && error.message || error) }); return; }
  python.setStdout({ batched: line => stdout.push(line) });
  python.setStderr({ batched: line => stderr.push(line) });
  try { await python.loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: line => stderr.push(line) }); }
  catch (error) { stderr.push(String(error && error.message || error)); }
  self.postMessage({ id, type: "started" });
  const started = performance.now();
  const globals = python.globals.get("dict")();
  try {
    const value = await python.runPythonAsync(code, { globals });
    let result;
    if (value !== undefined) {
      result = python.pyimport("builtins").repr(value);
      if (value && typeof value.destroy === "function") value.destroy();
    }
    self.postMessage({ id, type: "done", stdout: stdout.join("\\n"), stderr: stderr.join("\\n"), result, durationMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ id, type: "done", stdout: stdout.join("\\n"), stderr: stderr.join("\\n"), error: String(error && error.message || error), durationMs: performance.now() - started });
  } finally { globals.destroy(); }
};`;

/** The iframe document: receives runs from the app, starts the worker, and enforces the time limit. */
function frameDocument(language: CodeLanguage) {
  const network = language === "python" ? CDN_ORIGIN : "'none'";
  const scripts = language === "python" ? ` ${CDN_ORIGIN}` : "";
  const policy = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:${scripts}; worker-src blob:; connect-src ${network}`;
  const source = language === "python" ? PYTHON_WORKER : JAVASCRIPT_WORKER;
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><script>
const SOURCE = ${JSON.stringify(source)};
const KEEP_WORKER = ${language === "python"};
let worker; const runs = new Map();
const reply = message => parent.postMessage(message, "*");
const stop = () => { if (worker) worker.terminate(); worker = undefined; };
function spawn() {
  worker = new Worker(URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" })));
  worker.onmessage = event => {
    const message = event.data || {}; const run = runs.get(message.id); if (!run) return;
    if (message.type === "started") { run.timer = setTimeout(() => { runs.delete(message.id); stop(); reply({ id: message.id, stdout: "", stderr: "", timedOut: true, error: "Stopped after " + run.timeoutMs / 1000 + " seconds." }); }, run.timeoutMs); return; }
    clearTimeout(run.timer); runs.delete(message.id); if (!KEEP_WORKER) stop();
    const { type, ...result } = message; reply(result);
  };
  worker.onerror = event => { event.preventDefault(); for (const [id, run] of runs) { clearTimeout(run.timer); reply({ id, stdout: "", stderr: "", error: event.message || "The sandbox worker failed." }); } runs.clear(); stop(); };
}
addEventListener("message", event => {
  if (event.source !== parent || !event.data || typeof event.data.id !== "string") return;
  runs.set(event.data.id, { timeoutMs: event.data.timeoutMs });
  try { if (!worker) spawn(); worker.postMessage({ id: event.data.id, code: event.data.code }); }
  catch (error) { runs.delete(event.data.id); reply({ id: event.data.id, stdout: "", stderr: "", error: "The browser could not start a sandbox worker: " + String(error && error.message || error) }); }
});
reply({ type: "ready" });
</script>`;
}

type Frame = { iframe: HTMLIFrameElement; ready: Promise<void> };
const frames: Partial<Record<CodeLanguage, Frame>> = {};

function frameFor(language: CodeLanguage): Frame {
  const existing = frames[language];
  if (existing && existing.iframe.isConnected) return existing;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.display = "none";
  iframe.srcdoc = frameDocument(language);
  const ready = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { window.removeEventListener("message", listen); reject(new Error("The code sandbox did not start.")); }, 10_000);
    function listen(event: MessageEvent) {
      if (event.source !== iframe.contentWindow || event.data?.type !== "ready") return;
      window.clearTimeout(timer); window.removeEventListener("message", listen); resolve();
    }
    window.addEventListener("message", listen);
  });
  document.body.appendChild(iframe);
  const frame = { iframe, ready };
  frames[language] = frame;
  return frame;
}

function discard(language: CodeLanguage) {
  frames[language]?.iframe.remove();
  delete frames[language];
}

/** Extra time the app waits beyond the code's own limit: Python's first load downloads about 11 MB. */
const STARTUP_ALLOWANCE_MS: Record<CodeLanguage, number> = { javascript: 15_000, python: 180_000 };

/** Runs one request and resolves with the raw report, which the caller passes through `normalizeCodeRunResult`. */
export async function runInBrowserSandbox(request: CodeRunRequest): Promise<Record<string, unknown>> {
  const frame = frameFor(request.language);
  try { await frame.ready; }
  catch (error) { discard(request.language); return { stdout: "", stderr: "", error: error instanceof Error ? error.message : String(error) }; }
  const id = crypto.randomUUID();
  const timeoutMs = request.timeoutSeconds * 1000;
  return new Promise(resolve => {
    const guard = window.setTimeout(() => {
      window.removeEventListener("message", listen);
      discard(request.language);
      resolve({ stdout: "", stderr: "", timedOut: true, error: "The browser sandbox did not answer in time." });
    }, timeoutMs + STARTUP_ALLOWANCE_MS[request.language]);
    function listen(event: MessageEvent) {
      if (event.source !== frame.iframe.contentWindow || event.data?.id !== id) return;
      window.clearTimeout(guard); window.removeEventListener("message", listen);
      resolve(event.data as Record<string, unknown>);
    }
    window.addEventListener("message", listen);
    frame.iframe.contentWindow?.postMessage({ id, code: request.code, timeoutMs }, "*");
  });
}
