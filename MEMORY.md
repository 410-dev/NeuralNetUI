# Project Memory

- NeuralNetUI is a Next.js 16 TypeScript chat application with SQLite-backed authentication, settings, conversations, uploads, and tool-event persistence.
- The UI supports English and Korean. Technical tool events use a collapsed message-level group with active tool names or completed/failure totals, nested per-call rows, and display-only localized call markers in reasoning.
- Selectable questions appear one at a time above the composer, support model-chosen single/multiple/ranked modes, and render persisted tool answers as user-style question/answer bubbles.
- Deleting a user message also deletes the immediately connected assistant response from that branch.
- DDGS subprocess JSON I/O is explicitly UTF-8 to avoid Windows code-page corruption and partial JSON responses.
- Page visits support bounded text/JSON/XML, safe raster images, and temporary PDF processing; archives and unsupported binaries are rejected.
- The opt-in Browser tool uses isolated headless Chromium sessions for JavaScript rendering, element-ref interactions, waits, and model-visible screenshots. Public-address checks cover navigation and subresources; sessions close at the end of each model response.
- Image and PDF uploads share the attachment pipeline. PDF originals and bounded extraction caches live under `data/uploads`; scanned-page renders and URL downloads are temporary and are removed after use.
- Admins configure tool rounds, attachment/download limits, PDF processing limits, timeouts, and orphan-upload retention in the Tools settings tab.
- Client-side IDs use Web Crypto when available and a collision-resistant fallback on non-secure LAN/Tailscale HTTP origins where browsers hide Web Crypto.
- Frontend design guidance lives in `design/MASTER.md`.
- Per-user default model and reasoning preset are applied on a fresh app session; in-app New Chat preserves the current selection.
- General settings can export/import validated `neuralnetui-model-settings` v1 JSON with two-space indentation; ownership metadata is never exported and imports save immediately.
- Chat streaming auto-follows only while the thread remains near the bottom, and hidden served models are excluded from alias base-model choices.
- Unit tests run with `npm test`; type checking uses `npx tsc --noEmit`; the production build uses `npm run build`.
- Windows x64 MSI packaging is driven by `installer/build-msi.ps1` and bundles the standalone Next.js app, Node.js, embedded Python search/PDF dependencies, service host, and tray host.
- Current release version: 1.6.0.
