import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { listPlans, savePlan } from "@/lib/plans";

export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{requireAdmin(request);return Response.json({plans:listPlans()});}catch(error){return authErrorResponse(error);}}
export async function POST(request:Request){try{requireAdmin(request);return Response.json({plan:savePlan(await request.json())},{status:201});}catch(error){return authErrorResponse(error);}}
