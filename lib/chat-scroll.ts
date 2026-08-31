export type ScrollMetrics = Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">;

export function isNearScrollBottom(metrics: ScrollMetrics, threshold = 48) {
  return metrics.scrollHeight - Math.max(0, metrics.scrollTop) - metrics.clientHeight <= threshold;
}
