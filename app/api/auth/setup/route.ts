import { authErrorResponse, createFirstUser, createSession } from "@/lib/auth";
import { readConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const config = await readConfig();
    const id = await createFirstUser(await request.json(), {
      storage: config.userStorageSettings.defaultQuotaBytes,
      trash: config.userStorageSettings.defaultTrashQuotaBytes,
    });
    return Response.json({ ok: true }, { status: 201, headers: { "Set-Cookie": createSession(id, request) } });
  } catch (error) { return authErrorResponse(error); }
}
