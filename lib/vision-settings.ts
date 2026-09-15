import type { ModelConfig } from "./types";

export const DEFAULT_VISION_MAX_EDGE_PIXELS = 1024;
export const MIN_VISION_MAX_EDGE_PIXELS = 128;
export const MAX_VISION_MAX_EDGE_PIXELS = 8192;

export function resolvedVisionSettings(model?: Pick<ModelConfig, "visionImageMode" | "visionMaxEdgePixels">) {
  const mode = model?.visionImageMode === "max-resolution" ? "max-resolution" as const : "original" as const;
  const requested = Number(model?.visionMaxEdgePixels ?? DEFAULT_VISION_MAX_EDGE_PIXELS);
  const maxEdgePixels = Math.max(MIN_VISION_MAX_EDGE_PIXELS, Math.min(MAX_VISION_MAX_EDGE_PIXELS,
    Number.isFinite(requested) ? Math.floor(requested) : DEFAULT_VISION_MAX_EDGE_PIXELS));
  return { mode, maxEdgePixels };
}
