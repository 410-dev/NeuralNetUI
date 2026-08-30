export type ClientIdSource = {
  randomUUID: (() => string) | undefined;
  now: () => number;
  random: () => number;
};

let fallbackSequence = 0;

function defaultSource(): ClientIdSource {
  const webCrypto = typeof globalThis.crypto === "undefined" ? undefined : globalThis.crypto;
  return {
    randomUUID: typeof webCrypto?.randomUUID === "function" ? () => webCrypto.randomUUID() : undefined,
    now: Date.now,
    random: Math.random,
  };
}

export function createClientId(prefix: string, source: ClientIdSource = defaultSource()) {
  const uuid = source.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;

  fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER;
  const timestamp = Math.max(0, Math.trunc(source.now())).toString(36);
  const randomValue = Math.min(1 - Number.EPSILON, Math.max(0, source.random()));
  const randomPart = Math.floor(randomValue * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, "0");
  return `${prefix}-${timestamp}-${fallbackSequence.toString(36)}-${randomPart}`;
}
