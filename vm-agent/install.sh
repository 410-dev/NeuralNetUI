#!/usr/bin/env bash
# NeuralNetUI virtual computer installer (Linux: LXC, Docker, bare metal; macOS).
#
#   curl -fsSL __NNUI_ORIGIN__/api/vm/install | sudo bash -s -- [options]
#
# Options
#   --key KEY            access key (default: a new random key, printed at the end)
#   --port PORT          port to listen on (default 8765)
#   --bind ADDRESS       address to listen on (default 127.0.0.1; use 0.0.0.0 to reach it from other machines)
#   --tunnel-token TEXT  Cloudflare Tunnel token, or the whole "cloudflared service install <token>" command
#   --gui                install screen and input tools (xdotool, ImageMagick; cliclick on macOS)
#   --no-browser         skip the Obscura headless browser
#   --no-service         install only; do not register or start a service (containers)
#   --from URL           NeuralNetUI address to download the server from (default: the one this script came from)
set -euo pipefail

NNUI_ORIGIN="__NNUI_ORIGIN__"
KEY="" PORT=8765 BIND=127.0.0.1 TUNNEL="" GUI=0 BROWSER=1 SERVICE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --tunnel-token) TUNNEL="$2"; shift 2 ;;
    --gui) GUI=1; shift ;;
    --no-browser) BROWSER=0; shift ;;
    --no-service) SERVICE=0; shift ;;
    --from) NNUI_ORIGIN="$2"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

OS="$(uname -s)"; ARCH="$(uname -m)"
case "$ARCH" in x86_64|amd64) ARCH=x86_64; CF_ARCH=amd64 ;; aarch64|arm64) ARCH=aarch64; CF_ARCH=arm64 ;; *) fail "Unsupported CPU: $ARCH" ;; esac

# A token may be pasted alone or inside the whole command Cloudflare shows; keep only the token.
if [ -n "$TUNNEL" ]; then
  TUNNEL="$(printf '%s' "$TUNNEL" | grep -oE 'eyJ[A-Za-z0-9_=-]{20,}' | head -n1 || true)"
  [ -n "$TUNNEL" ] || fail "No Cloudflare Tunnel token found in --tunnel-token."
fi

if [ "$OS" = Linux ]; then
  [ "$(id -u)" = 0 ] || fail "Run as root (sudo) on Linux: workspaces become separate Linux accounts."
  PREFIX=/opt/neuralnetui-vm; CONF_DIR=/etc/neuralnetui-vm; DATA=/var/lib/neuralnetui-vm
  say "Installing packages"
  packages="python3 curl ca-certificates tar util-linux passwd"
  [ "$GUI" = 1 ] && packages="$packages xdotool imagemagick"
  if command -v apt-get >/dev/null; then export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq $packages >/dev/null
  elif command -v dnf >/dev/null; then dnf install -y -q $(echo "$packages" | sed 's/imagemagick/ImageMagick/') >/dev/null
  elif command -v apk >/dev/null; then apk add -q python3 curl ca-certificates tar util-linux shadow $([ "$GUI" = 1 ] && echo "xdotool imagemagick")
  else command -v python3 >/dev/null || fail "Install python3 first."; fi
elif [ "$OS" = Darwin ]; then
  PREFIX="$HOME/Library/Application Support/NeuralNetUI-VM"; CONF_DIR="$PREFIX"; DATA="$PREFIX/data"
  command -v python3 >/dev/null || fail "Install python3 first (xcode-select --install)."
  if [ "$GUI" = 1 ]; then command -v cliclick >/dev/null || { command -v brew >/dev/null && brew install cliclick || echo "Install cliclick (brew install cliclick) for mouse and keyboard control."; }; fi
else
  fail "Unsupported system: $OS (Linux and macOS are supported)."
fi
mkdir -p "$PREFIX/bin" "$CONF_DIR" "$DATA"

