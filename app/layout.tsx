import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neural Chat",
  description: "A focused interface for OpenAI-compatible language models.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
