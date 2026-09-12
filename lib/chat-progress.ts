import type { ChatWaitPhase, Locale } from "./types.ts";

/** Only call the server unresponsive after a real response timeout window, not a short token gap. */
export const SERVER_RESPONSE_TIMEOUT_MS = 30_000;

const labels: Record<Locale, Record<ChatWaitPhase, string>> = {
  ko: {
    "processing-prompt": "프롬프트를 처리중입니다",
    "waiting-session": "다른 세션이 종료되길 기다리는 중입니다",
    "freeing-space": "모델을 로드할 공간을 확보중입니다",
    "loading-model": "모델을 로드중입니다",
    "waiting-server": "서버 응답을 기다리는 중입니다",
    "preparing-response": "응답을 준비중입니다",
    "compacting-context": "컨텍스트를 압축하고 있습니다",
  },
  en: {
    "processing-prompt": "Processing the prompt",
    "waiting-session": "Waiting for another session to finish",
    "freeing-space": "Making room to load the model",
    "loading-model": "Loading the model",
    "waiting-server": "Waiting for the server to respond",
    "preparing-response": "Preparing the response",
    "compacting-context": "Compacting context",
  },
};
export const chatWaitLabel = (phase: ChatWaitPhase, locale: Locale) => labels[locale][phase];

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

export function delayWithSignal(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function withSlowProgress<T>(operation: () => Promise<T>, onSlow: () => void, timeoutMs = SERVER_RESPONSE_TIMEOUT_MS): Promise<T> {
  const timer = setTimeout(onSlow, timeoutMs);
  try { return await operation(); } finally { clearTimeout(timer); }
}

/** Retry only connection refusal / DNS failure, where no inference was dispatched. */
export async function progressFetch(url: string, init: RequestInit, onPhase: (phase: ChatWaitPhase) => void, phase: ChatWaitPhase, request: typeof fetch = fetch, serverResponseTimeoutMs = SERVER_RESPONSE_TIMEOUT_MS): Promise<Response> {
  const signal = init.signal || AbortSignal.timeout(300_000);
  const started = Date.now();
  for (;;) {
    signal.throwIfAborted(); onPhase(phase);
    try {
      const response = await withSlowProgress(() => request(url, { ...init, signal }), () => onPhase("waiting-server"), serverResponseTimeoutMs);
      onPhase(phase); return response;
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      if (signal.aborted || !["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code || "") || Date.now() - started >= 30_000) throw error;
      await delayWithSignal(1_000, signal);
    }
  }
}
