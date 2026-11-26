import { publicOrigin, vmAgentFile } from "@/lib/vm-installer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The virtual computer installer, pointed back at this NeuralNetUI. Public: it contains no secrets. */
export async function GET(request: Request) {
  const script = (await vmAgentFile("install.sh")).replaceAll("__NNUI_ORIGIN__", publicOrigin(request));
  return new Response(script, { headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" } });
}
