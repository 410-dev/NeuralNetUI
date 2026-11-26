import { promises as fs } from "node:fs";
import path from "node:path";

/** The address people reach this NeuralNetUI at, as the request saw it (behind a proxy, from its forwarded headers). */
export function publicOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function vmAgentFile(name: "install.sh" | "neuralnetui_vm.py") {
  return fs.readFile(path.join(process.cwd(), "vm-agent", name), "utf8");
}
