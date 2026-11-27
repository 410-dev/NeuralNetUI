"use client";

import { Cable, ChevronDown, CirclePlus, Cookie, Copy, LogIn, Info, LoaderCircle, Monitor, Pencil, PlugZap, Save, Settings, ShieldCheck, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { McpAuthType, McpConnection, McpEntitlement, McpToolInfo, McpToolPolicy } from "@/lib/types";
import { useModalFocus } from "@/lib/use-modal-focus";
import { SectionTitle } from "./section-title";
import { SelectMenu } from "./select-menu";
import { useMessageDialog } from "./message-dialog";
import { readApiResponse } from "@/lib/client-response";
import { MCP_OAUTH_CALLBACK_PATH, mcpOAuthPreset } from "@/lib/mcp-oauth-presets";

type McpDraft = { id?: string; name: string; description: string; url: string; authType: McpAuthType; credential: string; enabled: boolean; toolTimeoutSeconds: string; hasCredential?: boolean;
  oauthClientId: string; oauthClientSecret: string; oauthAuthorizationUrl: string; oauthTokenUrl: string; oauthScopes: string; toolDefinitions: "full" | "trimmed" | "on_demand" };
const MIN_TOOL_TIMEOUT = 5, MAX_TOOL_TIMEOUT = 600, DEFAULT_TOOL_TIMEOUT = 20;
const emptyDraft = (): McpDraft => ({ name: "", description: "", url: "", authType: "none", credential: "", enabled: true, toolTimeoutSeconds: String(DEFAULT_TOOL_TIMEOUT), oauthClientId: "", oauthClientSecret: "", oauthAuthorizationUrl: "", oauthTokenUrl: "", oauthScopes: "", toolDefinitions: "trimmed" });
const draftFrom = (connection: McpConnection): McpDraft => ({ ...emptyDraft(), ...connection, description: connection.description || "", credential: "", toolTimeoutSeconds: String(connection.toolTimeoutSeconds ?? DEFAULT_TOOL_TIMEOUT),
  oauthClientId: connection.oauth?.clientId || "", oauthAuthorizationUrl: connection.oauth?.authorizationUrl || "", oauthTokenUrl: connection.oauth?.tokenUrl || "", oauthScopes: (connection.oauth?.scopes || []).join("\n") });
/** A known server (Google's Workspace MCP servers) fills the OAuth endpoints and scopes left blank. */
function withPreset(draft: McpDraft): McpDraft {
  // Google's Workspace servers describe every field at length: their definitions go on demand unless changed.
  if (!draft.id && mcpOAuthPreset(draft.url)?.scopes.length && draft.toolDefinitions === "trimmed") draft = { ...draft, toolDefinitions: "on_demand" };
  const preset = draft.authType === "oauth" ? mcpOAuthPreset(draft.url) : undefined;
  if (!preset) return draft;
  return { ...draft, oauthAuthorizationUrl: draft.oauthAuthorizationUrl || preset.authorizationUrl, oauthTokenUrl: draft.oauthTokenUrl || preset.tokenUrl, oauthScopes: draft.oauthScopes || preset.scopes.join("\n") };
}

const policies:McpToolPolicy[]=["blocked","always_ask","session_ask","always_allow"];
function policyLabel(policy:McpToolPolicy,ko:boolean){return ({blocked:ko?"차단":"Block",always_ask:ko?"항상 묻기":"Always ask",session_ask:ko?"세션마다 묻기":"Ask per session",always_allow:ko?"항상 허용":"Always allow"})[policy];}

function McpToolPolicyDialog({ko,connection,onClose}:{ko:boolean;connection:McpConnection;onClose:()=>void}){
  const ref=useModalFocus(onClose),[tools,setTools]=useState<McpToolInfo[]>([]),[busy,setBusy]=useState(true),[saving,setSaving]=useState(false),[notice,setNotice]=useState(""),[details,setDetails]=useState<string>();
  useEffect(()=>{let live=true;void fetch(`/api/mcp-connections/${connection.id}/tools`,{cache:"no-store"}).then(async response=>{const body=await readApiResponse<{tools:McpToolInfo[]}>(response,ko?"ko":"en");if(live)setTools(body.tools);}).catch(error=>live&&setNotice(error instanceof Error?error.message:String(error))).finally(()=>live&&setBusy(false));return()=>{live=false};},[connection.id]);
  async function save(){setSaving(true);setNotice("");try{const response=await fetch(`/api/mcp-connections/${connection.id}/tools`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({tools:tools.map(({name,policy})=>({name,policy}))})});await readApiResponse(response,ko?"ko":"en");onClose();}catch(error){setNotice(error instanceof Error?error.message:String(error));}finally{setSaving(false);}}
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer mcp-modal-layer" role="dialog" aria-modal="true" aria-label={ko?`${connection.name} 도구 권한`:`${connection.name} tool permissions`}><button className="settings-backdrop" tabIndex={-1} onClick={onClose}/><section className="harness-dialog mcp-tool-policy-dialog"><header><div><h2>{ko?"MCP 도구 권한":"MCP tool permissions"}</h2><p>{connection.name} · {ko?"각 도구가 모델에 노출되고 실행되는 방식을 정합니다.":"Choose how each tool is exposed and authorized."}</p></div><button onClick={onClose} aria-label={ko?"닫기":"Close"}><X size={20}/></button></header><div className="mcp-tool-policy-list">{busy?<div className="mcp-tool-loading"><LoaderCircle className="spin" size={20}/>{ko?"도구 목록을 불러오는 중":"Loading tools"}</div>:tools.map(tool=><article key={tool.name}><div className="mcp-tool-policy-heading"><div><strong>{tool.name}</strong><small>{tool.description||(ko?"설명이 제공되지 않았습니다.":"No description provided.")}</small></div><button className="mcp-tool-info" aria-label={ko?`${tool.name} 정보`:`About ${tool.name}`} aria-expanded={details===tool.name} onClick={()=>setDetails(current=>current===tool.name?undefined:tool.name)}><Info size={16}/></button></div>{details===tool.name&&<div className="mcp-tool-detail"><p>{tool.description||(ko?"이 MCP 서버가 상세 설명을 제공하지 않았습니다.":"This MCP server did not provide a detailed description.")}</p><pre>{JSON.stringify(tool.inputSchema||{},null,2)}</pre></div>}<div className="mcp-policy-segments" role="radiogroup" aria-label={ko?`${tool.name} 권한`:`${tool.name} permission`}>{policies.map(policy=><button key={policy} role="radio" aria-checked={tool.policy===policy} className={tool.policy===policy?"active":""} onClick={()=>setTools(current=>current.map(item=>item.name===tool.name?{...item,policy}:item))}>{policyLabel(policy,ko)}</button>)}</div></article>)}</div>{notice&&<p className="settings-notice" role="alert">{notice}</p>}<footer className="mcp-dialog-actions"><button className="secondary-button" onClick={onClose}>{ko?"취소":"Cancel"}</button><button className="save-button" disabled={busy||saving} onClick={()=>void save()}>{saving?<LoaderCircle className="spin" size={15}/>:<ShieldCheck size={15}/>} {ko?"권한 저장":"Save permissions"}</button></footer></section></div>,document.body);
}

