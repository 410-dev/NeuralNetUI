import { authErrorResponse, requireUser } from "@/lib/auth";
import { artifactHtmlAllowed } from "@/lib/plans";

export async function GET(request:Request){
  try {
    const user=requireUser(request);
    return Response.json({htmlEnabled:artifactHtmlAllowed(user.id),accountId:user.id},{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return authErrorResponse(error); }
}
