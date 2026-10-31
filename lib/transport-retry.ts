/**
 * Pauses between attempts when a model server cannot be reached: three attempts a second apart, then two
 * three seconds apart and two five seconds apart, so seven attempts in all before the failure is reported.
 */
export const TRANSPORT_RETRY_DELAYS_MS: readonly number[] = [1_000, 1_000, 3_000, 3_000, 5_000, 5_000];

const CONNECT_FAILURES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);

/** True when the request never reached the server, so nothing was dispatched and sending it again is safe. */
export function isConnectFailure(error: unknown) {
  const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  return CONNECT_FAILURES.has(code || "");
}
