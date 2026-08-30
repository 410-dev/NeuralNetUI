# Project Memory

- NeuralNetUI is a Next.js 16 TypeScript chat application with SQLite-backed authentication, settings, conversations, uploads, and tool-event persistence.
- The UI supports English and Korean. Technical tool events use a collapsed message-level group with active tool names or completed/failure totals, nested per-call rows, and display-only localized call markers in reasoning.
- Selectable questions appear one at a time above the composer, support model-chosen single/multiple/ranked modes, and render persisted tool answers as user-style question/answer bubbles.
- Deleting a user message also deletes the immediately connected assistant response from that branch.
- DDGS subprocess JSON I/O is explicitly UTF-8 to avoid Windows code-page corruption and partial JSON responses.
- Client-side IDs use Web Crypto when available and a collision-resistant fallback on non-secure LAN/Tailscale HTTP origins where browsers hide Web Crypto.
- Frontend design guidance lives in `design/MASTER.md`.
- Unit tests run with `npm test`; type checking uses `npx tsc --noEmit`; the production build uses `npm run build`.
- Windows x64 MSI packaging is driven by `installer/build-msi.ps1` and bundles the standalone Next.js app, Node.js, embedded Python search dependencies, service host, and tray host.
- Current release version: 1.5.0.
