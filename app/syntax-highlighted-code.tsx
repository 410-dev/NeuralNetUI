"use client";

import { useMemo } from "react";
import { highlightCode } from "@/lib/syntax-highlighting";

export function SyntaxHighlightedCode({ code, language, className }: { code: string; language?: string; className?: string }) {
  const highlighted = useMemo(() => highlightCode(code, language), [code, language]);
  return <code className={["hljs", className, highlighted.language && `language-${highlighted.language}`].filter(Boolean).join(" ")} dangerouslySetInnerHTML={{ __html: highlighted.html }} />;
}
