import { AuthError, authErrorResponse, logAdminAudit, requireAdmin } from "@/lib/auth";
import { installUploadedExecutable } from "@/lib/managed-binaries";
import { closeAllObscuraSessions, MAX_OBSCURA_BINARY_BYTES, OBSCURA_BINARY_KINDS, obscuraBinaryChanged, obscuraBinaryPath, obscuraStatus, removeObscuraBinary, type ObscuraBinaryKind } from "@/lib/obscura";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function superadmin(request: Request) {
  const user = requireAdmin(request);
  if (user.role !== "superadmin") throw new AuthError("Only Superadmin can change the browser binaries.", 403);
  return user;
}

function kindOf(request: Request): ObscuraBinaryKind {
  const kind = new URL(request.url).searchParams.get("kind") as ObscuraBinaryKind | null;
  if (!kind || !OBSCURA_BINARY_KINDS.includes(kind)) throw new AuthError("kind must be obscura or obscura-worker.", 400);
  return kind;
}

export async function GET(request: Request) {
  try { requireAdmin(request); return Response.json(await obscuraStatus()); }
  catch (error) { return authErrorResponse(error); }
}

/** The raw executable as the request body. It is checked against this server's OS and CPU before it is kept. */
export async function PUT(request: Request) {
  try {
    const user = superadmin(request);
    const kind = kindOf(request);
    if (!request.body) throw new AuthError("The request has no file.", 400);
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_OBSCURA_BINARY_BYTES) throw new AuthError("The file is too large.", 413);
    const installed = await installUploadedExecutable(request.body, obscuraBinaryPath(kind), MAX_OBSCURA_BINARY_BYTES)
      .catch(error => { throw new AuthError(error instanceof Error ? error.message : String(error), 400); });
    await obscuraBinaryChanged();
    logAdminAudit(user.id, user.id, "browser_binary_installed", `${kind} ${installed.size} bytes`);
    return Response.json(await obscuraStatus());
  } catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = superadmin(request);
    const kind = kindOf(request);
    await removeObscuraBinary(kind);
    logAdminAudit(user.id, user.id, "browser_binary_removed", kind);
    return Response.json(await obscuraStatus());
  } catch (error) { return authErrorResponse(error); }
}

/** {action:"restart"} stops every running browser session; the next call in each chat starts a new one. */
export async function POST(request: Request) {
  try {
    superadmin(request);
    const body = await request.json().catch(() => ({})) as { action?: string };
    if (body.action !== "restart") throw new AuthError("Unknown action.", 400);
    await closeAllObscuraSessions();
    return Response.json(await obscuraStatus());
  } catch (error) { return authErrorResponse(error); }
}
