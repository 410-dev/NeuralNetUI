# Project Memory

- NeuralNetUI is a Next.js 16 TypeScript chat application with SQLite-backed authentication, settings, conversations, uploads, and tool-event persistence.
- The UI supports English and Korean. Tool events are presented as one message-level folding group with nested per-call folding rows and localized running/completed/error labels.
- Frontend design guidance lives in `design/MASTER.md`.
- Unit tests run with `npm test`; type checking uses `npx tsc --noEmit`; the production build uses `npm run build`.
- Windows x64 MSI packaging is driven by `installer/build-msi.ps1` and bundles the standalone Next.js app, Node.js, embedded Python search dependencies, service host, and tray host.
- Current release version: 1.3.3.
