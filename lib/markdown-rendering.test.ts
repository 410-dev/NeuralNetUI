import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { literalStrikethroughSource } from "./markdown-rendering.ts";

function renderMarkdown(source: string) {
  return renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [[remarkGfm, { singleTilde: true }], remarkMath],
    rehypePlugins: [rehypeKatex],
    children: source,
  }));
}

test("Markdown renders inline and display LaTeX through KaTeX", () => {
  const html = renderMarkdown("Inline $x^2$\n\n$$\n\\sum_{i=1}^n i\n$$");
  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
});

test("GFM accepts both single- and double-tilde strikethrough", () => {
  assert.match(renderMarkdown("~single~ and ~~double~~"), /<del>single<\/del> and <del>double<\/del>/);
});

test("disabled strikethrough preserves the exact source markers", () => {
  const source = "3~5ml, 최대 용량은 6~7ml and ~~removed~~";
  const singleEnd = source.indexOf("7ml");
  assert.equal(literalStrikethroughSource(source, { position: { start: { offset: 1 }, end: { offset: singleEnd } } }, "fallback"), "~5ml, 최대 용량은 6~");
  const doubleStart = source.indexOf("~~removed~~");
  assert.equal(literalStrikethroughSource(source, { position: { start: { offset: doubleStart }, end: { offset: source.length } } }, "fallback"), "~~removed~~");
});