function McpConnectionDialog({ ko, initial, onClose, onSaved }: { ko: boolean; initial?: McpConnection; onClose: () => void; onSaved: () => void }) {
  const ref = useModalFocus(onClose);
  const [saved, setSaved] = useState<McpConnection | undefined>(initial);
  const [draft, setDraft] = useState<McpDraft>(() => initial ? draftFrom(initial) : emptyDraft());
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [testing, setTesting] = useState(false), [signingIn, setSigningIn] = useState(false);
  const toolTimeoutSeconds = Number(draft.toolTimeoutSeconds);
  const timeoutValid = Number.isInteger(toolTimeoutSeconds) && toolTimeoutSeconds >= MIN_TOOL_TIMEOUT && toolTimeoutSeconds <= MAX_TOOL_TIMEOUT;
  // OAuth with a client signs in through NeuralNetUI; OAuth without one takes a pasted access token, as before.
  const oauthClient = draft.authType === "oauth" && Boolean(draft.oauthClientId.trim());
  const { oauthClientId, oauthClientSecret, oauthAuthorizationUrl, oauthTokenUrl, oauthScopes, ...base } = draft;
  const payload = { ...base, credential: draft.credential.trim(), toolTimeoutSeconds,
    ...(oauthClient ? { oauth: { clientId: oauthClientId.trim(), clientSecret: oauthClientSecret.trim(), authorizationUrl: oauthAuthorizationUrl.trim(), tokenUrl: oauthTokenUrl.trim(), scopes: oauthScopes.split(/[\s,]+/).map(item => item.trim()).filter(Boolean) } } : {}) };
  const credentialNeeded = draft.authType !== "none" && !oauthClient && !draft.credential.trim() && !draft.hasCredential;
  const redirectUri = typeof window === "undefined" ? "" : `${window.location.origin}${MCP_OAUTH_CALLBACK_PATH}`;
  const secretNeeded = oauthClient && !draft.oauthClientSecret.trim() && !saved?.oauth?.hasClientSecret;
  async function persist() {
    const response = await fetch(saved ? `/api/mcp-connections/${saved.id}` : "/api/mcp-connections", { method: saved ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await readApiResponse<{ connection: McpConnection }>(response, ko ? "ko" : "en");
    setSaved(body.connection); setDraft(current => ({ ...current, id: body.connection.id, hasCredential: body.connection.hasCredential, oauthClientSecret: "" }));
    return body.connection;
  }
  /** Saves, then opens the provider's sign-in in a new window and waits until the connection reports it is signed in. */
  async function signIn() {
    if (!valid || secretNeeded) return;
    const popup = window.open("about:blank", "nnui-mcp-oauth", "width=520,height=720");
    setSigningIn(true); setNotice("");
    try {
      const connection = await persist();
      const started = await readApiResponse<{ url: string; redirectUri: string }>(await fetch(`/api/mcp-connections/${connection.id}/oauth`, { method: "POST" }), ko ? "ko" : "en");
      if (popup && !popup.closed) popup.location.href = started.url; else window.open(started.url, "_blank");
      setNotice(ko ? `새 창에서 로그인하고 권한을 허용해 주세요. (리디렉션 URI: ${started.redirectUri})` : `Sign in and allow access in the new window. (Redirect URI: ${started.redirectUri})`);
      const before = connection.updatedAt;
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const list = await fetch("/api/mcp-connections", { cache: "no-store" }).then(response => response.ok ? response.json() as Promise<{ connections: McpConnection[] }> : undefined).catch(() => undefined);
        const current = list?.connections.find(item => item.id === connection.id);
        if (current?.oauth?.signedIn && current.updatedAt !== before) {
          setSaved(current); setNotice(ko ? "로그인했습니다. 연결 테스트로 도구를 확인해 보세요." : "Signed in. Use Test connection to check the tools."); onSaved(); return;
        }
      }
      setNotice(ko ? "로그인이 확인되지 않았습니다. 다시 시도해 주세요." : "The sign-in was not confirmed. Try again.");
    } catch (error) { if (popup && !popup.closed) popup.close(); setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSigningIn(false); }
  }
  const valid = Boolean(draft.name.trim() && draft.url.trim() && !credentialNeeded && timeoutValid && (!oauthClient || (draft.oauthAuthorizationUrl.trim() && draft.oauthTokenUrl.trim())));
  async function test() {
    if (!valid) return;
    setTesting(true); setNotice("");
    try {
      const response = await fetch("/api/mcp-connections/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, ...(saved ? { id: saved.id } : {}) }) });
      const body = await readApiResponse<{ toolCount: number }>(response, ko ? "ko" : "en");
      setNotice(ko ? `연결됨: 도구 ${body.toolCount}개를 확인했습니다.` : `Connected: found ${body.toolCount} tools.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : (ko ? "연결 테스트에 실패했습니다." : "Connection test failed.")); }
    finally { setTesting(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!valid) return;
    setBusy(true); setNotice("");
    try {
      await persist();
      onSaved(); onClose();
    } catch (error) { setNotice(error instanceof Error ? error.message : (ko ? "MCP 연결을 저장하지 못했습니다." : "Unable to save the MCP connection.")); }
    finally { setBusy(false); }
  }
  const credentialLabel = draft.authType === "oauth" ? (ko ? "OAuth 액세스 토큰" : "OAuth access token") : (ko ? "API 키" : "API key");
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer mcp-modal-layer" role="dialog" aria-modal="true" aria-label={ko ? "MCP 연결 등록" : "Add MCP connection"}>
    <button className="settings-backdrop" tabIndex={-1} onClick={onClose}/>
    <form className="harness-dialog mcp-connection-dialog" onSubmit={save}>
      <header><div><h2>{initial ? (ko ? "MCP 연결 수정" : "Edit MCP connection") : (ko ? "MCP 연결 등록" : "Add MCP connection")}</h2><p>{ko ? "원격 MCP 서버의 기본 정보와 인증 방식을 설정합니다." : "Configure the remote MCP server and its authentication."}</p></div><button type="button" onClick={onClose} aria-label={ko ? "닫기" : "Close"}><X size={20}/></button></header>
      <div className="form-grid"><label className="field"><span>{ko ? "MCP 이름" : "MCP name"}</span><input required maxLength={80} value={draft.name} onChange={event=>setDraft(current=>({...current,name:event.target.value}))} placeholder={ko ? "예: 사내 문서 검색" : "e.g. Internal docs"}/></label><label className="field"><span>{ko ? "설명 (선택)" : "Description (optional)"}</span><input maxLength={500} value={draft.description} onChange={event=>setDraft(current=>({...current,description:event.target.value}))}/></label></div>
      <label className="field"><span>{ko ? "연결 URL" : "Connection URL"}</span><input required type="url" value={draft.url} onChange={event=>setDraft(current=>withPreset({...current,url:event.target.value}))} placeholder="https://example.com/mcp"/><small>{ko ? "Streamable HTTP를 지원하는 MCP 엔드포인트를 입력하세요." : "Enter an MCP endpoint that supports Streamable HTTP."}</small></label>
      <label className="field"><span>{ko ? "인증" : "Authentication"}</span><SelectMenu label={ko ? "인증" : "Authentication"} value={draft.authType} options={[{value:"oauth",label:"OAuth"},{value:"api_key",label:ko?"API Key":"API key"},{value:"none",label:ko?"인증 없음":"No authentication"}]} onChange={value=>setDraft(current=>withPreset({...current,authType:value as McpAuthType,credential:value==="none"?"":current.credential}))}/></label>
      {draft.authType==="oauth"&&<div className="mcp-oauth-box">
        <div className="form-grid"><label className="field"><span>{ko?"클라이언트 ID":"Client ID"}</span><input autoComplete="off" value={draft.oauthClientId} onChange={event=>setDraft(current=>({...current,oauthClientId:event.target.value}))} placeholder="1234-abc.apps.googleusercontent.com"/></label>
          <label className="field"><span>{ko?"클라이언트 시크릿":"Client secret"}</span><input type="password" autoComplete="off" value={draft.oauthClientSecret} onChange={event=>setDraft(current=>({...current,oauthClientSecret:event.target.value}))} placeholder={saved?.oauth?.hasClientSecret?(ko?"저장된 값 유지":"Keep saved value"):"••••••••"}/></label></div>
        {oauthClient&&<><div className="form-grid"><label className="field"><span>{ko?"인증 주소":"Authorization URL"}</span><input value={draft.oauthAuthorizationUrl} onChange={event=>setDraft(current=>({...current,oauthAuthorizationUrl:event.target.value}))} placeholder="https://…/authorize"/></label>
          <label className="field"><span>{ko?"토큰 주소":"Token URL"}</span><input value={draft.oauthTokenUrl} onChange={event=>setDraft(current=>({...current,oauthTokenUrl:event.target.value}))} placeholder="https://…/token"/></label></div>
        <label className="field"><span>{ko?"권한 범위 (scope)":"Scopes"}</span><textarea rows={3} spellCheck={false} value={draft.oauthScopes} onChange={event=>setDraft(current=>({...current,oauthScopes:event.target.value}))}/><small>{ko?"한 줄에 하나씩. Google Gmail·Calendar MCP 주소를 넣으면 인증·토큰 주소와 권한이 자동으로 채워집니다.":"One per line. Google's Gmail and Calendar MCP URLs fill in the endpoints and scopes."}</small></label>
        <div className="field"><span>{ko?"리디렉션 URI (OAuth 클라이언트에 등록)":"Redirect URI (register it on the OAuth client)"}</span><div className="mcp-oauth-redirect"><code>{redirectUri}</code><button type="button" className="subtle-action" onClick={()=>void navigator.clipboard?.writeText(redirectUri)}><Copy size={13}/>{ko?"복사":"Copy"}</button></div></div>
        <div className="mcp-oauth-status"><span>{saved?.oauth?.signedIn?(ko?`로그인됨${saved.oauth.canRefresh?" · 자동 갱신":" · 갱신 토큰 없음(만료되면 다시 로그인)"}`:`Signed in${saved.oauth.canRefresh?" · renews itself":" · no refresh token (sign in again when it expires)"}`):(ko?"로그인 필요":"Not signed in")}</span>
          <button type="button" className="secondary-button" disabled={!valid||secretNeeded||signingIn||busy} onClick={()=>void signIn()}>{signingIn?<LoaderCircle className="spin" size={15}/>:<LogIn size={15}/>} {saved?.oauth?.signedIn?(ko?"다시 로그인":"Sign in again"):(ko?"저장하고 로그인":"Save and sign in")}</button></div></>}
      </div>}
      {draft.authType!=="none"&&!oauthClient&&<label className="field"><span>{credentialLabel}</span><input type="password" autoComplete="off" required={!draft.hasCredential} value={draft.credential} onChange={event=>setDraft(current=>({...current,credential:event.target.value}))} placeholder={draft.hasCredential?(ko?"저장된 값 유지":"Keep saved value"):"••••••••"}/><small>{draft.authType==="oauth"?(ko?"발급된 OAuth 액세스 토큰을 Bearer 인증으로 전송합니다. 클라이언트 ID를 넣으면 NeuralNetUI가 직접 로그인하고 토큰을 갱신합니다.":"The issued OAuth access token is sent as Bearer authentication. Enter a client ID to have NeuralNetUI sign in and renew the token."):(ko?"API 키를 Bearer 인증으로 전송합니다.":"The API key is sent as Bearer authentication.")}</small></label>}
      <label className="field"><span>{ko?"도구 정의 전달 방식":"Tool definitions sent to the model"}</span><SelectMenu label={ko?"도구 정의 전달 방식":"Tool definitions"} value={draft.toolDefinitions} options={[{value:"trimmed",label:ko?"길이 제한 (기본)":"Length-capped (default)"},{value:"on_demand",label:ko?"필요할 때만":"On demand"},{value:"full",label:ko?"전체":"Full"}]} onChange={value=>setDraft(current=>({...current,toolDefinitions:value as McpDraft["toolDefinitions"]}))}/><small>{draft.toolDefinitions==="on_demand"
        ?(ko?"요청마다 도구 이름과 한 줄 설명만 보냅니다. 모델이 쓰려는 도구의 전체 설명과 입력 형식은 get_tool_details로 그때 받아 봅니다(처음 쓰는 도구마다 한 번 더 왕복). 도구가 많고 설명이 긴 서버(Google Gmail·Calendar 등)에 알맞습니다.":"Only names and one-line summaries go with each request; the model reads a tool's full description and arguments with get_tool_details when it needs them (one extra round trip per tool). Suits servers with many, long tools such as Google Gmail and Calendar.")
        :draft.toolDefinitions==="full"?(ko?"서버가 보낸 설명과 입력 형식을 그대로 보냅니다.":"Descriptions and argument schemas go as the server sends them.")
        :(ko?"도구 설명은 1,000자, 입력 항목 설명은 300자에서 자릅니다. 형식·필수 항목·선택지는 그대로입니다.":"Tool descriptions are cut at 1,000 characters and field descriptions at 300; types, required fields and choices stay.")}</small></label>
      <label className="field"><span>{ko?"도구 실행 타임아웃 (초)":"Tool timeout (seconds)"}</span><input required type="number" inputMode="numeric" min={MIN_TOOL_TIMEOUT} max={MAX_TOOL_TIMEOUT} step={1} value={draft.toolTimeoutSeconds} aria-invalid={!timeoutValid} onChange={event=>setDraft(current=>({...current,toolTimeoutSeconds:event.target.value}))}/><small>{ko?`도구 한 번 호출의 최대 대기 시간입니다. ${MIN_TOOL_TIMEOUT}~${MAX_TOOL_TIMEOUT}초, 기본값 ${DEFAULT_TOOL_TIMEOUT}초.`:`Maximum wait for a single tool call. ${MIN_TOOL_TIMEOUT}–${MAX_TOOL_TIMEOUT} seconds, default ${DEFAULT_TOOL_TIMEOUT}.`}</small></label>
      <div className="general-setting-card general-toggle-card"><div><strong>{ko?"이 연결 사용":"Use this connection"}</strong><small>{ko?"끄면 등록 정보는 유지되지만 채팅 도구에 나타나지 않습니다.":"When off, the record stays saved but is hidden from chat tools."}</small></div><button type="button" role="switch" aria-label={ko?"이 연결 사용":"Use this connection"} aria-checked={draft.enabled} className={`toggle ${draft.enabled?"on":""}`} onClick={()=>setDraft(current=>({...current,enabled:!current.enabled}))}><i/></button></div>
      {notice&&<p className="settings-notice" role="status">{notice}</p>}
      <footer className="mcp-dialog-actions"><button type="button" className="secondary-button" disabled={!valid||testing||busy} onClick={()=>void test()}>{testing?<LoaderCircle className="spin" size={15}/>:<PlugZap size={15}/>} {ko?"연결 테스트":"Test connection"}</button><button className="save-button" disabled={!valid||busy||testing}>{busy?<LoaderCircle className="spin" size={15}/>:<ShieldCheck size={15}/>} {initial?(ko?"변경 저장":"Save changes"):(ko?"등록":"Add connection")}</button></footer>
    </form>
  </div>,document.body);
}

type VmInfo = { distribution?: string; os?: string; architecture?: string; environment?: string; gui?: { available: boolean; control: boolean; reason?: string | null }; browser?: { version?: string | null; stealth?: boolean }; workspace?: { home?: string; account?: string | null } };

/** The URL people paste may be the server root or its /mcp endpoint; the connection stores the endpoint. */
const vmEndpoint = (value: string) => { const trimmed = value.trim().replace(/\/+$/, ""); return !trimmed ? "" : /\/mcp$/.test(trimmed) ? trimmed : `${trimmed}/mcp`; };

/**
 * The account's virtual computer: one fixed entry above the other MCP servers, outside the plan's MCP allowance.
 * Shows how to install the server, takes its address and key, and once connected what the computer offers.
 */
/**
 * The account browser's cookies, as cookies.txt. They are kept on the virtual computer only: the dialog loads them
 * from there and saves the edited text back; NeuralNetUI stores nothing.
 */
function VmCookiesDialog({ ko, onClose }: { ko: boolean; onClose: () => void }) {
  const ref = useModalFocus(onClose);
  const [text, setText] = useState(""), [loaded, setLoaded] = useState(false), [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(""), [count, setCount] = useState<number>();
  useEffect(() => {
    let live = true;
    void fetch("/api/vm/cookies", { cache: "no-store" }).then(response => readApiResponse<{ cookiesTxt: string; count: number }>(response, ko ? "ko" : "en"))
      .then(body => { if (live) { setText(body.cookiesTxt); setCount(body.count); setLoaded(true); } })
      .catch(error => live && setNotice(error instanceof Error ? error.message : String(error)));
    return () => { live = false; };
  }, [ko]);
  async function save() {
    setSaving(true); setNotice("");
    try {
      const body = await readApiResponse<{ cookiesTxt: string; count: number; problems?: string[] }>(await fetch("/api/vm/cookies", { method: "PUT", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: text }), ko ? "ko" : "en");
      setText(body.cookiesTxt); setCount(body.count);
      setNotice(body.problems?.length ? (ko ? `쿠키 ${body.count}개를 적용했습니다. 읽지 못한 줄: ${body.problems.join(", ")}` : `Applied ${body.count} cookies. Lines skipped: ${body.problems.join(", ")}`) : (ko ? `쿠키 ${body.count}개를 가상 컴퓨터에 적용했습니다.` : `Applied ${body.count} cookies on the virtual computer.`));
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setSaving(false); }
  }
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer mcp-modal-layer" role="dialog" aria-modal="true" aria-label={ko ? "브라우저 쿠키" : "Browser cookies"}>
    <button className="settings-backdrop" tabIndex={-1} onClick={onClose} />
    <section className="harness-dialog vm-cookies-dialog">
      <header><div><h2>{ko ? "브라우저 쿠키" : "Browser cookies"}</h2><p>{ko ? "이 계정의 모든 채팅과 에이전트가 가상 컴퓨터에서 함께 쓰는 쿠키입니다. cookies.txt(Netscape 형식)를 붙여 넣고 적용하면 전체가 이 내용으로 바뀌며, 실행 중인 브라우저는 닫혔다가 다음 사용 때 새 쿠키로 열립니다. 쿠키는 가상 컴퓨터에만 저장되고 NeuralNetUI에는 남지 않습니다." : "Cookies every chat and the agent share in the virtual computer's browser. Paste a cookies.txt (Netscape format) and apply: it replaces the whole jar, and running browsers close and reopen with it next time. They are stored on the virtual computer only, never in NeuralNetUI."}</p></div><button onClick={onClose} aria-label={ko ? "닫기" : "Close"}><X size={20} /></button></header>
      {!loaded && !notice ? <div className="mcp-tool-loading"><LoaderCircle className="spin" size={20} />{ko ? "가상 컴퓨터에서 불러오는 중" : "Loading from the virtual computer"}</div>
        : <textarea className="vm-cookies-text" spellCheck={false} value={text} disabled={!loaded || saving} onChange={event => setText(event.target.value)} placeholder={"# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t1830000000\tname\tvalue"} aria-label="cookies.txt" />}
      {loaded && count !== undefined && <small className="vm-cookies-count">{ko ? `저장된 쿠키 ${count}개` : `${count} cookies stored`}</small>}
      {notice && <p className="settings-notice" role="alert">{notice}</p>}
      <footer className="mcp-dialog-actions"><button className="secondary-button" onClick={onClose}>{ko ? "닫기" : "Close"}</button><button className="save-button" disabled={!loaded || saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} {ko ? "가상 컴퓨터에 적용" : "Apply on the virtual computer"}</button></footer>
    </section>
  </div>, document.body);
}

function VirtualComputerCard({ ko, connection, onChanged, onPermissions, onRemove }: { ko: boolean; connection?: McpConnection; onChanged: () => void; onPermissions: (connection: McpConnection) => void; onRemove: (connection: McpConnection) => void }) {
  const [editing, setEditing] = useState(!connection);
  // Folded by default: only the title, description and switch show until it is opened.
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(connection?.url || ""), [key, setKey] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [copied, setCopied] = useState(false);
  const [info, setInfo] = useState<{ info: VmInfo | null; error?: string }>();
  const [cookies, setCookies] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const command = `curl -fsSL ${origin}/api/vm/install | sudo bash -s -- --tunnel-token '<${ko ? "Cloudflare 터널 토큰 또는 명령어" : "Cloudflare tunnel token or command"}>'`;
  useEffect(() => { if (!connection || !open) return; setInfo(undefined); fetch("/api/vm/info", { cache: "no-store" }).then(response => response.json()).then(setInfo).catch(error => setInfo({ info: null, error: String(error) })); }, [connection, open]);
  const payload = () => ({ ...(connection ? { id: connection.id } : {}), kind: "vm", name: ko ? "가상 컴퓨터" : "Virtual computer", description: "", url: vmEndpoint(url), authType: "api_key", credential: key.trim(), enabled: connection?.enabled ?? true, ...(connection ? { toolTimeoutSeconds: connection.toolTimeoutSeconds } : {}) });
  async function test() {
    setBusy(true); setNotice("");
    try { const body = await readApiResponse<{ toolCount: number }>(await fetch("/api/mcp-connections/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) }), ko ? "ko" : "en"); setNotice(ko ? `연결됨 · 도구 ${body.toolCount}개` : `Connected · ${body.toolCount} tools`); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  async function save(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setNotice("");
    try {
      await readApiResponse(await fetch(connection ? `/api/mcp-connections/${connection.id}` : "/api/mcp-connections", { method: connection ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) }), ko ? "ko" : "en");
      setEditing(false); setKey(""); onChanged();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  async function toggle() {
    if (!connection) return;
    await fetch(`/api/mcp-connections/${connection.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload(), enabled: !connection.enabled }) }).catch(() => undefined);
    onChanged();
  }
  const detail = info?.info;
  return <section className={`vm-card ${connection && !connection.enabled ? "disabled" : ""} ${open ? "open" : ""}`}>
    <header><span className="mcp-connection-mark"><Monitor size={18} /></span><div><strong>{ko ? "가상 컴퓨터" : "Virtual computer"}</strong><small>{ko ? "모델이 셸 명령, 백그라운드 작업, 화면 캡처·마우스·키보드(GUI가 있을 때), 파일 주고받기를 쓸 수 있는 내 컴퓨터입니다. 등록하면 브라우저 도구도 이 컴퓨터에서 실행됩니다. MCP 등록 개수에 포함되지 않습니다." : "Your own computer the model can use: shell commands, background jobs, screen, mouse and keyboard (with a GUI) and file transfer. Once registered, the browser tool runs there too. It does not count toward your MCP limit."}</small></div>
      {connection && <button type="button" role="switch" aria-checked={connection.enabled} aria-label={ko ? "가상 컴퓨터 사용" : "Use the virtual computer"} className={`toggle ${connection.enabled ? "on" : ""}`} onClick={() => void toggle()}><i /></button>}
      <button type="button" className="vm-fold" aria-expanded={open} aria-label={open ? (ko ? "접기" : "Collapse") : (ko ? "펼치기" : "Expand")} onClick={() => setOpen(value => !value)}><ChevronDown size={17} /></button></header>
    {open && connection && !editing && <div className="vm-status">
      <code>{connection.url}</code>
      {!info ? <span className="vm-info"><LoaderCircle size={13} className="spin" />{ko ? "확인 중" : "Checking"}</span> : detail ? <span className="vm-info">
        <span>{detail.distribution || detail.os} · {detail.architecture} · {detail.environment}</span>
        <span>{detail.gui?.available ? (detail.gui.control ? (ko ? "GUI: 화면·마우스·키보드 사용 가능" : "GUI: screen, mouse and keyboard") : (ko ? "GUI: 화면 캡처만" : "GUI: screenshots only")) : (ko ? "GUI 없음 (셸·파일·브라우저만)" : "No GUI (shell, files, browser)")}</span>
        <span>{detail.browser?.version ? `${detail.browser.version}${detail.browser.stealth ? " · stealth" : ""}` : (ko ? "브라우저 없음" : "No browser")}</span>
      </span> : <span className="vm-info error">{info.error || (ko ? "연결할 수 없습니다." : "Not reachable.")}</span>}
      <span className="vm-actions"><button type="button" className="subtle-action" onClick={() => onPermissions(connection)}><ShieldCheck size={14} />{ko ? "도구 권한" : "Tool permissions"}</button><button type="button" className="subtle-action" onClick={() => setCookies(true)}><Cookie size={14} />Cookies</button><button type="button" className="subtle-action" onClick={() => setEditing(true)}><Pencil size={14} />{ko ? "수정" : "Edit"}</button><button type="button" className="subtle-action danger" onClick={() => onRemove(connection)}><Trash2 size={14} />{ko ? "삭제" : "Delete"}</button></span>
    </div>}
    {cookies && <VmCookiesDialog ko={ko} onClose={() => setCookies(false)} />}
    {open && editing && <form className="vm-form" onSubmit={save}>
      <div className="vm-install"><span>{ko ? "1. 가상 컴퓨터로 쓸 리눅스(LXC·Docker·실제 컴퓨터)나 macOS에서 설치합니다. 끝나면 주소와 키가 출력됩니다." : "1. Install on the Linux machine (LXC, Docker or bare metal) or Mac you want to use. It prints an address and a key."}</span>
        <code>{command}</code>
        <button type="button" className="subtle-action" onClick={() => { void navigator.clipboard?.writeText(command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}><Copy size={13} />{copied ? (ko ? "복사됨" : "Copied") : (ko ? "명령 복사" : "Copy command")}</button>
        <small>{ko ? "터널 없이 같은 네트워크에서 쓰려면 --tunnel-token 대신 --bind 0.0.0.0 을, 화면 제어 도구까지 설치하려면 --gui 를 붙입니다. Docker는 저장소의 vm-agent 폴더(docker compose up -d)를 쓰면 됩니다." : "Without a tunnel on the same network, use --bind 0.0.0.0 instead of --tunnel-token; add --gui for screen and input tools. For Docker, use the repository's vm-agent folder (docker compose up -d)."}</small></div>
      <label className="field"><span>{ko ? "2. 주소" : "2. Address"}</span><input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://vm.example.com/mcp" /></label>
      <label className="field"><span>{ko ? "3. 키" : "3. Key"}</span><input type="password" value={key} onChange={event => setKey(event.target.value)} placeholder={connection?.hasCredential ? (ko ? "저장된 키 유지" : "Keep the saved key") : ""} /></label>
      <span className="vm-actions">{connection && <button type="button" className="secondary-button" onClick={() => { setEditing(false); setUrl(connection.url); setKey(""); }}>{ko ? "취소" : "Cancel"}</button>}<button type="button" className="secondary-button" disabled={busy || !url.trim() || (!key.trim() && !connection?.hasCredential)} onClick={() => void test()}><PlugZap size={14} />{ko ? "연결 확인" : "Test"}</button><button type="submit" className="save-button" disabled={busy || !url.trim() || (!key.trim() && !connection?.hasCredential)}>{busy ? <LoaderCircle size={14} className="spin" /> : null}{connection ? (ko ? "저장" : "Save") : (ko ? "등록" : "Register")}</button></span>
    </form>}
    {open && notice && <p className="settings-notice" role="status">{notice}</p>}
  </section>;
}

export function McpSettings({ ko, connections: initialConnections, entitlement: initialEntitlement, onChanged }: { ko: boolean; connections: McpConnection[]; entitlement: McpEntitlement; onChanged: (connections: McpConnection[], entitlement: McpEntitlement) => void }) {
  const [connections,setConnections]=useState(initialConnections),[entitlement,setEntitlement]=useState(initialEntitlement),[editing,setEditing]=useState<McpConnection|"new">(),[permissions,setPermissions]=useState<McpConnection>(),[notice,setNotice]=useState("");
  const {dialog,confirm}=useMessageDialog(ko);
  async function refresh(){const response=await fetch("/api/mcp-connections",{cache:"no-store"}),body=await readApiResponse<{connections:McpConnection[];entitlement:McpEntitlement}>(response,ko?"ko":"en");setConnections(body.connections);setEntitlement(body.entitlement);onChanged(body.connections,body.entitlement);}
  async function remove(connection:McpConnection){if(!await confirm({tone:"danger",title:ko?"MCP 연결 삭제":"Delete MCP connection",message:ko?`${connection.name} 연결을 삭제할까요?`:`Delete ${connection.name}?`,detail:ko?"저장된 인증 정보도 함께 삭제되며 되돌릴 수 없습니다.":"Its saved credential will also be deleted. This cannot be undone.",confirmLabel:ko?"삭제":"Delete"}))return;const response=await fetch(`/api/mcp-connections/${connection.id}`,{method:"DELETE"});if(!response.ok){const body=await response.json().catch(()=>({}));setNotice(body.error||"Delete failed.");return;}await refresh();}
  const canAdd=entitlement.enabled&&entitlement.usedConnections<entitlement.maxConnections;
  const vm=connections.find(connection=>connection.kind==="vm"),userConnections=connections.filter(connection=>connection.kind!=="vm");
  return <div className="settings-section mcp-settings"><SectionTitle icon={<Cable size={19}/>} title={ko?"MCP 연결":"MCP connections"} description={ko?"계정에 연결할 원격 MCP 서버를 등록하고 채팅에서 사용할 도구를 관리합니다.":"Register remote MCP servers for your account and control the tools available in chat."} action={<button className="subtle-action" disabled={!canAdd} onClick={()=>setEditing("new")}><CirclePlus size={15}/>{ko?"MCP 추가":"Add MCP"}</button>}/>
    <VirtualComputerCard key={vm?.id || "new"} ko={ko} connection={vm} onChanged={()=>void refresh().catch(error=>setNotice(error.message))} onPermissions={setPermissions} onRemove={connection=>void remove(connection)} />
    <div className={`mcp-plan-summary ${entitlement.enabled?"":"disabled"}`}><div><strong>{entitlement.enabled?(ko?"MCP 사용 가능":"MCP available"):(ko?"현재 플랜에서 사용할 수 없음":"Not available on this plan")}</strong><small>{ko?`${entitlement.usedConnections} / ${entitlement.maxConnections}개 등록됨`:`${entitlement.usedConnections} of ${entitlement.maxConnections} registered`}</small></div></div>
    {userConnections.length?<div className="mcp-connection-list">{userConnections.map(connection=><article key={connection.id} className={connection.enabled?"":"disabled"}><span className="mcp-connection-mark"><Cable size={18}/></span><div><strong>{connection.name}</strong><small>{connection.description||connection.url}</small><em>{connection.authType==="none"?(ko?"인증 없음":"No auth"):connection.authType==="oauth"?(connection.oauth&&!connection.oauth.signedIn?(ko?"OAuth · 로그인 필요":"OAuth · sign-in needed"):"OAuth"):"API Key"}</em></div><span className="mcp-row-actions"><button disabled={!connection.enabled} aria-label={ko?`${connection.name} 도구 권한`:`${connection.name} tool permissions`} onClick={()=>setPermissions(connection)}><Settings size={16}/></button><button aria-label={ko?`${connection.name} 수정`:`Edit ${connection.name}`} onClick={()=>setEditing(connection)}><Pencil size={16}/></button><button className="danger" aria-label={ko?`${connection.name} 삭제`:`Delete ${connection.name}`} onClick={()=>void remove(connection)}><Trash2 size={16}/></button></span></article>)}</div>:<div className="mcp-empty"><Cable size={25}/><strong>{ko?"등록된 MCP 연결이 없습니다.":"No MCP connections yet."}</strong><small>{entitlement.enabled?(ko?"MCP를 추가하면 채팅의 도구 메뉴에 표시됩니다.":"Add one to show it in the chat tools menu."):(ko?"관리자가 플랜에서 MCP 사용을 활성화해야 합니다.":"An administrator must enable MCP for your plan.")}</small></div>}
    {notice&&<p className="settings-notice" role="alert">{notice}</p>}
    {editing&&<McpConnectionDialog ko={ko} initial={editing==="new"?undefined:editing} onClose={()=>setEditing(undefined)} onSaved={()=>void refresh().catch(error=>setNotice(error.message))}/>} {permissions&&<McpToolPolicyDialog ko={ko} connection={permissions} onClose={()=>setPermissions(undefined)}/>} {dialog}
  </div>;
}
