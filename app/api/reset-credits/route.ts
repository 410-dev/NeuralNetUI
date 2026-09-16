import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { createResetCredit } from "@/lib/plans";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request){try{const actor=requireAdmin(request);return Response.json({credit:createResetCredit(actor,await request.json())},{status:201});}catch(error){return authErrorResponse(error);}}
