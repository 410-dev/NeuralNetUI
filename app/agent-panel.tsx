"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bell, BellOff, Brain, CalendarClock, Check, ChevronLeft, ChevronRight, Clock, Cog, History, Layers, ListTodo, LoaderCircle, Plus, Repeat, Settings, Square, Timer, Trash2, X } from "lucide-react";
import { useModalFocus } from "@/lib/use-modal-focus";
import { BUILTIN_TOOL_PROVIDERS } from "@/lib/tools/catalog";
import type { ModelConfig, StoredMessage } from "@/lib/types";

export type AgentDecision = "allow" | "ask";
export type AgentToolRule = { read?: AgentDecision; write?: AgentDecision; tools?: Record<string, AgentDecision> };
export type AgentClientSettings = { enabled: boolean; modelId?: string; subagentModelId?: string; heartbeatMinutes: number; instructions: string; compactPercent: number; toolRules: Record<string, AgentToolRule> };
export type AgentRunView = { id: string; kind: "task" | "heartbeat" | "schedule"; title: string; instructions: string; status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled"; result?: string; error?: string; conversationId?: string; createdAt: string; startedAt?: string; finishedAt?: string };
export type AgentScheduleView = { id: string; kind: "once" | "recurring"; title: string; instructions: string; nextRunAt?: string; intervalMinutes?: number; enabled: boolean; lastRunAt?: string };
export type AgentState = {
  access: { enabled: boolean; minIntervalMinutes: number };
  revision?: number; conversationId?: string; settings?: AgentClientSettings; mainBusy?: boolean;
  nextHeartbeatAt?: string | null; activeRuns?: AgentRunView[]; reminders?: AgentScheduleView[]; recurring?: AgentScheduleView[];
  counts?: { memories: number; events: number; todos: number }; push?: { publicKey: string; devices: number };
};
type ItemKind = "memory" | "event" | "todo";
type AgentItem = { id: string; kind: ItemKind; title: string; body?: string; status?: string; startsAt?: string; endsAt?: string; updatedAt: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

const when = (value: string | undefined | null, ko: boolean) => value ? new Date(value).toLocaleString(ko ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const minutesLabel = (minutes: number, ko: boolean) => minutes % 1440 === 0 ? (ko ? `${minutes / 1440}일` : `${minutes / 1440} d`) : minutes % 60 === 0 ? (ko ? `${minutes / 60}시간` : `${minutes / 60} h`) : (ko ? `${minutes}분` : `${minutes} min`);
const runStatus = (status: AgentRunView["status"], ko: boolean) => ({ queued: ko ? "대기열" : "Queued", running: ko ? "실행 중" : "Running", waiting: ko ? "승인 대기" : "Needs approval", completed: ko ? "완료" : "Done", failed: ko ? "실패" : "Failed", cancelled: ko ? "취소됨" : "Cancelled" })[status];
const runKind = (kind: AgentRunView["kind"], ko: boolean) => ({ task: ko ? "작업" : "Task", heartbeat: ko ? "주기 점검" : "Periodic check", schedule: ko ? "예약 작업" : "Scheduled" })[kind];

/** Re-renders every few seconds so relative times stay current. */
function useNow(interval = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), interval); return () => window.clearInterval(timer); }, [interval]);
  return now;
}

