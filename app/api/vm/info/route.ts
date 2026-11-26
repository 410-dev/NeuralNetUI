import { authErrorResponse, requireUser } from "@/lib/auth";
import { vmBaseUrl, vmConnection, vmHeaders } from "@/lib/vm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the account's virtual computer reports about itself (OS, screen, browser, workspace). */
export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const vm = vmConnection(user.id, true);
    if (!vm) return Response.json({ info: null });
    try {
      const response = await fetch(`${vmBaseUrl(vm.url)}/mcp`, { method: "POST", headers: { ...vmHeaders(vm), "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "computer_info", arguments: {} } }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return Response.json({ info: null, error: response.status === 401 ? "The key was not accepted." : `The virtual computer answered ${response.status}.` });
      const body = await response.json() as { result?: { content?: Array<{ text?: string }> } };
      return Response.json({ info: JSON.parse(body.result?.content?.[0]?.text || "null") });
    } catch (error) { return Response.json({ info: null, error: error instanceof Error ? error.message : String(error) }); }
  } catch (error) { return authErrorResponse(error); }
}
