type PositionedNode = {
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
};

export function literalStrikethroughSource(source: string, node: PositionedNode | undefined, fallbackText: string) {
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  return typeof start === "number" && typeof end === "number"
    ? source.slice(start, end)
    : `~~${fallbackText}~~`;
}