function Section({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <section className="agent-panel-section"><header><span>{icon}{title}</span>{action}</header>{children}</section>;
}

/**
 * The agent's control panel: running subagents, memory and schedule management, scheduled reminders and recurring
 * work, the next periodic check, the prompt cache, and entry points to settings, subagent history and the context.
 * Floating on the right on wide screens; behind a gear button as an animated dropdown on phones.
 */
export function AgentControlPanel({ ko, state, cache, onOpen, onChanged }: {
  ko: boolean; state: AgentState; cache?: { expiresAt: number; label: string };
  onOpen: (target: "settings" | "runs" | "context" | ItemKind, runId?: string) => void; onChanged: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const now = useNow(10_000);
  const closeMenu = useCallback(() => { setClosing(true); window.setTimeout(() => { setMenuOpen(false); setClosing(false); }, 160); }, []);
  const remove = async (id: string) => { await api("/api/agent/schedules", { method: "DELETE", body: JSON.stringify({ id }) }).catch(() => undefined); onChanged(); };
  const toggle = async (schedule: AgentScheduleView) => { await api("/api/agent/schedules", { method: "PATCH", body: JSON.stringify({ id: schedule.id, enabled: !schedule.enabled }) }).catch(() => undefined); onChanged(); };
  const cancel = async (id: string) => { await api("/api/agent/runs", { method: "POST", body: JSON.stringify({ action: "cancel", id }) }).catch(() => undefined); onChanged(); };
  const cacheLeft = cache ? Math.max(0, cache.expiresAt - now) : 0;
  const body = <div className="agent-panel-body">
    <Section icon={<LoaderCircle size={14} className={state.activeRuns?.some(run => run.status === "running") ? "spin" : ""} />} title={ko ? "작동 중인 서브에이전트" : "Running subagents"}>
      {state.activeRuns?.length ? <ul className="agent-panel-list">{state.activeRuns.map(run => <li key={run.id}><button type="button" className="agent-panel-item" onClick={() => onOpen("runs", run.id)}><strong>{run.title}</strong><small className={`agent-run-status ${run.status}`}>{runKind(run.kind, ko)} · {runStatus(run.status, ko)}</small></button><button type="button" className="agent-panel-icon" title={ko ? "중지" : "Stop"} aria-label={ko ? "중지" : "Stop"} onClick={() => void cancel(run.id)}><Square size={12} /></button></li>)}</ul> : <p className="agent-panel-empty">{ko ? "없음" : "None"}</p>}
    </Section>
    <div className="agent-panel-buttons">
      <button type="button" onClick={() => onOpen("memory")}><Brain size={15} />{ko ? "기억 관리" : "Memories"}<em>{state.counts?.memories ?? 0}</em></button>
      <button type="button" onClick={() => onOpen("event")}><CalendarClock size={15} />{ko ? "일정 관리" : "Schedule"}<em>{state.counts?.events ?? 0}</em></button>
      <button type="button" onClick={() => onOpen("todo")}><ListTodo size={15} />{ko ? "할 일" : "To-dos"}<em>{state.counts?.todos ?? 0}</em></button>
    </div>
    <Section icon={<Timer size={14} />} title={ko ? "예약된 할 일" : "Scheduled reminders"}>
      {state.reminders?.length ? <ul className="agent-panel-list">{state.reminders.map(item => <li key={item.id}><span className="agent-panel-item" title={item.instructions}><strong>{item.title}</strong><small>{when(item.nextRunAt, ko)}</small></span><button type="button" className="agent-panel-icon" title={ko ? "삭제" : "Delete"} aria-label={ko ? "삭제" : "Delete"} onClick={() => void remove(item.id)}><X size={12} /></button></li>)}</ul> : <p className="agent-panel-empty">{ko ? "없음" : "None"}</p>}
    </Section>
    <Section icon={<Repeat size={14} />} title={ko ? "예약된 주기 작업" : "Recurring work"}>
      {state.recurring?.length ? <ul className="agent-panel-list">{state.recurring.map(item => <li key={item.id} className={item.enabled ? "" : "off"}><span className="agent-panel-item" title={item.instructions}><strong>{item.title}</strong><small>{ko ? `${minutesLabel(item.intervalMinutes || 0, ko)}마다` : `Every ${minutesLabel(item.intervalMinutes || 0, ko)}`}{item.enabled && item.nextRunAt ? ` · ${ko ? "다음" : "next"} ${when(item.nextRunAt, ko)}` : item.enabled ? "" : ` · ${ko ? "일시 중지" : "paused"}`}</small></span><button type="button" role="switch" aria-checked={item.enabled} aria-label={item.title} className={`toggle small ${item.enabled ? "on" : ""}`} onClick={() => void toggle(item)}><i /></button><button type="button" className="agent-panel-icon" title={ko ? "삭제" : "Delete"} aria-label={ko ? "삭제" : "Delete"} onClick={() => void remove(item.id)}><X size={12} /></button></li>)}</ul> : <p className="agent-panel-empty">{ko ? "없음" : "None"}</p>}
    </Section>
    <Section icon={<Clock size={14} />} title={ko ? "다음 갱신 실행" : "Next periodic check"}>
      <p className="agent-panel-value">{state.settings?.enabled === false ? (ko ? "자동 실행 꺼짐" : "Automatic runs off") : state.nextHeartbeatAt ? `${when(state.nextHeartbeatAt, ko)} (${relative(Date.parse(state.nextHeartbeatAt) - now, ko)})` : (ko ? "곧 예약됩니다" : "Being scheduled")}</p>
    </Section>
    {cache && <Section icon={<Timer size={14} />} title={ko ? "캐시 남은 시간" : "Prompt cache"}>
      <p className="agent-panel-value">{cacheLeft <= 0 ? (ko ? "만료됨" : "Expired") : cacheLeft < 60_000 ? (ko ? "1분 미만" : "Under 1 min") : (ko ? `${Math.ceil(cacheLeft / 60_000)}분 남음` : `${Math.ceil(cacheLeft / 60_000)} min left`)}<small>{cache.label}</small></p>
    </Section>}
    <div className="agent-panel-links">
      <button type="button" onClick={() => onOpen("settings")}><Settings size={15} />{ko ? "에이전트 설정" : "Agent settings"}<ChevronRight size={14} /></button>
      <button type="button" onClick={() => onOpen("runs")}><History size={15} />{ko ? "서브에이전트 기록" : "Subagent history"}<ChevronRight size={14} /></button>
      <button type="button" onClick={() => onOpen("context")}><Layers size={15} />{ko ? "컨텍스트 열어보기" : "View context"}<ChevronRight size={14} /></button>
    </div>
  </div>;
  return <>
    <aside className="agent-panel desktop" aria-label={ko ? "에이전트 컨트롤 패널" : "Agent control panel"}>{body}</aside>
    <div className="agent-panel-mobile">
      <button type="button" className={`agent-gear ${menuOpen && !closing ? "open" : ""}`} aria-label={ko ? "에이전트 메뉴" : "Agent menu"} aria-expanded={menuOpen && !closing} onClick={() => menuOpen ? closeMenu() : setMenuOpen(true)}><Cog size={18} /></button>
      {menuOpen && <><button type="button" className="agent-menu-scrim" aria-label={ko ? "닫기" : "Close"} onClick={closeMenu} /><div className={`agent-panel dropdown ${closing ? "closing" : ""}`} onClick={event => { if ((event.target as HTMLElement).closest(".agent-panel-links button, .agent-panel-buttons button, .agent-panel-item")) closeMenu(); }}>{body}</div></>}
    </div>
  </>;
}

function relative(ms: number, ko: boolean) {
  const minutes = Math.round(ms / 60_000);
  if (minutes <= 0) return ko ? "곧" : "soon";
  if (minutes < 60) return ko ? `${minutes}분 후` : `in ${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return ko ? `${hours}시간${rest ? ` ${rest}분` : ""} 후` : `in ${hours} h${rest ? ` ${rest} min` : ""}`;
}

function Dialog({ title, subtitle, ko, onClose, children, footer, wide = false, onBack }: { title: string; subtitle?: string; ko: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; onBack?: () => void }) {
  const ref = useModalFocus(onClose);
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer agent-dialog-layer" role="dialog" aria-modal="true" aria-label={title}>
    <button className="settings-backdrop" tabIndex={-1} onClick={onClose} aria-label={ko ? "닫기" : "Close"} />
    <section className={`harness-dialog agent-dialog ${wide ? "wide" : ""}`}>
      <header><div className="agent-dialog-title">{onBack && <button type="button" onClick={onBack} aria-label={ko ? "뒤로" : "Back"}><ChevronLeft size={18} /></button>}<div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div><button type="button" onClick={onClose} aria-label={ko ? "닫기" : "Close"}><X size={20} /></button></header>
      <div className="agent-dialog-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </section>
  </div>, document.body);
}

const isoLocal = (value?: string) => { if (!value) return ""; const date = new Date(value); const pad = (n: number) => String(n).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; };
const fromLocal = (value: string) => value ? new Date(value).toISOString() : null;

/** Memories, events and to-dos on the agent's workboard, which the person can read and change too. */
export function WorkboardDialog({ ko, initialKind, onClose, onChanged }: { ko: boolean; initialKind: ItemKind; onClose: () => void; onChanged: () => void }) {
  const [kind, setKind] = useState<ItemKind>(initialKind);
  const [items, setItems] = useState<AgentItem[]>();
  const [draft, setDraft] = useState({ title: "", body: "", startsAt: "", endsAt: "" });
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState("");
  const load = useCallback(() => { api<{ items: AgentItem[] }>(`/api/agent/items?kind=${kind}`).then(body => setItems(body.items)).catch(caught => setError(caught.message)); }, [kind]);
  useEffect(() => { setItems(undefined); setEditing(undefined); load(); }, [load]);
  const save = async (body: Record<string, unknown>, method: "POST" | "PATCH") => {
    setError("");
    try { await api("/api/agent/items", { method, body: JSON.stringify(body) }); load(); onChanged(); return true; }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); return false; }
  };
  const remove = async (id: string) => { await api("/api/agent/items", { method: "DELETE", body: JSON.stringify({ id }) }).catch(() => undefined); load(); onChanged(); };
  const labels: Record<ItemKind, string> = { memory: ko ? "기억" : "Memories", event: ko ? "일정" : "Events", todo: ko ? "할 일" : "To-dos" };
  return <Dialog ko={ko} title={ko ? "워크보드" : "Workboard"} subtitle={ko ? "에이전트가 쓰는 기억·일정·할 일입니다. 직접 고치면 에이전트도 그대로 봅니다." : "What the agent remembers and tracks. Your changes are what it sees next."} onClose={onClose} wide>
    <nav className="agent-tabs">{(["memory", "event", "todo"] as ItemKind[]).map(item => <button key={item} type="button" className={kind === item ? "active" : ""} onClick={() => setKind(item)}>{labels[item]}</button>)}</nav>
    <form className="agent-item-form" onSubmit={async event => { event.preventDefault(); if (await save({ kind, title: draft.title, body: draft.body || undefined, startsAt: fromLocal(draft.startsAt) ?? undefined, endsAt: fromLocal(draft.endsAt) ?? undefined }, "POST")) setDraft({ title: "", body: "", startsAt: "", endsAt: "" }); }}>
      <input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder={kind === "memory" ? (ko ? "기억할 내용" : "Something to remember") : kind === "event" ? (ko ? "일정 제목" : "Event title") : (ko ? "할 일" : "To-do")} maxLength={300} />
      {kind === "event" && <span className="agent-item-times"><input type="datetime-local" value={draft.startsAt} onChange={event => setDraft({ ...draft, startsAt: event.target.value })} aria-label={ko ? "시작" : "Starts"} /><input type="datetime-local" value={draft.endsAt} onChange={event => setDraft({ ...draft, endsAt: event.target.value })} aria-label={ko ? "끝" : "Ends"} /></span>}
      <button type="submit" className="subtle-action" disabled={!draft.title.trim() || (kind === "event" && !draft.startsAt)}><Plus size={14} />{ko ? "추가" : "Add"}</button>
    </form>
    {error && <p className="settings-notice">{error}</p>}
    {!items ? <p className="agent-panel-empty"><LoaderCircle size={14} className="spin" /></p> : !items.length ? <p className="agent-panel-empty">{ko ? "비어 있습니다." : "Nothing here yet."}</p> : <ul className="agent-item-list">{items.map(item => editing === item.id
      ? <ItemEditor key={item.id} ko={ko} item={item} onCancel={() => setEditing(undefined)} onSave={async patch => { if (await save({ id: item.id, ...patch }, "PATCH")) setEditing(undefined); }} />
      : <li key={item.id} className={item.status === "done" ? "done" : ""}>
        {kind === "todo" && <button type="button" className={`agent-check ${item.status === "done" ? "on" : ""}`} aria-label={ko ? "완료 표시" : "Mark done"} onClick={() => void save({ id: item.id, status: item.status === "done" ? "open" : "done" }, "PATCH")}>{item.status === "done" && <Check size={12} />}</button>}
        <button type="button" className="agent-item-text" onClick={() => setEditing(item.id)}><strong>{item.title}</strong>{item.body && <small>{item.body}</small>}{item.startsAt && <small>{when(item.startsAt, ko)}{item.endsAt ? ` – ${when(item.endsAt, ko)}` : ""}</small>}</button>
        <button type="button" className="agent-panel-icon" aria-label={ko ? "삭제" : "Delete"} onClick={() => void remove(item.id)}><Trash2 size={13} /></button>
      </li>)}</ul>}
  </Dialog>;
}

function ItemEditor({ ko, item, onSave, onCancel }: { ko: boolean; item: AgentItem; onSave: (patch: Record<string, unknown>) => void; onCancel: () => void }) {
  const [value, setValue] = useState({ title: item.title, body: item.body || "", startsAt: isoLocal(item.startsAt), endsAt: isoLocal(item.endsAt) });
  return <li className="editing"><div className="agent-item-editor">
    <input value={value.title} onChange={event => setValue({ ...value, title: event.target.value })} maxLength={300} />
    <textarea rows={3} value={value.body} onChange={event => setValue({ ...value, body: event.target.value })} placeholder={ko ? "메모" : "Notes"} />
    {(item.kind === "event" || item.startsAt) && <span className="agent-item-times"><input type="datetime-local" value={value.startsAt} onChange={event => setValue({ ...value, startsAt: event.target.value })} /><input type="datetime-local" value={value.endsAt} onChange={event => setValue({ ...value, endsAt: event.target.value })} /></span>}
    <span className="agent-item-editor-actions"><button type="button" className="secondary-button" onClick={onCancel}>{ko ? "취소" : "Cancel"}</button><button type="button" className="save-button" disabled={!value.title.trim()} onClick={() => onSave({ title: value.title, body: value.body, startsAt: fromLocal(value.startsAt), endsAt: fromLocal(value.endsAt) })}>{ko ? "저장" : "Save"}</button></span>
  </div></li>;
}

/** The agent's own settings: automatic runs, standing instructions, models, compaction and what it may do unasked. */
export function AgentSettingsDialog({ ko, state, models, onClose, onSaved }: { ko: boolean; state: AgentState; models: ModelConfig[]; onClose: () => void; onSaved: () => void }) {
  const initial = state.settings!;
  const [value, setValue] = useState<AgentClientSettings>(initial);
  const [mcp, setMcp] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pushState, setPushState] = useState<"unsupported" | "off" | "on" | "denied" | "working">("off");
  useEffect(() => { api<{ connections: Array<{ id: string; name: string }> }>("/api/mcp-connections").then(body => setMcp(body.connections || [])).catch(() => undefined); }, []);
  useEffect(() => { void currentPushSubscription().then(subscription => setPushState(subscription === "unsupported" ? "unsupported" : typeof Notification !== "undefined" && Notification.permission === "denied" ? "denied" : subscription ? "on" : "off")); }, []);
  const providers = useMemo(() => [
    ...BUILTIN_TOOL_PROVIDERS.filter(item => !["code-runner", "location", "multiple-choice"].includes(item.id)).map(item => ({ id: item.id, name: ko ? item.label.ko : item.label.en })),
    ...mcp.map(item => ({ id: `mcp:${item.id}`, name: `MCP · ${item.name}` })),
  ], [mcp, ko]);
  const rule = (id: string) => value.toolRules[id] || {};
  const setRule = (id: string, patch: AgentToolRule) => setValue(current => ({ ...current, toolRules: { ...current.toolRules, [id]: { ...current.toolRules[id], ...patch } } }));
  const save = async () => {
    setBusy(true); setError("");
    try { await api("/api/agent", { method: "PATCH", body: JSON.stringify({ ...value, subagentModelId: value.subagentModelId || "" }) }); onSaved(); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setBusy(false); }
  };
  const togglePush = async () => {
    setPushState("working");
    try { setPushState(await setPushSubscription(pushState !== "on", state.push?.publicKey)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setPushState("off"); }
  };
  const decisionSelect = (current: AgentDecision | undefined, fallback: AgentDecision, onChange: (value: AgentDecision) => void, label: string) =>
    <label className="agent-rule-select"><span>{label}</span><select value={current ?? fallback} onChange={event => onChange(event.target.value as AgentDecision)}><option value="allow">{ko ? "자동 허용" : "Allow"}</option><option value="ask">{ko ? "물어보기" : "Ask"}</option></select></label>;
  return <Dialog ko={ko} title={ko ? "에이전트 설정" : "Agent settings"} onClose={onClose} wide footer={<>{error && <p className="settings-notice">{error}</p>}<button type="button" className="secondary-button" onClick={onClose}>{ko ? "취소" : "Cancel"}</button><button type="button" className="save-button" disabled={busy} onClick={() => void save()}>{busy ? (ko ? "저장 중…" : "Saving…") : (ko ? "저장" : "Save")}</button></>}>
    <div className="model-visibility-row"><div><strong>{ko ? "자동 실행" : "Automatic runs"}</strong><small>{ko ? "주기 점검과 예약된 작업을 실행합니다. 끄면 채팅으로 요청할 때만 움직입니다." : "Runs the periodic check and scheduled work. When off, the agent acts only when you message it."}</small></div><button type="button" role="switch" aria-checked={value.enabled} aria-label={ko ? "자동 실행" : "Automatic runs"} className={`toggle ${value.enabled ? "on" : ""}`} onClick={() => setValue({ ...value, enabled: !value.enabled })}><i /></button></div>
    <label className="field"><span>{ko ? "주기 점검 간격 (분)" : "Periodic check interval (minutes)"}</span><input type="number" min={state.access.minIntervalMinutes} max={10080} value={value.heartbeatMinutes} onChange={event => setValue({ ...value, heartbeatMinutes: Math.max(1, Math.round(Number(event.target.value) || 0)) })} /><small>{ko ? `플랜이 허용하는 최소 간격은 ${state.access.minIntervalMinutes}분입니다. 더 짧게 정하면 최소 간격으로 실행합니다.` : `Your plan allows at least ${state.access.minIntervalMinutes} minutes; shorter values run at that minimum.`}</small></label>
    <label className="field"><span>{ko ? "작업 지침" : "Standing instructions"}</span><textarea rows={6} value={value.instructions} onChange={event => setValue({ ...value, instructions: event.target.value })} placeholder={ko ? "예: 받은편지함에서 중요한 메일을 요약해 알려 줘. 캘린더 일정이 겹치면 알려 줘." : "e.g. Summarize important new email. Tell me when calendar events overlap."} /><small>{ko ? "주기 점검마다 서브에이전트가 이 지침과 워크보드를 보고 일하며, 알릴 것이 있을 때만 메시지를 보냅니다." : "Each periodic check, a subagent works from these instructions and the workboard, and messages you only when something needs attention."}</small></label>
    <div className="form-grid">
      <label className="field"><span>{ko ? "서브에이전트·자동 실행 모델" : "Subagent and automatic-run model"}</span><select value={value.subagentModelId || ""} onChange={event => setValue({ ...value, subagentModelId: event.target.value || undefined })}><option value="">{ko ? "메인 채팅과 같은 모델" : "Same as the main chat"}</option>{models.filter(model => model.visible !== false && !model.imageGeneration).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
      <label className="field"><span>{ko ? "압축 기준 (컨텍스트의 %)" : "Compact at (% of context)"}</span><input type="number" min={10} max={95} value={value.compactPercent} onChange={event => setValue({ ...value, compactPercent: Math.min(95, Math.max(10, Math.round(Number(event.target.value) || 50))) })} /><small>{ko ? "메인 채팅과 모든 서브에이전트가 이 비율을 넘으면 압축합니다. 하네스 설정과 별개입니다." : "The main chat and every subagent compact past this share; separate from harness settings."}</small></label>
    </div>
    <div className="field"><span>{ko ? "이 기기 푸시 알림" : "Push notifications on this device"}</span><div className="agent-push-row"><button type="button" className="subtle-action" disabled={pushState === "unsupported" || pushState === "denied" || pushState === "working"} onClick={() => void togglePush()}>{pushState === "on" ? <><BellOff size={14} />{ko ? "이 기기 알림 끄기" : "Turn off on this device"}</> : <><Bell size={14} />{ko ? "이 기기에서 알림 받기" : "Notify this device"}</>}</button><small>{pushState === "unsupported" ? (ko ? "이 브라우저는 푸시 알림을 지원하지 않습니다. HTTPS 주소에서 앱으로 설치하면 쓸 수 있습니다." : "This browser cannot receive push here. Install the app from an HTTPS address.") : pushState === "denied" ? (ko ? "브라우저에서 알림이 차단되어 있습니다." : "Notifications are blocked in the browser.") : (ko ? `등록된 기기 ${state.push?.devices ?? 0}대 · 에이전트 화면을 보고 있지 않을 때만 보내고, 한 기기에서 확인하면 다른 기기 알림도 지웁니다.` : `${state.push?.devices ?? 0} device(s) · sent only while you are not viewing the agent; seeing one clears the others.`)}</small></div></div>
    <div className="field agent-rules"><span>{ko ? "자동 실행 중 도구 사용" : "Tools during automatic runs"}</span><small>{ko ? "사람이 없을 때(서브에이전트, 예약 작업, 에이전트가 스스로 시작한 응답) 승인 없이 쓸 수 있는 범위입니다. '물어보기'인 호출을 만나면 그 작업은 멈추고 알림을 보냅니다. MCP 도구는 서버가 읽기 전용이라고 밝힌 것만 읽기로 봅니다. 코드 실행은 가상 컴퓨터 MCP가 생기기 전까지 쓸 수 없습니다." : "What the agent may do without asking when you are not there (subagents, scheduled work, replies it starts itself). A call set to Ask pauses that work and notifies you. MCP tools count as reads only when the server marks them read-only. Code execution stays off until a virtual computer MCP exists."}</small>
      {providers.map(provider => { const current = rule(provider.id); const exceptions = Object.entries(current.tools || {}); return <div key={provider.id} className="agent-rule-row">
        <strong>{provider.name}</strong>
        <span className="agent-rule-controls">{decisionSelect(current.read, "allow", read => setRule(provider.id, { read }), ko ? "읽기" : "Read")}{decisionSelect(current.write, "ask", write => setRule(provider.id, { write }), ko ? "쓰기" : "Write")}</span>
        {exceptions.length > 0 && <ul className="agent-rule-exceptions">{exceptions.map(([name, decision]) => <li key={name}><code>{name}</code>{decisionSelect(decision, "ask", next => setRule(provider.id, { tools: { ...current.tools, [name]: next } }), "")}<button type="button" className="agent-panel-icon" aria-label={ko ? "예외 삭제" : "Remove exception"} onClick={() => { const tools = { ...current.tools }; delete tools[name]; setRule(provider.id, { tools }); }}><X size={12} /></button></li>)}</ul>}
        <ExceptionAdder ko={ko} onAdd={name => setRule(provider.id, { tools: { ...current.tools, [name]: "allow" } })} />
      </div>; })}
    </div>
  </Dialog>;
}

function ExceptionAdder({ ko, onAdd }: { ko: boolean; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return <form className="agent-rule-add" onSubmit={event => { event.preventDefault(); if (name.trim()) { onAdd(name.trim()); setName(""); } }}><input value={name} onChange={event => setName(event.target.value)} placeholder={ko ? "도구 이름별 예외 추가 (예: send_message)" : "Add a per-tool exception (e.g. send_message)"} maxLength={200} /><button type="submit" className="agent-panel-icon" aria-label={ko ? "추가" : "Add"} disabled={!name.trim()}><Plus size={13} /></button></form>;
}

/** Subagent history: running, waiting and finished runs, and each run's transcript with any approval it waits for. */
export function AgentRunsDialog({ ko, initialRunId, onClose, onChanged }: { ko: boolean; initialRunId?: string; onClose: () => void; onChanged: () => void }) {
  const [filter, setFilter] = useState<"all" | "active" | "finished">("all");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ runs: AgentRunView[]; pageCount: number; total: number }>();
  const [selected, setSelected] = useState(initialRunId);
  useEffect(() => {
    let stop = false;
    const load = () => api<{ runs: AgentRunView[]; pageCount: number; total: number }>(`/api/agent/runs?page=${page}${filter === "all" ? "" : `&status=${filter}`}`).then(body => { if (!stop) setList(body); }).catch(() => undefined);
    void load(); const timer = window.setInterval(load, 4000);
    return () => { stop = true; window.clearInterval(timer); };
  }, [filter, page]);
  if (selected) return <RunDetail ko={ko} runId={selected} onBack={() => setSelected(undefined)} onClose={onClose} onChanged={onChanged} />;
  return <Dialog ko={ko} title={ko ? "서브에이전트 기록" : "Subagent history"} subtitle={list ? (ko ? `총 ${list.total}개` : `${list.total} total`) : undefined} onClose={onClose} wide footer={list && list.pageCount > 1 ? <nav className="audit-pager"><button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button><span>{page} / {list.pageCount}</span><button disabled={page >= list.pageCount} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button></nav> : undefined}>
    <nav className="agent-tabs">{(["all", "active", "finished"] as const).map(item => <button key={item} type="button" className={filter === item ? "active" : ""} onClick={() => { setFilter(item); setPage(1); }}>{item === "all" ? (ko ? "전체" : "All") : item === "active" ? (ko ? "진행 중" : "In progress") : (ko ? "끝남" : "Finished")}</button>)}</nav>
    {!list ? <p className="agent-panel-empty"><LoaderCircle size={14} className="spin" /></p> : !list.runs.length ? <p className="agent-panel-empty">{ko ? "기록이 없습니다." : "No runs yet."}</p> : <ul className="agent-run-list">{list.runs.map(run => <li key={run.id}><button type="button" onClick={() => setSelected(run.id)}><span><strong>{run.title}</strong><small>{runKind(run.kind, ko)} · {when(run.createdAt, ko)}</small></span><em className={`agent-run-status ${run.status}`}>{runStatus(run.status, ko)}</em><ChevronRight size={15} /></button></li>)}</ul>}
  </Dialog>;
}

type ToolEventView = { id: string; name: string; status: string; arguments?: Record<string, unknown>; result?: unknown };

function RunDetail({ ko, runId, onBack, onClose, onChanged }: { ko: boolean; runId: string; onBack: () => void; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ run: AgentRunView; conversation: { id: string; branches: Array<{ messages: StoredMessage[] }> } | null }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let stop = false;
    const load = () => api<typeof data>(`/api/agent/runs/${runId}`).then(body => { if (!stop) setData(body); }).catch(caught => setError(caught.message));
    void load(); const timer = window.setInterval(load, 3000);
    return () => { stop = true; window.clearInterval(timer); };
  }, [runId]);
  const live = data?.run && ["queued", "running", "waiting"].includes(data.run.status);
  const [streamed, setStreamed] = useState<StoredMessage>();
  useEffect(() => {
    // A running run's reply streams from its chat job; finished runs read the saved transcript.
    if (!live || !data?.run.conversationId) { setStreamed(undefined); return; }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/chat/${data.run.conversationId}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        for (;;) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const records = buffer.split(/\r?\n\r?\n/); buffer = records.pop() || ""; for (const record of records) { const line = record.split(/\r?\n/).find(item => item.startsWith("data:")); if (!line) continue; try { setStreamed(JSON.parse(line.slice(5)).message); } catch { /* partial */ } } }
      } catch { /* closed */ }
    })();
    return () => controller.abort();
  }, [live, data?.run.conversationId]);
  const decide = async (eventId: string, decision: "approve" | "reject") => {
    if (!data?.run.conversationId) return;
    await fetch(`/api/chat/${data.run.conversationId}/input`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toolCallId: eventId, value: { decision } }) }).catch(() => undefined);
    onChanged();
  };
  const cancel = async () => { await api("/api/agent/runs", { method: "POST", body: JSON.stringify({ action: "cancel", id: runId }) }).catch(() => undefined); onChanged(); };
  const saved = data?.conversation?.branches[0]?.messages || [];
  const messages = streamed ? [...saved.filter(message => message.id !== streamed.id), streamed] : saved;
  return <Dialog ko={ko} title={data?.run.title || (ko ? "서브에이전트" : "Subagent")} subtitle={data ? `${runKind(data.run.kind, ko)} · ${runStatus(data.run.status, ko)} · ${when(data.run.createdAt, ko)}` : undefined} onClose={onClose} onBack={onBack} wide footer={live ? <button type="button" className="danger-button" onClick={() => void cancel()}><Square size={13} />{ko ? "중지" : "Stop"}</button> : undefined}>
    {error && <p className="settings-notice">{error}</p>}
    {!data ? <p className="agent-panel-empty"><LoaderCircle size={14} className="spin" /></p> : <div className="agent-transcript">
      {data.run.error && <p className="agent-transcript-error">{data.run.error}</p>}
      {messages.map(message => <article key={message.id} className={`agent-transcript-message ${message.role}`}>
        <header>{message.role === "user" ? (ko ? "지시" : "Instructions") : (ko ? "서브에이전트" : "Subagent")}</header>
        {(message.toolEvents as ToolEventView[] | undefined)?.map(event => <div key={event.id} className={`agent-tool-event ${event.status}`}>
          <span><code>{event.name}</code><em>{event.status}</em></span>
          {event.status === "waiting" && <span className="agent-tool-approval"><small>{ko ? "이 도구를 써도 될까요?" : "May the subagent use this tool?"}</small><button type="button" className="secondary-button" onClick={() => void decide(event.id, "reject")}>{ko ? "거절" : "Reject"}</button><button type="button" className="save-button" onClick={() => void decide(event.id, "approve")}>{ko ? "승인" : "Approve"}</button></span>}
        </div>)}
        {message.content && <div className="agent-transcript-text">{message.content}</div>}
      </article>)}
    </div>}
  </Dialog>;
}

// ------------------------------------------------------------------ push subscription helpers

function base64Key(value: string) {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

export async function currentPushSubscription(): Promise<PushSubscription | null | "unsupported"> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext) return "unsupported";
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

async function setPushSubscription(enable: boolean, publicKey?: string): Promise<"on" | "off" | "denied" | "unsupported"> {
  const current = await currentPushSubscription();
  if (current === "unsupported") return "unsupported";
  if (!enable) {
    if (current) { await api("/api/agent/push", { method: "DELETE", body: JSON.stringify({ endpoint: current.endpoint }) }).catch(() => undefined); await current.unsubscribe(); }
    return "off";
  }
  if (await Notification.requestPermission() !== "granted") return "denied";
  const registration = await navigator.serviceWorker.getRegistration() ?? await navigator.serviceWorker.register("/sw.js");
  const key = publicKey || (await api<{ publicKey: string }>("/api/agent/push")).publicKey;
  const subscription = current || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64Key(key) });
  await api("/api/agent/push", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
  return "on";
}
