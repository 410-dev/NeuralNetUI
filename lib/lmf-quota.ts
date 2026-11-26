import type { LmfQuotaWindow } from "./lmf.ts";

/** How close a window is to the point where routing moves on (its threshold), as a percentage of that point. */
export function quotaPressure(window: Pick<LmfQuotaWindow, "usedPercent" | "thresholdPercent">) {
  const limit = window.thresholdPercent && window.thresholdPercent > 0 ? window.thresholdPercent : 100;
  return window.usedPercent / limit * 100;
}

/**
 * A target's windows from the shortest to the longest (unknown lengths last), and which of them is closest to its
 * limit: the one shown while the target is folded. Unfolding keeps this order, so shorter windows open above it
 * and longer ones below.
 */
export function foldedQuotaWindows<T extends Pick<LmfQuotaWindow, "usedPercent" | "thresholdPercent" | "windowSeconds">>(windows: T[]) {
  const ordered = [...windows].sort((a, b) => (a.windowSeconds ?? Infinity) - (b.windowSeconds ?? Infinity));
  let primary = 0;
  ordered.forEach((window, index) => { if (quotaPressure(window) > quotaPressure(ordered[primary])) primary = index; });
  return { ordered, primary };
}
