import { authErrorResponse, requireUser } from "@/lib/auth";
import { browserViewState, captureBrowserView, controlBrowserView } from "@/lib/browser-tool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function conversationId(request: Request) {
  const value = new URL(request.url).searchParams.get("conversationId") || "";
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("A valid conversationId is required.");
  return value;
}

export async function GET(request: Request) {
  try {
    const user = requireUser(request); const id = conversationId(request);
    const params = new URL(request.url).searchParams;
    if (params.get("frame") === "1") {
      const sessionId = params.get("sessionId") || "";
      if (!sessionId) return Response.json({ error: "A browser session is required." }, { status: 400 });
      const frame = await captureBrowserView(user.id, id, sessionId);
      return new Response(new Uint8Array(frame), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store, max-age=0" } });
    }
    return Response.json(await browserViewState(user.id, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const auth = authErrorResponse(error); if (auth.status !== 500) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "Browser view failed." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = requireUser(request); const id = conversationId(request);
    return Response.json(await controlBrowserView(user.id, id, await request.json()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const auth = authErrorResponse(error); if (auth.status !== 500) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "Browser interaction failed." }, { status: 400 });
  }
}
