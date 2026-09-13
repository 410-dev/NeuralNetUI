export function resolvedQuota(
  input: number | undefined,
  current: { bytes: number; usesDefault: boolean },
  defaultBytes: number,
) {
  if (input === undefined) return current;
  return input === 0 ? { bytes: defaultBytes, usesDefault: true } : { bytes: input, usesDefault: false };
}
