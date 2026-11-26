/**
 * Periodic subagent work (the periodic check and recurring schedules) can keep one LMFuseFramework session from run to
 * run, so the provider's prompt cache is still warm when the next run starts. That only pays off when the interval is
 * shorter than the cache lifetime: the cache is measured from the last request of a run, and the next run can start up
 * to a scheduler tick late, so a margin is kept. Longer intervals close the session after every run.
 */
export const SERIES_CACHE_MARGIN_SECONDS = 60;
/** A kept session is reused only if at least this much cache lifetime is left when the next run starts. */
export const SERIES_MIN_REMAINING_SECONDS = 15;

export function keepsSeriesSession(intervalMinutes: number, cacheTtlSeconds: number | undefined) {
  if (!cacheTtlSeconds || !Number.isFinite(cacheTtlSeconds) || !(intervalMinutes > 0)) return false;
  return intervalMinutes * 60 + SERIES_CACHE_MARGIN_SECONDS <= cacheTtlSeconds;
}

export function reusesSeriesSession(intervalMinutes: number, cache: { remainingSeconds: number; totalSeconds?: number } | undefined) {
  return Boolean(cache && keepsSeriesSession(intervalMinutes, cache.totalSeconds) && cache.remainingSeconds >= SERIES_MIN_REMAINING_SECONDS);
}
