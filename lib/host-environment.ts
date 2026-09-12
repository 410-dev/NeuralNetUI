import { existsSync, readFileSync } from "node:fs";

/** The host tool is intentionally unavailable when the server itself is containerized. */
export function isHostComputerAvailable() {
  if (process.env.container || process.env.KUBERNETES_SERVICE_HOST || existsSync("/.dockerenv") || existsSync("/run/.containerenv")) return false;
  if (process.platform === "win32") return true;
  try {
    return !/(docker|containerd|kubepods|lxc|podman)/i.test(readFileSync("/proc/1/cgroup", "utf8"));
  } catch {
    return true;
  }
}

export function canUseHostComputer(role: string | undefined, featureEnabled: boolean, environmentAvailable = isHostComputerAvailable()) {
  return role === "superadmin" && featureEnabled && environmentAvailable;
}
