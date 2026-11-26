#!/usr/bin/env bash
# Container entry point: optional desktop (GUI=1), optional Cloudflare Tunnel, then the virtual computer server.
set -euo pipefail

if [ -z "${NNUI_VM_KEY:-}" ]; then
  if [ ! -s /var/lib/neuralnetui-vm/key ]; then python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > /var/lib/neuralnetui-vm/key; chmod 600 /var/lib/neuralnetui-vm/key; fi
  NNUI_VM_KEY="$(cat /var/lib/neuralnetui-vm/key)"; export NNUI_VM_KEY
  echo "Access key (also in /var/lib/neuralnetui-vm/key): $NNUI_VM_KEY"
fi

if [ "${GUI:-0}" = 1 ]; then
  export DISPLAY="${DISPLAY:-:1}"
  Xvfb "$DISPLAY" -screen 0 "${SCREEN:-1440x900x24}" -nolisten tcp >/tmp/xvfb.log 2>&1 &
  for _ in $(seq 50); do [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ] && break; sleep 0.1; done
  # The desktop runs as root's session; workspace accounts may use it too.
  (dbus-launch --exit-with-session startxfce4 >/tmp/xfce.log 2>&1 &)
  xhost +local: >/dev/null 2>&1 || true
else
  unset DISPLAY
fi

# Accept the bare token or the whole "cloudflared service install <token>" text.
token="$(printf '%s' "${CLOUDFLARE_TUNNEL_TOKEN:-}" | grep -oE 'eyJ[A-Za-z0-9_=-]{20,}' | head -n1 || true)"
if [ -n "$token" ]; then
  cloudflared tunnel --no-autoupdate run --token "$token" >/var/log/cloudflared.log 2>&1 &
  echo "Cloudflare Tunnel started (log: /var/log/cloudflared.log)"
fi

exec python3 /opt/neuralnetui-vm/neuralnetui_vm.py --config /etc/neuralnetui-vm/config.json
