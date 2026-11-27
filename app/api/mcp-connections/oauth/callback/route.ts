import { finishOAuth } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

function page(ok: boolean, message: string) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NeuralNetUI</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111114;color:#f4f4f5;font:15px/1.5 system-ui,sans-serif}main{max-width:420px;padding:28px;border:1px solid #2a2a30;border-radius:16px;background:#1b1b20;text-align:center}strong{display:block;font-size:17px;margin-bottom:6px;color:${ok ? "#f4f4f5" : "#ef5350"}}small{color:#9a9aa3}</style></head>
<body><main><strong>${ok ? "MCP 로그인 완료" : "MCP 로그인 실패"}</strong><div>${escape(message)}</div><small>${ok ? "이 창은 닫아도 됩니다. NeuralNetUI 설정 화면에 자동으로 반영됩니다." : "NeuralNetUI의 MCP 설정에서 다시 시도해 주세요."}</small></main>
<script>try{window.opener&&window.opener.postMessage({type:"nnui-mcp-oauth",ok:${ok}},location.origin)}catch(e){}${ok ? "setTimeout(function(){window.close()},1500);" : ""}</script></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

/**
 * Where the OAuth provider sends the person back. The session cookie is SameSite=Strict and does not come along on
 * this cross-site redirect, so the one-time state (bound to the account and connection that started the sign-in,
 * valid ten minutes) is what identifies the request.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error"), state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
  if (error) return page(false, `제공자가 로그인을 거부했습니다: ${error}`);
  if (!state || !code) return page(false, "로그인 응답에 필요한 값이 없습니다.");
  try {
    await finishOAuth(state, code);
    return page(true, "MCP 연결에 로그인했습니다.");
  } catch (failure) { return page(false, failure instanceof Error ? failure.message : String(failure)); }
}
