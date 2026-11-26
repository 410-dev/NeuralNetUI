# NeuralNetUI virtual computer: Ubuntu 26.04 with the virtual computer server, the Obscura browser and cloudflared.
#   docker build -t neuralnetui-vm .                 headless (shell, files, browser)
#   docker build --build-arg GUI=1 -t neuralnetui-vm-gui .   with an XFCE desktop on a virtual screen
# Build from the repository root:  docker build -f vm-agent/Dockerfile vm-agent
FROM ubuntu:26.04
ARG GUI=0
ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 GUI=${GUI} NNUI_VM_BIND=0.0.0.0 NNUI_VM_PORT=8765
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends python3 curl ca-certificates tar passwd util-linux sudo git less nano procps \
 && if [ "$GUI" = 1 ]; then apt-get install -y -qq --no-install-recommends xvfb xfce4 xfce4-terminal dbus-x11 x11-xserver-utils xdotool imagemagick fonts-noto-cjk; fi \
 && rm -rf /var/lib/apt/lists/*
RUN arch=$([ "${TARGETARCH:-amd64}" = arm64 ] && echo aarch64 || echo x86_64) \
 && cf=$([ "${TARGETARCH:-amd64}" = arm64 ] && echo arm64 || echo amd64) \
 && mkdir -p /opt/neuralnetui-vm/bin /etc/neuralnetui-vm /var/lib/neuralnetui-vm \
 && curl -fsSL "https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-${arch}-linux-stealth.tar.gz" | tar -xz -C /opt/neuralnetui-vm/bin \
 && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cf}" -o /usr/local/bin/cloudflared \
 && chmod 755 /opt/neuralnetui-vm/bin/* /usr/local/bin/cloudflared
COPY neuralnetui_vm.py /opt/neuralnetui-vm/neuralnetui_vm.py
COPY entrypoint.sh /usr/local/bin/neuralnetui-vm-entrypoint
RUN chmod 755 /opt/neuralnetui-vm/neuralnetui_vm.py /usr/local/bin/neuralnetui-vm-entrypoint \
 && printf '{"home": "/var/lib/neuralnetui-vm", "obscura": "/opt/neuralnetui-vm/bin/obscura", "stealth": true}\n' > /etc/neuralnetui-vm/config.json
VOLUME ["/home", "/var/lib/neuralnetui-vm"]
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://127.0.0.1:8765/health || exit 1
ENTRYPOINT ["/usr/local/bin/neuralnetui-vm-entrypoint"]
