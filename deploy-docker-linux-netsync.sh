#!/usr/bin/env sh
# Run NeuralNetUI in the Linux host network namespace so connections configured
# as localhost inside the Web UI reach services listening on the Docker host.
set -eu

APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$APP_ROOT"

if [ "$(uname -s)" != "Linux" ]; then
  echo "[ERROR] deploy-docker-linux-netsync.sh requires a Linux Docker host." >&2
  exit 1
fi

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
NEURAL_CHAT_RELAY_PORT=${NEURAL_CHAT_RELAY_PORT:-10531}
export NEURAL_CHAT_PORT NEURAL_CHAT_UID NEURAL_CHAT_GID NEURAL_CHAT_RELAY_PORT

case "$NEURAL_CHAT_PORT" in
  ''|*[!0-9]*)
    echo "[ERROR] NEURAL_CHAT_PORT must be a numeric TCP port." >&2
    exit 1
    ;;
esac

case "$NEURAL_CHAT_RELAY_PORT" in
  ''|*[!0-9]*)
    echo "[ERROR] NEURAL_CHAT_RELAY_PORT must be a numeric TCP port." >&2
    exit 1
    ;;
esac

mkdir -p data

echo "[1/2] Building and deploying Neural Chat with host networking..."
docker compose -f docker-compose.netsync.yml up --detach --build --remove-orphans

echo "[2/2] Checking the container..."
docker compose -f docker-compose.netsync.yml ps

echo
echo "Neural Chat is deployed at http://localhost:${NEURAL_CHAT_PORT}"
echo "Host networking is enabled: configure the relay Base URL as http://localhost:${NEURAL_CHAT_RELAY_PORT}"
echo "Data is stored in ${APP_ROOT}/data"
echo "Run 'docker compose -f docker-compose.netsync.yml logs -f neural-chat' to follow the logs."
