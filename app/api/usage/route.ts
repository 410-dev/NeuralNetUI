import { authErrorResponse, requireUser } from "@/lib/auth";
import { redeemResetCredit, usageStatus } from "@/lib/plans";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{const user=requireUser(request);return Response.json(usageStatus(user.id));}catch(error){return authErrorResponse(error);}}
export async function POST(request:Request){try{const user=requireUser(request);const body=await request.json();return Response.json(redeemResetCredit(user.id,String(body.creditId||"")));}catch(error){return authErrorResponse(error);}}
