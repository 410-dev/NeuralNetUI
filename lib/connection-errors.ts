import type { ConnectionDriver } from "./types.ts";

/**
 * Why a model server's listing could not be used. `unreachable` and `timeout` mean nothing answered;
 * every other code means the server answered with something unusable, which the UI shows as an error.
 */
export type ConnectionFailureCode = "unreachable" | "timeout" | "invalid-url" | "unauthorized" | "not-found" | "http" | "server" | "invalid-json" | "invalid-shape" | "unexpected";
export type ConnectionFailure = { code: ConnectionFailureCode; status?: number; detail: string };

export class ConnectionError extends Error {
  readonly failure: ConnectionFailure;
  constructor(failure: ConnectionFailure) { super(failure.detail); this.name = "ConnectionError"; this.failure = failure; }
}

/** True when the failure came from a server that answered, as opposed to one that could not be reached. */
export function serverAnswered(failure: ConnectionFailure) { return failure.code !== "unreachable" && failure.code !== "timeout"; }

export function httpFailure(status: number, statusText = ""): ConnectionFailure {
  const detail = `HTTP ${status}${statusText ? ` ${statusText}` : ""}`;
  if (status === 401 || status === 403) return { code: "unauthorized", status, detail };
  if (status === 404) return { code: "not-found", status, detail };
  return { code: status >= 500 ? "server" : "http", status, detail };
}

export function transportFailure(error: unknown): ConnectionFailure {
  if (error instanceof ConnectionError) return error.failure;
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "TimeoutError" || name === "AbortError") return { code: "timeout", detail: message };
  if (error instanceof TypeError && /invalid url|failed to parse url/i.test(`${message} ${String((error as { cause?: unknown }).cause || "")}`)) return { code: "invalid-url", detail: message };
  return { code: "unreachable", detail: message };
}

/** Reads a listing body as JSON, naming what actually arrived when it is not JSON. */
export async function readListingJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch {
    const type = response.headers.get("content-type") || "";
    const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 120);
    throw new ConnectionError({ code: "invalid-json", status: response.status, detail: `${type ? `${type}: ` : ""}${excerpt || "(empty body)"}` });
  }
}

/** The model array each driver's listing carries, or undefined when the body has another shape. */
export function listingModels(driver: ConnectionDriver, payload: unknown): unknown[] | undefined {
  const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[driver === "lmstudio" ? "models" : "data"] : undefined;
  return Array.isArray(raw) ? raw : undefined;
}

export function invalidShapeFailure(driver: ConnectionDriver): ConnectionFailure {
  return { code: "invalid-shape", detail: driver === "lmstudio" ? "The response has no \"models\" array." : "The response has no \"data\" array." };
}

const FAILURE_TEXT: Record<ConnectionFailureCode, { ko: string; en: string }> = {
  unreachable: { ko: "서버에 연결할 수 없습니다. 주소와 포트, 서버가 실행 중인지 확인하세요.", en: "The server could not be reached. Check the address, the port and that the server is running." },
  timeout: { ko: "서버가 제시간에 응답하지 않았습니다. 서버 상태와 네트워크를 확인하세요.", en: "The server did not answer in time. Check the server and the network." },
  "invalid-url": { ko: "기본 URL 형식이 올바르지 않습니다.", en: "The base URL is not a valid address." },
  unauthorized: { ko: "API 키가 거부되었습니다. 키가 올바른지, 이 서버를 사용할 권한이 있는지 확인하세요.", en: "The API key was rejected. Check the key and that it may use this server." },
  "not-found": { ko: "모델 목록 주소를 찾을 수 없습니다. 기본 URL과 드라이버가 서버와 맞는지 확인하세요.", en: "The model listing was not found. Check that the base URL and driver match the server." },
  http: { ko: "서버가 모델 목록 요청을 거부했습니다.", en: "The server refused the model listing request." },
  server: { ko: "서버 내부 오류가 발생했습니다. 서버 로그를 확인하세요.", en: "The server reported an internal error. Check its logs." },
  "invalid-json": { ko: "서버 응답이 JSON 형식이 아닙니다. 기본 URL이 모델 API를 가리키는지(예: /v1 포함 여부), 드라이버가 맞는지 확인하세요.", en: "The server did not answer with JSON. Check that the base URL points at the model API (for example whether it needs /v1) and that the driver matches." },
  "invalid-shape": { ko: "서버가 모델 목록 형식이 아닌 응답을 보냈습니다. 드라이버 종류가 서버와 맞는지 확인하세요.", en: "The server answered, but not with a model list. Check that the driver matches the server." },
  unexpected: { ko: "모델 목록을 처리하지 못했습니다.", en: "The model list could not be processed." },
};

export function isConnectionFailureCode(value: unknown): value is ConnectionFailureCode { return typeof value === "string" && value in FAILURE_TEXT; }

/** A readable explanation of a failure code for the settings screen. */
export function describeConnectionFailure(code: ConnectionFailureCode, language: "ko" | "en") { return FAILURE_TEXT[code][language]; }
