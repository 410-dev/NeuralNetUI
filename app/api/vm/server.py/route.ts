import { vmAgentFile } from "@/lib/vm-installer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The virtual computer server the installer downloads. Public: it contains no secrets. */
export async function GET() {
  return new Response(await vmAgentFile("neuralnetui_vm.py"), { headers: { "Content-Type": "text/x-python; charset=utf-8", "Cache-Control": "no-store" } });
}
