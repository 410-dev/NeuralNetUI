import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { PwaSetup } from "./pwa-setup";

export const metadata: Metadata = {
  title: "Neural Chat",
  description: "A focused interface for OpenAI-compatible language models.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}<PwaSetup /></body>
    </html>
  );
}
