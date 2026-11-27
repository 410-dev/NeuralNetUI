import { authErrorResponse, requireUser } from "@/lib/auth";
import { startOAuth } from "@/lib/mcp-oauth";
import { MCP_OAUTH_CALLBACK_PATH } from "@/lib/mcp-oauth-presets";
import { publicOrigin } from "@/lib/vm-installer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts the OAuth sign-in of an MCP connection: the provider's authorization URL to open in a new window. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = requireUser(request); const { id } = await context.params;
    const redirectUri = `${publicOrigin(request)}${MCP_OAUTH_CALLBACK_PATH}`;
    return Response.json({ url: startOAuth(user.id, id, redirectUri), redirectUri });
  } catch (error) { return authErrorResponse(error); }
}
