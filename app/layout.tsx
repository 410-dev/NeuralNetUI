import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { PwaSetup } from "./pwa-setup";

export const metadata: Metadata = {
  title: "Neural Chat",
  description: "A focused interface for OpenAI-compatible language models.",
};

/**
 * `resizes-content` makes Android shrink the layout viewport for the on-screen keyboard instead of
 * laying the keyboard over the page and panning the whole page up to reveal the focused field.
 * The app then lays out once for the smaller height rather than jumping up and settling back.
 */
export const viewport: Viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}<PwaSetup /></body>
    </html>
  );
}
