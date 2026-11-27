import { authErrorResponse, requireUser } from "@/lib/auth";
import { vmBaseUrl, vmConnection, vmHeaders } from "@/lib/vm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The account browser's cookies on the virtual computer, as cookies.txt. They live only there: this route passes
 * them through and stores nothing.
 */
async function relay(request: Request, method: "GET" | "PUT") {
  const user = requireUser(request);
  const vm = vmConnection(user.id, true);
  if (!vm) return Response.json({ error: "No virtual computer is registered." }, { status: 404 });
  const body = method === "PUT" ? await request.text() : undefined;
  if (body !== undefined && body.length > 4 << 20) return Response.json({ error: "cookies.txt is larger than 4 MB." }, { status: 413 });
  let response: Response;
  try { response = await fetch(`${vmBaseUrl(vm.url)}/browser-cookies`, { method, headers: { ...vmHeaders(vm), ...(body !== undefined ? { "Content-Type": "text/plain; charset=utf-8" } : {}) }, body, signal: AbortSignal.timeout(30_000), cache: "no-store" }); }
  catch (error) { return Response.json({ error: `The virtual computer could not be reached: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 }); }
  // A virtual computer older than 1.1.0 has no cookie jar to manage.
  if (response.status === 404) return Response.json({ error: "This virtual computer does not support cookies yet. Update it (reinstall or pull the new image) and try again.", code: "vm_outdated" }, { status: 409 });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) return Response.json({ error: typeof payload.error === "string" ? payload.error : `The virtual computer answered ${response.status}.`, problems: payload.problems }, { status: response.status === 401 ? 502 : response.status });
  return Response.json(payload);
}

export async function GET(request: Request) {
  try { return await relay(request, "GET"); } catch (error) { return authErrorResponse(error); }
}

export async function PUT(request: Request) {
  try { return await relay(request, "PUT"); } catch (error) { return authErrorResponse(error); }
}
