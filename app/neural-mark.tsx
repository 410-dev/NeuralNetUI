"use client";

/**
 * The product mark: a 2-3-2 network of nodes and edges, spread wide enough that the layers read
 * as a network rather than a cluster of touching circles. Edges stop short of each node so the
 * mark stays legible without a plate behind it, and `currentColor` keeps it on the icon treatment.
 */
export function NeuralMark({ size = 16, strokeWidth = 1.5 }: { size?: number; strokeWidth?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M5.55 6.98L10.05 4.62M5.59 8.95L10.01 11.05M4.83 9.82L10.77 18.58M4.83 14.18L10.77 5.42M5.59 15.05L10.01 12.95M5.55 17.02L10.05 19.38M13.95 4.62L18.45 6.98M13.23 5.42L19.17 14.18M13.99 11.05L18.41 8.95M13.99 12.95L18.41 15.05M13.23 18.58L19.17 9.82M13.95 19.38L18.45 17.02" opacity=".5" />
    <circle cx="3.6" cy="8" r="1.65" />
    <circle cx="3.6" cy="16" r="1.65" />
    <circle cx="12" cy="3.6" r="1.65" />
    <circle cx="12" cy="12" r="1.65" />
    <circle cx="12" cy="20.4" r="1.65" />
    <circle cx="20.4" cy="8" r="1.65" />
    <circle cx="20.4" cy="16" r="1.65" />
  </svg>;
}