say "Downloading the server from $NNUI_ORIGIN"
curl -fsSL "$NNUI_ORIGIN/api/vm/server.py" -o "$PREFIX/neuralnetui_vm.py" || fail "Could not download the server from $NNUI_ORIGIN."
chmod 755 "$PREFIX/neuralnetui_vm.py"

if [ "$BROWSER" = 1 ]; then
  say "Installing the Obscura browser (stealth build with rendering)"
  target=$([ "$OS" = Darwin ] && echo macos || echo linux)
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-$ARCH-$target-stealth.tar.gz" -o "$tmp/obscura.tgz" || fail "Could not download Obscura."
  tar -xzf "$tmp/obscura.tgz" -C "$PREFIX/bin"; chmod 755 "$PREFIX/bin/obscura" "$PREFIX/bin/obscura-worker" 2>/dev/null || true
  rm -rf "$tmp"
  [ "$OS" = Darwin ] && xattr -dr com.apple.quarantine "$PREFIX/bin" 2>/dev/null || true
fi

[ -n "$KEY" ] || KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
cat > "$CONF_DIR/config.json" <<JSON
{"key": "$KEY", "bind": "$BIND", "port": $PORT, "home": "$DATA", "obscura": "$PREFIX/bin/obscura", "stealth": true}
JSON
chmod 600 "$CONF_DIR/config.json"

if [ -n "$TUNNEL" ]; then
  say "Installing Cloudflare Tunnel"
  if ! command -v cloudflared >/dev/null; then
    if [ "$OS" = Darwin ]; then command -v brew >/dev/null && brew install cloudflared || fail "Install cloudflared (brew install cloudflared)."
    else curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CF_ARCH" -o /usr/local/bin/cloudflared && chmod 755 /usr/local/bin/cloudflared; fi
  fi
fi

has_systemd() { [ -d /run/systemd/system ] && command -v systemctl >/dev/null; }

if [ "$SERVICE" = 1 ] && [ "$OS" = Linux ] && has_systemd; then
  say "Registering the systemd service"
  display=""; [ "$GUI" = 1 ] && [ -n "${DISPLAY:-}" ] && display="Environment=DISPLAY=$DISPLAY"
  cat > /etc/systemd/system/neuralnetui-vm.service <<UNIT
[Unit]
Description=NeuralNetUI virtual computer
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/env python3 $PREFIX/neuralnetui_vm.py --config $CONF_DIR/config.json
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
$display
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload; systemctl enable --now neuralnetui-vm.service
  [ -n "$TUNNEL" ] && { cloudflared service uninstall >/dev/null 2>&1 || true; cloudflared service install "$TUNNEL"; }
elif [ "$SERVICE" = 1 ] && [ "$OS" = Darwin ]; then
  say "Registering the launchd agent"
  plist="$HOME/Library/LaunchAgents/dev.neuralnetui.vm.plist"; mkdir -p "$(dirname "$plist")"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.neuralnetui.vm</string>
  <key>ProgramArguments</key><array><string>/usr/bin/env</string><string>python3</string><string>$PREFIX/neuralnetui_vm.py</string><string>--config</string><string>$CONF_DIR/config.json</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$DATA/server.log</string>
</dict></plist>
PLIST
  launchctl unload "$plist" 2>/dev/null || true; launchctl load "$plist"
  [ -n "$TUNNEL" ] && { sudo cloudflared service install "$TUNNEL" || echo "Run: sudo cloudflared service install <token>"; }
else
  say "No service manager here (or --no-service). Start it with:"
  echo "  python3 $PREFIX/neuralnetui_vm.py --config $CONF_DIR/config.json"
  [ -n "$TUNNEL" ] && echo "  cloudflared tunnel --no-autoupdate run --token <token>"
fi

cat <<DONE

NeuralNetUI virtual computer is installed.
  Address:  http://$BIND:$PORT/mcp   (through a tunnel: https://<your hostname>/mcp)
  Key:      $KEY

In NeuralNetUI, open Settings > MCP > Virtual computer and enter the address and key.
DONE
