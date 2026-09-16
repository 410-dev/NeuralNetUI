import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { createResetCredit } from "@/lib/plans";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request){try{const actor=requireAdmin(request);const credits=createResetCredit(actor,await request.json());return Response.json({credit:credits[0],credits},{status:201});}catch(error){return authErrorResponse(error);}}
