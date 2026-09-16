export type UsagePopoverViewport = {
  width: number;
  height: number;
};

export type UsagePopoverAnchor = {
  top: number;
  right: number;
};

export function usagePopoverPlacement(
  viewport: UsagePopoverViewport,
  anchor: UsagePopoverAnchor,
  preferredWidth = 300,
  margin = 12,
  gap = 12,
) {
  const width = Math.max(1, Math.min(preferredWidth, viewport.width - margin * 2));
  const left = Math.min(
    Math.max(anchor.right - width, margin),
    Math.max(margin, viewport.width - margin - width),
  );
  const bottom = Math.max(margin, viewport.height - anchor.top + gap);
  const maxHeight = Math.max(1, viewport.height - bottom - margin);
  return { left, bottom, width, maxHeight };
}
