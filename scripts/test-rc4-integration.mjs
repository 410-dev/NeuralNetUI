import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = file => readFile(path.join(root, file), "utf8");
const [pkg, page, artifact, css, modal] = await Promise.all([
  read("package.json").then(JSON.parse), read("app/page.tsx"), read("app/artifact-viewer.tsx"),
  read("app/globals.css"), read("lib/use-modal-focus.ts"),
]);

assert.equal(pkg.version, "3.0.0-rc4-b24");
assert.ok(pkg.dependencies["highlight.js"]);
assert.match(page, /SyntaxHighlightedCode code=\{code\} language=\{language\}/);
assert.match(artifact, /useState\(false\).*maximized/s);
assert.match(artifact, /artifact-size-toggle/);
assert.match(artifact, /SyntaxHighlightedCode code=\{content\} language=\{artifact\.kind\}/);
assert.match(css, /\.mcp-connection-list article em \{[^}]*border:1px solid var\(--border-strong\)/);
assert.match(css, /\.artifact-dialog\{[^}]*width:min\(1180px,100%\)[^}]*height:min\(860px,calc\(100dvh - 24px\)\)/);
assert.match(css, /\.artifact-layer\.maximized \.artifact-dialog\{width:100%;height:100dvh/);
assert.match(css, /@keyframes panelOut/);
assert.match(modal, /useModalTransition/);
assert.match(modal, /modal-exit-snapshot/);

console.log("RC4 beta 24 integration passed.");
