export type ScrollMetrics = Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">;

export function isNearScrollBottom(metrics: ScrollMetrics, threshold = 48) {
  return metrics.scrollHeight - Math.max(0, metrics.scrollTop) - metrics.clientHeight <= threshold;
}

/**
 * Whether a live box keeps following its newest text after a scroll event. Text that grows faster than a programmatic
 * scroll lands also leaves the box short of the bottom, so only the person's own wheel, touch, drag or keys (recorded
 * as `userIntentAt`) may stop following. Coming back to the bottom always resumes it.
 */
export const SCROLL_INTENT_MS = 700;

export function followAfterScroll(nearBottom: boolean, following: boolean, userIntentAt: number, now = Date.now(), intentWindowMs = SCROLL_INTENT_MS) {
  if (nearBottom) return true;
  return now - userIntentAt <= intentWindowMs ? false : following;
}
