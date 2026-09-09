"use client";

/**
 * The product mark: a three-layer network of nodes and edges. Drawn with `currentColor` so it
 * inherits the icon treatment used everywhere else — white strokes, no plate behind them.
 */
export function NeuralMark({ size = 16, strokeWidth = 1.6 }: { size?: number; strokeWidth?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {/* Edges first so the node circles cap them cleanly. */}
    <path d="M5.4 7.2 12 3.6 18.6 7.2M5.4 7.2 12 12M5.4 7.2 12 20.4M18.6 7.2 12 12M18.6 7.2 12 20.4M5.4 16.8 12 3.6M5.4 16.8 12 12M5.4 16.8 12 20.4M18.6 16.8 12 3.6M18.6 16.8 12 12M18.6 16.8 12 20.4" opacity=".55" />
    <circle cx="12" cy="3.6" r="2.1" />
    <circle cx="5.4" cy="7.2" r="2.1" />
    <circle cx="18.6" cy="7.2" r="2.1" />
    <circle cx="12" cy="12" r="2.1" />
    <circle cx="5.4" cy="16.8" r="2.1" />
    <circle cx="18.6" cy="16.8" r="2.1" />
    <circle cx="12" cy="20.4" r="2.1" />
  </svg>;
}
