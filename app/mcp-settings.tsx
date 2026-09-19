"use client";

import { Cable, CirclePlus, LoaderCircle, Pencil, PlugZap, ShieldCheck, Trash2, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import type { McpAuthType, McpConnection, McpEntitlement } from "@/lib/types";
import { useModalFocus } from "@/lib/use-modal-focus";
import { SectionTitle } from "./section-title";
import { SelectMenu } from "./select-menu";
import { useMessageDialog } from "./message-dialog";

type McpDraft = { id?: string; name: string; description: string; url: string; authType: McpAuthType; credential: string; enabled: boolean; hasCredential?: boolean };
const emptyDraft = (): McpDraft => ({ name: "", description: "", url: "", authType: "none", credential: "", enabled: true });

function McpConnectionDialog({ ko, initial, onClose, onSaved }: { ko: boolean; initial?: McpConnection; onClose: () => void; onSaved: () => void }) {
  const ref = useModalFocus(onClose);
  const [draft, setDraft] = useState<McpDraft>(() => initial ? { ...initial, description: initial.description || "", credential: "" } : emptyDraft());
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [testing, setTesting] = useState(false);
  const payload = { ...draft, credential: draft.credential.trim() };
  const credentialNeeded = draft.authType !== "none" && !draft.credential.trim() && !draft.hasCredential;
  const valid = Boolean(draft.name.trim() && draft.url.trim() && !credentialNeeded);
  async function test() {
    if (!valid) return;
    setTesting(true); setNotice("");
    try {
      const response = await fetch("/api/mcp-connections/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setNotice(ko ? `연결됨: 도구 ${body.toolCount}개를 확인했습니다.` : `Connected: found ${body.toolCount} tools.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : (ko ? "연결 테스트에 실패했습니다." : "Connection test failed.")); }
    finally { setTesting(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!valid) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(initial ? `/api/mcp-connections/${initial.id}` : "/api/mcp-connections", { method: initial ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
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
      <label className="field"><span>{ko ? "연결 URL" : "Connection URL"}</span><input required type="url" value={draft.url} onChange={event=>setDraft(current=>({...current,url:event.target.value}))} placeholder="https://example.com/mcp"/><small>{ko ? "Streamable HTTP를 지원하는 MCP 엔드포인트를 입력하세요." : "Enter an MCP endpoint that supports Streamable HTTP."}</small></label>
      <label className="field"><span>{ko ? "인증" : "Authentication"}</span><SelectMenu label={ko ? "인증" : "Authentication"} value={draft.authType} options={[{value:"oauth",label:"OAuth"},{value:"api_key",label:ko?"API Key":"API key"},{value:"none",label:ko?"인증 없음":"No authentication"}]} onChange={value=>setDraft(current=>({...current,authType:value as McpAuthType,credential:value==="none"?"":current.credential}))}/></label>
      {draft.authType!=="none"&&<label className="field"><span>{credentialLabel}</span><input type="password" autoComplete="off" required={!draft.hasCredential} value={draft.credential} onChange={event=>setDraft(current=>({...current,credential:event.target.value}))} placeholder={draft.hasCredential?(ko?"저장된 값 유지":"Keep saved value"):"••••••••"}/><small>{draft.authType==="oauth"?(ko?"발급된 OAuth 액세스 토큰을 Bearer 인증으로 전송합니다.":"The issued OAuth access token is sent as Bearer authentication."):(ko?"API 키를 Bearer 인증으로 전송합니다.":"The API key is sent as Bearer authentication.")}</small></label>}
      <div className="general-setting-card general-toggle-card"><div><strong>{ko?"이 연결 사용":"Use this connection"}</strong><small>{ko?"끄면 등록 정보는 유지되지만 채팅 도구에 나타나지 않습니다.":"When off, the record stays saved but is hidden from chat tools."}</small></div><button type="button" role="switch" aria-label={ko?"이 연결 사용":"Use this connection"} aria-checked={draft.enabled} className={`toggle ${draft.enabled?"on":""}`} onClick={()=>setDraft(current=>({...current,enabled:!current.enabled}))}><i/></button></div>
      {notice&&<p className="settings-notice" role="status">{notice}</p>}
      <footer className="mcp-dialog-actions"><button type="button" className="secondary-button" disabled={!valid||testing||busy} onClick={()=>void test()}>{testing?<LoaderCircle className="spin" size={15}/>:<PlugZap size={15}/>} {ko?"연결 테스트":"Test connection"}</button><button className="save-button" disabled={!valid||busy||testing}>{busy?<LoaderCircle className="spin" size={15}/>:<ShieldCheck size={15}/>} {initial?(ko?"변경 저장":"Save changes"):(ko?"등록":"Add connection")}</button></footer>
    </form>
  </div>,document.body);
}

export function McpSettings({ ko, connections: initialConnections, entitlement: initialEntitlement, onChanged }: { ko: boolean; connections: McpConnection[]; entitlement: McpEntitlement; onChanged: (connections: McpConnection[], entitlement: McpEntitlement) => void }) {
  const [connections,setConnections]=useState(initialConnections),[entitlement,setEntitlement]=useState(initialEntitlement),[editing,setEditing]=useState<McpConnection|"new">(),[notice,setNotice]=useState("");
  const {dialog,confirm}=useMessageDialog(ko);
  async function refresh(){const response=await fetch("/api/mcp-connections",{cache:"no-store"}),body=await response.json();if(!response.ok)throw new Error(body.error);setConnections(body.connections);setEntitlement(body.entitlement);onChanged(body.connections,body.entitlement);}
  async function remove(connection:McpConnection){if(!await confirm({tone:"danger",title:ko?"MCP 연결 삭제":"Delete MCP connection",message:ko?`${connection.name} 연결을 삭제할까요?`:`Delete ${connection.name}?`,detail:ko?"저장된 인증 정보도 함께 삭제되며 되돌릴 수 없습니다.":"Its saved credential will also be deleted. This cannot be undone.",confirmLabel:ko?"삭제":"Delete"}))return;const response=await fetch(`/api/mcp-connections/${connection.id}`,{method:"DELETE"});if(!response.ok){const body=await response.json().catch(()=>({}));setNotice(body.error||"Delete failed.");return;}await refresh();}
  const canAdd=entitlement.enabled&&entitlement.usedConnections<entitlement.maxConnections;
  return <div className="settings-section mcp-settings"><SectionTitle icon={<Cable size={19}/>} title={ko?"MCP 연결":"MCP connections"} description={ko?"계정에 연결할 원격 MCP 서버를 등록하고 채팅에서 사용할 도구를 관리합니다.":"Register remote MCP servers for your account and control the tools available in chat."} action={<button className="subtle-action" disabled={!canAdd} onClick={()=>setEditing("new")}><CirclePlus size={15}/>{ko?"MCP 추가":"Add MCP"}</button>}/>
    <div className={`mcp-plan-summary ${entitlement.enabled?"":"disabled"}`}><div><strong>{entitlement.enabled?(ko?"MCP 사용 가능":"MCP available"):(ko?"현재 플랜에서 사용할 수 없음":"Not available on this plan")}</strong><small>{ko?`${entitlement.usedConnections} / ${entitlement.maxConnections}개 등록됨`:`${entitlement.usedConnections} of ${entitlement.maxConnections} registered`}</small></div></div>
    {connections.length?<div className="mcp-connection-list">{connections.map(connection=><article key={connection.id} className={connection.enabled?"":"disabled"}><span className="mcp-connection-mark"><Cable size={18}/></span><div><strong>{connection.name}</strong><small>{connection.description||connection.url}</small><em>{connection.authType==="none"?(ko?"인증 없음":"No auth"):connection.authType==="oauth"?"OAuth":"API Key"}</em></div><span className="mcp-row-actions"><button aria-label={ko?`${connection.name} 수정`:`Edit ${connection.name}`} onClick={()=>setEditing(connection)}><Pencil size={16}/></button><button className="danger" aria-label={ko?`${connection.name} 삭제`:`Delete ${connection.name}`} onClick={()=>void remove(connection)}><Trash2 size={16}/></button></span></article>)}</div>:<div className="mcp-empty"><Cable size={25}/><strong>{ko?"등록된 MCP 연결이 없습니다.":"No MCP connections yet."}</strong><small>{entitlement.enabled?(ko?"MCP를 추가하면 채팅의 도구 메뉴에 표시됩니다.":"Add one to show it in the chat tools menu."):(ko?"관리자가 플랜에서 MCP 사용을 활성화해야 합니다.":"An administrator must enable MCP for your plan.")}</small></div>}
    {notice&&<p className="settings-notice" role="alert">{notice}</p>}
    {editing&&<McpConnectionDialog ko={ko} initial={editing==="new"?undefined:editing} onClose={()=>setEditing(undefined)} onSaved={()=>void refresh().catch(error=>setNotice(error.message))}/>} {dialog}
  </div>;
}
