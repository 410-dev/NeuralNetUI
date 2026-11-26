# NeuralNetUI

[한국어](README.md) · **English**

A self-hosted chat UI for working with local and remote OpenAI-compatible inference servers from a single screen. The Next.js frontend and the streaming proxy backend run in one process, and all data is kept in a local SQLite database and local files.

![NeuralNetUI](neuralnetui.png)

`2.0-devel` · Node.js 22+ · Next.js 16 · SQLite

## Features

| Feature | Summary |
| --- | --- |
| **Multi-server routing** | OpenAI API, LM Studio, Google Gemini and Anthropic Claude drivers, connection priority, per-server model settings |
| **Branching conversations** | Editing or regenerating a message creates a new branch that keeps the original path; switch with `< m / n >` |
| **Reasoning control** | Built-in effort levels and custom templates, automatic server capability detection, streamed reasoning display |
| **Tools** | Web search, page visits, in-browser sandboxed code execution (JavaScript, Python), storage access, multiple-choice questions, headless browser (Obscura), YouTube, user-registered MCP servers |
| **Context management** | Rolling or automatic compaction with resume, live usage donut, response length cap |
| **Personal storage** | Per-account quotas, automatic saving of artifacts and generated images, chunked uploads, trash with retention period, reference protection |
| **Image generation** | Receives base64 responses from OpenAI-compatible Images APIs, detects GPT Image 2 automatically, links results to the chat and personal storage |
| **Attachments** | Images, PDFs and general files, with per-model control over image input and resolution |
| **Multiple users** | Three roles, data isolation, audit permission, workspace defaults |
| **Backup and restore** | Highly compressed per-user 7z images, sequential version upgrades, merge or replace restore, administrator data images |
| **Plans and limits** | Model access, MCP usage and registration counts, HTML artifact execution policy, plan duplication, multiple time windows, model weights, storage, reset credits |
| **Deployment** | Hosting scripts, Windows MSI service, Docker, LXC/systemd |

## Quick start

### Run from source

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Always-on hosting (recommended)

With Node.js 22 or later and Python 3 installed, a single script installs dependencies, builds for production and starts the server.

```bat
host-windows.bat
```

```bash
chmod +x host-linux.sh
./host-linux.sh
```

Add `--rebuild` after updating the source, or `--check` to check the status without starting the server.

### Docker

```bat
deploy-docker-windows.bat
```

```bash
chmod +x deploy-docker-linux.sh
./deploy-docker-linux.sh
```

To run on Linux Docker Engine alongside a relay server bound only to the host's `localhost`, use the [netsync Docker deployment](docs/deployment.md#linux-netsync-docker).

### Windows installer

The MSI installs Node.js, Python, a Windows service and a tray app together, and starts automatically at boot. See the [deployment guide](docs/deployment.md#windows-msi) for details.

## First run

1. On first access, create the **superadmin account**.
2. In `Settings > Connection`, enter the driver, Base URL and API key, then run **Detect models**.
3. Pick a model and reasoning effort above the input box and start chatting.

The full walkthrough is in [Getting started](docs/getting-started.md).

## Documentation

The documentation is written in Korean.

| Document | Contents |
| --- | --- |
| [Getting started](docs/getting-started.md) | Requirements, installation, initial setup |
| [Deployment](docs/deployment.md) | MSI, Docker, LXC/systemd, updates |
| [Configuration file and environment variables](docs/configuration.md) | `app-config.json`, environment variables, data locations |
| [Chat](docs/features/chat.md) | Branches, attachments, rendering, search, export |
| [Models and connections](docs/features/models.md) | Drivers, custom models, residency management |
| [Reasoning](docs/features/reasoning.md) | Presets, capability detection, display |
| [Tools](docs/features/tools.md) | Search, browser, YouTube, storage access, MCP |
| [Personal storage](docs/features/storage.md) | Uploads, quotas, trash |
| [Harness and context](docs/features/harness.md) | Compaction, resume, title generation, limits |
| [Users and permissions](docs/features/users.md) | Roles, auditing, isolation |
| [Appearance and language](docs/features/appearance.md) | Accent, streaming style, greetings |
| [Settings reference](docs/settings-reference.md) | Every setting, its scope and default |
| [Operations and backup](docs/operations.md) | Verification, backup, troubleshooting |
| [Architecture](docs/architecture.md) | Structure, database, API |

The change history is in [`Changelogs.md`](Changelogs.md), and per-release verification records are in [`docs/audits/`](docs/audits/).

## Development

```bash
npm test          # unit tests in lib/*.test.ts
npx tsc --noEmit  # type check
npm run build     # production build
```

After building, `node scripts/test-audit-integration.mjs` runs an integration check against a temporary database and mock servers. It does not touch your real connection settings or models. The full list is in the [operations guide](docs/operations.md#통합-검증-스크립트).

Frontend design rules follow [`design/MASTER.md`](design/MASTER.md).

## Repository layout

```
app/        Pages, UI, API routes
lib/        Domain logic and unit tests
scripts/    Server bootstrap, Python helpers, integration checks
installer/  Windows MSI build and service/tray host
deploy/     Example systemd unit
docs/       Documentation and release audit records
design/     Design language rules
```

## Encrypted backups

A backup is an authenticated AES-256-GCM `.nnbak` image containing a highly compressed 7z payload. A random salt and scrypt derive its key from the owner's username and password, so restoring requires neither a server secret nor the source instance. Personal and per-user backups require the data owner's current sign-in credentials; global and account backups require the exporting administrator's credentials. Restoring requires the credentials used **when the image was created**, even if the password has changed since.

Sign in on the destination, choose the backup scope and merge or replace mode, then enter the credentials the image was created with. Personal and per-user images are interchangeable, and their IDs and attachment links are migrated to the destination owner. Account restore requires a superadmin, matches existing usernames to local IDs, and keeps the superadmin running the restore. Restores still respect the destination's storage limits. Unencrypted `.7z` files from an earlier version (Beta 15) must be recreated as encrypted images on the source installation.

Verification: `npm test`, `npx tsc --noEmit`, `npm run build`, and `node --experimental-strip-types scripts/test-beta16-backup-integration.mjs`. The integration check covers every scope and mode combination, ciphertext tampering, wrong credentials, rollback, and a separate fresh destination. Set `BACKUP_QA_APP_DIR` and `BACKUP_QA_NODE` to verify the packaged standalone runtime. This repository has no separate lint command.
