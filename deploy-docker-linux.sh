#!/usr/bin/env sh
set -eu

APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$APP_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] Docker is not installed or is not in PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[ERROR] Docker Compose v2 is required." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[ERROR] Docker is not running or the current user cannot access it." >&2
  echo "        Start Docker or add the user to the docker group, then try again." >&2
  exit 1
fi

NEURAL_CHAT_PORT=${NEURAL_CHAT_PORT:-3000}
NEURAL_CHAT_UID=${NEURAL_CHAT_UID:-$(id -u)}
NEURAL_CHAT_GID=${NEURAL_CHAT_GID:-$(id -g)}
export NEURAL_CHAT_PORT NEURAL_CHAT_UID NEURAL_CHAT_GID

mkdir -p data

echo "[1/2] Building and deploying Neural Chat with Docker..."
docker compose up --detach --build --remove-orphans

echo "[2/2] Checking the container..."
docker compose ps

echo
echo "Neural Chat is deployed at http://localhost:${NEURAL_CHAT_PORT}"
echo "Data is stored in ${APP_ROOT}/data"
echo "Run 'docker compose logs -f neural-chat' to follow the logs."

