import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const languages = { bash, css, ini, java, javascript, json, markdown, plaintext, python, sql, typescript, xml, yaml } as const;
for (const [name, language] of Object.entries(languages)) hljs.registerLanguage(name, language);

const aliases: Record<string, keyof typeof languages> = {
  cjs: "javascript", html: "xml", htm: "xml", js: "javascript", jsx: "javascript",
  md: "markdown", py: "python", shell: "bash", sh: "bash", text: "plaintext",
  toml: "ini", ts: "typescript", tsx: "typescript", yml: "yaml",
};

export function normalizeCodeLanguage(language?: string) {
  const value = language?.trim().toLowerCase();
  if (!value) return undefined;
  const normalized = aliases[value] || value;
  return normalized in languages ? normalized as keyof typeof languages : undefined;
}

export function highlightCode(code: string, language?: string) {
  const normalized = normalizeCodeLanguage(language);
  if (normalized) return { html: hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value, language: normalized };
  if (language) return { html: hljs.highlight(code, { language: "plaintext" }).value, language: undefined };
  const detected = hljs.highlightAuto(code, Object.keys(languages).filter(name => name !== "plaintext"));
  return { html: detected.value, language: detected.language };
}
