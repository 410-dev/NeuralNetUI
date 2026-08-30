#!/usr/bin/env sh
set -eu

APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$APP_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js 22 or newer is required." >&2
  exit 1
fi

if ! node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)"; then
  echo "[ERROR] Node.js 22 or newer is required. Current version: $(node --version)" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ERROR] Python 3 is required for DDGS internet search." >&2
  exit 1
fi
if [ ! -x ".python/bin/python" ]; then
  echo "Preparing the DDGS Python environment..."
  python3 -m venv .python
fi
.python/bin/python -m pip install -q -r requirements.txt
export NEURAL_CHAT_PYTHON="$APP_ROOT/.python/bin/python"

NEEDS_BUILD=0
if [ "${1:-}" = "--rebuild" ]; then NEEDS_BUILD=1; fi
if [ ! -f "node_modules/.package-lock.json" ]; then NEEDS_BUILD=1; fi
if [ ! -f ".next/standalone/server.js" ]; then NEEDS_BUILD=1; fi

if [ "$NEEDS_BUILD" -eq 1 ]; then
  echo "[1/3] Installing dependencies..."
  npm ci
  echo "[2/3] Building Neural Chat..."
  npm run build
fi

echo "[3/3] Preparing runtime files..."
mkdir -p ".next/standalone/.next/static"
cp -R ".next/static/." ".next/standalone/.next/static/"
if [ -d "public" ]; then
  mkdir -p ".next/standalone/public"
  cp -R "public/." ".next/standalone/public/"
fi

NEURAL_CHAT_DATA_DIR=${NEURAL_CHAT_DATA_DIR:-"$APP_ROOT/data"}
mkdir -p "$NEURAL_CHAT_DATA_DIR"
chmod 700 "$NEURAL_CHAT_DATA_DIR"

export NODE_ENV=production
export NEURAL_CHAT_DATA_DIR

if [ "${1:-}" = "--check" ]; then
  node "scripts/start-server.mjs" --check
  echo "Neural Chat hosting files are ready."
  exit 0
fi

echo
echo "Press Ctrl+C to stop. Use ./host-linux.sh --rebuild after updating the source."
echo
exec node "scripts/start-server.mjs" start
