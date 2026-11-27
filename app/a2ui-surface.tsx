"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bell, BellOff, Calendar, Camera, Check, CircleHelp, CircleUserRound, CreditCard, Download, Ellipsis, EllipsisVertical, Eye, EyeOff,
  FastForward, Folder, Heart, HeartOff, Home, Image as ImageIcon, Info, LayoutTemplate, LoaderCircle, Lock, LockOpen, Mail, MapPin, Menu, Paperclip, Pause, Pencil, Phone, PhoneCall, Play, Plus,
  Printer, RefreshCw, Rewind, Search, Send, Settings, Share2, ShoppingCart, SkipBack, SkipForward, Square, Star, StarHalf, StarOff, Trash2, Upload, User, Volume, Volume1, Volume2, VolumeX, X, CircleAlert,
} from "lucide-react";
import { COMPONENTS } from "@/lib/a2ui/catalog";
import {
  getAt, joinPath, resolveBoolean, resolveNumber, resolveString, resolveValue, runChecks, setAt, isBinding,
  type A2uiComponent, type ActionMessage, type EvalScope, type Json, type SurfaceState,
} from "@/lib/a2ui/runtime";
import type { ToolEvent } from "@/lib/types";
import { useModalFocus } from "@/lib/use-modal-focus";

/**
 * Renders A2UI v1.0 surfaces with the app's own controls (fields, pill buttons, cards, chips), so a generated UI
 * looks like the rest of NeuralNetUI. A surface is drawn where the render_ui call that created it sits; later calls
 * update it in place.
 */

export interface A2uiAction { message: ActionMessage; dataModel?: Json; label: string }

interface ConversationValue {
  surfaces: Record<string, SurfaceState>;
  conversationId: string;
  ko: boolean;
  /** No new actions while a reply is being written or outside a chat that can answer them. */
  disabled: boolean;
  onAction?(action: A2uiAction): void;
}
const ConversationContext = createContext<ConversationValue | null>(null);
export const A2uiConversation = ConversationContext.Provider;

/** The card in the transcript for one render_ui call. */
export function A2uiEventCard({ event }: { event: ToolEvent }) {
  const conversation = useContext(ConversationContext);
  const ko = conversation?.ko ?? true;
  const result = event.result && typeof event.result === "object" ? event.result as { ok?: boolean; errors?: string[] } : undefined;
  if (event.status === "calling" || event.status === "waiting") return <A2uiDrawing ko={ko} />;
  if (event.status !== "completed" || !result) return null;
  if (result.ok !== true) return <details className="a2ui-status a2ui-rejected"><summary><CircleAlert size={14} />{ko ? `UI 오류 ${result.errors?.length ?? 0}건 · 모델이 고쳐서 다시 그립니다` : `${result.errors?.length ?? 0} UI problems · the model redraws it`}</summary><ul>{(result.errors || []).map((error, index) => <li key={index}>{error}</li>)}</ul></details>;
  const created = Object.values(conversation?.surfaces || {}).filter(surface => surface.createdBy === event.id);
  if (!created.length) return <div className="a2ui-status a2ui-updated"><LayoutTemplate size={14} />{ko ? "위의 UI를 업데이트했습니다" : "Updated the UI above"}</div>;
  return <>{created.map(surface => surface.deleted
    ? <div key={surface.surfaceId} className="a2ui-status a2ui-updated"><LayoutTemplate size={14} />{ko ? "닫힌 UI" : "Closed UI"}</div>
    : <A2uiSurfaceView key={surface.surfaceId} surface={surface} />)}</>;
}

// ---------------------------------------------------------------- surface

interface SurfaceValue {
  surface: SurfaceState;
  model: Json;
  setValue(path: string, value: Json): void;
  touched: Set<string>;
  touch(id: string): void;
  disabled: boolean;
  ko: boolean;
  locale: string;
  fire(component: A2uiComponent, scope: EvalScope): void;
}
const SurfaceContext = createContext<SurfaceValue | null>(null);
const ModalTriggerContext = createContext<(() => void) | null>(null);

function storageKey(conversationId: string, surfaceId: string) { return `nnui-a2ui:${conversationId}:${surfaceId}`; }

function A2uiSurfaceView({ surface }: { surface: SurfaceState }) {
  const conversation = useContext(ConversationContext)!;
  const key = storageKey(conversation.conversationId, surface.surfaceId);
  // The person's edits are kept per surface revision: when the agent changes the surface, its data model wins.
  const [model, setModel] = useState<Json>(() => {
    try { const saved = JSON.parse(localStorage.getItem(key) || "null") as { revision: number; model: Json } | null; if (saved?.revision === surface.revision) return saved.model; } catch { /* storage may be unavailable */ }
    return surface.dataModel;
  });
  const lastRevision = useRef(surface.revision);
  useEffect(() => {
    if (lastRevision.current === surface.revision) return;
    lastRevision.current = surface.revision;
    setModel(surface.dataModel);
  }, [surface.revision, surface.dataModel]);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify({ revision: surface.revision, model })); } catch { /* ignore */ } }, [key, model, surface.revision]);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const locale = conversation.ko ? "ko-KR" : "en-US";

  const value: SurfaceValue = {
    surface, model, touched, disabled: conversation.disabled || !conversation.onAction, ko: conversation.ko, locale,
    setValue: (path, next) => setModel(current => setAt(current, path, next)),
    touch: id => setTouched(current => current.has(id) ? current : new Set(current).add(id)),
    fire(component, scope) {
      const action = component.action as { event?: { name: string; userMessage?: unknown; context?: Record<string, unknown> }; functionCall?: { "@call": string; args?: Record<string, unknown> } } | undefined;
      if (!action) return;
      if (action.functionCall) {
        if (action.functionCall["@call"] === "openUrl") {
          const url = resolveString(action.functionCall.args?.url, scope);
          if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (!action.event || !conversation.onAction) return;
      const context: Record<string, Json> = {};
      for (const [name, raw] of Object.entries(action.event.context || {})) context[name] = (resolveValue(raw, scope) ?? null) as Json;
      const userMessage = action.event.userMessage !== undefined ? resolveString(action.event.userMessage, scope) : undefined;
      const message: ActionMessage = { version: "1.0", action: { name: action.event.name, surfaceId: surface.surfaceId, sourceComponentId: component.id, timestamp: new Date().toISOString(), context, ...(userMessage ? { userMessage } : {}) } };
      const label = userMessage || buttonLabel(component, surface, scope) || action.event.name;
      conversation.onAction({ message, label, ...(surface.sendDataModel ? { dataModel: model } : {}) });
    },
  };
  return <SurfaceContext.Provider value={value}>
    <div className="a2ui-surface" data-surface={surface.surfaceId}><Node id="root" scope={{ model, scope: "", locale }} depth={0} /></div>
  </SurfaceContext.Provider>;
}

function buttonLabel(component: A2uiComponent, surface: SurfaceState, scope: EvalScope) {
  const child = typeof component.child === "string" ? surface.components[component.child] : undefined;
  return child?.component === "Text" ? resolveString(child.text, scope).replace(/[#*_`]/g, "").trim() : "";
}

// ---------------------------------------------------------------- components

function Node({ id, scope, depth, weighted }: { id: string; scope: EvalScope; depth: number; weighted?: boolean }) {
  const surface = useContext(SurfaceContext)!;
  const component = surface.surface.components[id];
  if (!component) return <span className="a2ui-missing">{id}</span>;
  if (depth > 40) return null;
  const evalScope = { ...scope, model: surface.model };
  const style: CSSProperties | undefined = weighted && typeof component.weight === "number" ? { flex: `${component.weight} 1 0`, minWidth: 0 } : undefined;
  const accessible = component["@accessibility"] as { label?: unknown; description?: unknown } | undefined;
  const aria = accessible?.label !== undefined ? resolveString(accessible.label, evalScope) : undefined;
  const body = renderComponent(component, evalScope, depth);
  if (!style && !aria) return body;
  return <div className="a2ui-weighted" style={style} aria-label={aria}>{body}</div>;
}

function Children({ value, scope, depth, weighted }: { value: unknown; scope: EvalScope; depth: number; weighted?: boolean }) {
  if (Array.isArray(value)) return <>{value.map(child => typeof child === "string" ? <Node key={child} id={child} scope={scope} depth={depth + 1} weighted={weighted} /> : null)}</>;
  if (value && typeof value === "object" && typeof (value as { componentId?: unknown }).componentId === "string") {
    const template = value as { componentId: string; path: string };
    const listPath = joinPath(scope.scope, template.path);
    const items = getAt(scope.model, listPath);
    if (!Array.isArray(items)) return null;
    return <>{items.slice(0, 500).map((_, index) => <Node key={index} id={template.componentId} scope={{ ...scope, scope: `${listPath}/${index}`, index }} depth={depth + 1} weighted={weighted} />)}</>;
  }
  return null;
}

const JUSTIFY: Record<string, CSSProperties["justifyContent"]> = { start: "flex-start", center: "center", end: "flex-end", spaceBetween: "space-between", spaceAround: "space-around", spaceEvenly: "space-evenly", stretch: "stretch" };
const ALIGN: Record<string, CSSProperties["alignItems"]> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };

function renderComponent(component: A2uiComponent, scope: EvalScope, depth: number): ReactNode {
  switch (component.component) {
    case "Text": return <A2Text component={component} scope={scope} />;
    case "Image": {
      const url = resolveString(component.url, scope);
      if (!/^(https?:|data:image\/)/i.test(url)) return null;
      return <img className={`a2ui-image ${String(component.variant || "mediumFeature")}`} style={{ objectFit: component.fit === "scaleDown" ? "scale-down" : (component.fit as CSSProperties["objectFit"]) || "cover" }} src={url} alt={resolveString(component.description, scope)} loading="lazy" />;
    }
    case "Icon": return <A2Icon value={component.name} scope={scope} />;
    case "Video": { const url = resolveString(component.url, scope); return /^https?:/i.test(url) ? <video className="a2ui-media" src={url} poster={resolveString(component.posterUrl, scope) || undefined} controls playsInline preload="metadata" /> : null; }
    case "AudioPlayer": { const url = resolveString(component.url, scope); return /^https?:/i.test(url) ? <A2Audio url={url} description={component.description !== undefined ? resolveString(component.description, scope) : ""} /> : null; }
    case "Row": case "Column": return <div className={`a2ui-${component.component === "Row" ? "row" : "column"}`} style={{ justifyContent: JUSTIFY[String(component.justify || "start")], alignItems: ALIGN[String(component.align || "stretch")] }}><Children value={component.children} scope={scope} depth={depth} weighted /></div>;
    case "List": return <div className={`a2ui-list ${component.direction === "horizontal" ? "horizontal" : ""}`} style={{ alignItems: ALIGN[String(component.align || "stretch")] }}><Children value={component.children} scope={scope} depth={depth} /></div>;
    case "Card": return <div className="a2ui-card"><Node id={String(component.child)} scope={scope} depth={depth + 1} /></div>;
    case "Tabs": return <A2Tabs component={component} scope={scope} depth={depth} />;
    case "Modal": return <A2Modal component={component} scope={scope} depth={depth} />;
    case "Divider": return <hr className={`a2ui-divider ${component.axis === "vertical" ? "vertical" : ""}`} />;
    case "Button": return <A2Button component={component} scope={scope} depth={depth} />;
    case "TextField": return <A2TextField component={component} scope={scope} />;
    case "CheckBox": return <A2CheckBox component={component} scope={scope} />;
    case "ChoicePicker": return <A2ChoicePicker component={component} scope={scope} />;
    case "Slider": return <A2Slider component={component} scope={scope} />;
    case "DateTimeInput": return <A2DateTime component={component} scope={scope} />;
    default: return COMPONENTS[component.component] ? null : <span className="a2ui-missing">{component.component}</span>;
  }
}

function A2Text({ component, scope }: { component: A2uiComponent; scope: EvalScope }) {
  const text = resolveString(component.text, scope);
  if (component.variant === "caption") return <small className="a2ui-caption">{text}</small>;
  // Simple Markdown only: no HTML, images or links (links render as their text).
  return <div className="a2ui-text markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}>{text}</ReactMarkdown></div>;
}

const ICONS: Record<string, typeof Check> = {
  accountCircle: CircleUserRound, add: Plus, arrowBack: ArrowLeft, arrowForward: ArrowRight, attachFile: Paperclip, calendarToday: Calendar, call: PhoneCall, camera: Camera, check: Check, close: X,
  delete: Trash2, download: Download, edit: Pencil, event: Calendar, error: CircleAlert, fastForward: FastForward, favorite: Heart, favoriteOff: HeartOff, folder: Folder, help: CircleHelp, home: Home,
  info: Info, locationOn: MapPin, lock: Lock, lockOpen: LockOpen, mail: Mail, menu: Menu, moreVert: EllipsisVertical, moreHoriz: Ellipsis, notificationsOff: BellOff, notifications: Bell, pause: Pause,
  payment: CreditCard, person: User, phone: Phone, photo: ImageIcon, play: Play, print: Printer, refresh: RefreshCw, rewind: Rewind, search: Search, send: Send, settings: Settings, share: Share2,
  shoppingCart: ShoppingCart, skipNext: SkipForward, skipPrevious: SkipBack, star: Star, starHalf: StarHalf, starOff: StarOff, stop: Square, upload: Upload, visibility: Eye, visibilityOff: EyeOff,
  volumeDown: Volume1, volumeMute: Volume, volumeOff: VolumeX, volumeUp: Volume2, warning: AlertTriangle,
};

function A2Icon({ value, scope }: { value: unknown; scope: EvalScope }) {
  const resolved = isBinding(value) ? resolveValue(value, scope) : value;
  if (resolved && typeof resolved === "object" && "svgPath" in resolved) {
    const d = resolveString((resolved as { svgPath: unknown }).svgPath, scope);
    return <svg className="a2ui-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={d} /></svg>;
  }
  const Icon = ICONS[String(resolved)] || CircleHelp;
  return <Icon className="a2ui-icon" size={18} aria-hidden="true" />;
}

/** The app's own audio player: play/pause, a seek bar styled like the Slider, elapsed and total time. */
function A2Audio({ url, description }: { url: string; description: string }) {
  const surface = useContext(SurfaceContext)!;
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const clock = (seconds: number) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "0:00";
  const toggle = () => { const element = audio.current; if (!element) return; if (element.paused) void element.play().catch(() => setFailed(true)); else element.pause(); };
  const fill = duration > 0 ? `${(time / duration) * 100}%` : "0%";
  return <div className={`a2ui-audio ${failed ? "failed" : ""}`}>
    <audio ref={audio} src={url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onLoadedMetadata={event => setDuration(event.currentTarget.duration)} onError={() => setFailed(true)} />
    <button type="button" className="a2ui-audio-play" onClick={toggle} disabled={failed} aria-label={playing ? (surface.ko ? "일시정지" : "Pause") : (surface.ko ? "재생" : "Play")}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
    <div className="a2ui-audio-body">
      <span>{failed ? (surface.ko ? "오디오를 불러오지 못했습니다" : "The audio could not be loaded") : description || (surface.ko ? "오디오" : "Audio")}</span>
      <div className="a2ui-audio-track">
        <input type="range" min={0} max={duration || 0} step="any" value={Math.min(time, duration || 0)} disabled={!duration} aria-label={surface.ko ? "재생 위치" : "Position"}
          onChange={event => { const element = audio.current; if (element) { element.currentTime = Number(event.target.value); setTime(element.currentTime); } }} style={{ "--a2ui-fill": fill } as CSSProperties} />
        <small>{clock(time)} / {clock(duration)}</small>
      </div>
    </div>
  </div>;
}

function A2Tabs({ component, scope, depth }: { component: A2uiComponent; scope: EvalScope; depth: number }) {
  const tabs = (Array.isArray(component.tabs) ? component.tabs : []) as Array<{ title: unknown; child: string }>;
  const [active, setActive] = useState(0);
  const current = tabs[Math.min(active, tabs.length - 1)];
  return <div className="a2ui-tabs">
    <div className="a2ui-tab-bar" role="tablist">{tabs.map((tab, index) => <button key={index} type="button" role="tab" aria-selected={index === active} className={index === active ? "active" : ""} onClick={() => setActive(index)}>{resolveString(tab.title, scope)}</button>)}</div>
    {current && <div className="a2ui-tab-panel" role="tabpanel"><Node id={current.child} scope={scope} depth={depth + 1} /></div>}
  </div>;
}

function A2Modal({ component, scope, depth }: { component: A2uiComponent; scope: EvalScope; depth: number }) {
  const [open, setOpen] = useState(false);
  const surface = useContext(SurfaceContext)!;
  return <>
    <ModalTriggerContext.Provider value={() => setOpen(true)}><Node id={String(component.trigger)} scope={scope} depth={depth + 1} /></ModalTriggerContext.Provider>
    {open && <A2ModalDialog onClose={() => setOpen(false)} ko={surface.ko}><Node id={String(component.content)} scope={scope} depth={depth + 1} /></A2ModalDialog>}
  </>;
}

function A2ModalDialog({ children, onClose, ko }: { children: ReactNode; onClose: () => void; ko: boolean }) {
  const ref = useModalFocus(onClose);
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer a2ui-modal-layer" role="dialog" aria-modal="true">
    <button className="settings-backdrop" tabIndex={-1} onClick={onClose} aria-label={ko ? "닫기" : "Close"} />
    <section className="harness-dialog a2ui-modal"><header><span /><button type="button" onClick={onClose} aria-label={ko ? "닫기" : "Close"}><X size={20} /></button></header><div className="a2ui-surface">{children}</div></section>
  </div>, document.body);
}

function useChecks(component: A2uiComponent, scope: EvalScope) {
  return useMemo(() => runChecks(component["@checks"], scope), [component, scope]);
}

function A2Button({ component, scope, depth }: { component: A2uiComponent; scope: EvalScope; depth: number }) {
  const surface = useContext(SurfaceContext)!;
  const openModal = useContext(ModalTriggerContext);
  const check = useChecks(component, scope);
  const isEvent = Boolean((component.action as { event?: unknown } | undefined)?.event);
  const disabled = !check.valid || (isEvent && !openModal && surface.disabled);
  const variant = String(component.variant || "default");
  return <button type="button" className={`a2ui-button ${variant === "primary" ? "save-button" : variant === "borderless" ? "a2ui-link" : "secondary-button"}`} disabled={disabled} title={!check.valid ? check.message : undefined}
    onClick={() => { if (openModal) openModal(); else surface.fire(component, scope); }}>
    <Node id={String(component.child)} scope={scope} depth={depth + 1} />
  </button>;
}

function boundPath(value: unknown, scope: EvalScope) { return isBinding(value) ? joinPath(scope.scope, value["@path"]) : undefined; }

function FieldError({ component, scope }: { component: A2uiComponent; scope: EvalScope }) {
  const surface = useContext(SurfaceContext)!;
  const check = useChecks(component, scope);
  const key = `${component.id}:${scope.scope}`;
  if (check.valid || !surface.touched.has(key)) return null;
  return <small className="a2ui-error" role="alert">{check.message || (surface.ko ? "값을 확인해 주세요." : "Check this value.")}</small>;
}

function A2TextField({ component, scope }: { component: A2uiComponent; scope: EvalScope }) {
  const surface = useContext(SurfaceContext)!;
  const path = boundPath(component.value, scope);
  const value = resolveString(component.value, scope);
  const variant = String(component.variant || "shortText");
  const set = (next: string) => { if (path) surface.setValue(path, variant === "number" ? (next === "" ? "" : Number(next)) as Json : next); };
  const props = { value, placeholder: resolveString(component.placeholder, scope) || undefined, readOnly: !path, onChange: (event: { target: { value: string } }) => set(event.target.value), onBlur: () => surface.touch(`${component.id}:${scope.scope}`) };
  return <label className="field a2ui-field"><span>{resolveString(component.label, scope)}</span>
    {variant === "longText" ? <textarea rows={4} {...props} /> : <input type={variant === "number" ? "number" : variant === "obscured" ? "password" : "text"} {...props} />}
    <FieldError component={component} scope={scope} />
  </label>;
}

function A2CheckBox({ component, scope }: { component: A2uiComponent; scope: EvalScope }) {
  const surface = useContext(SurfaceContext)!;
  const path = boundPath(component.value, scope);
  const checked = resolveBoolean(component.value, scope);
  return <div className="a2ui-check-wrap"><button type="button" role="checkbox" aria-checked={checked} className={`a2ui-check ${checked ? "on" : ""}`} disabled={!path} onClick={() => { if (path) { surface.setValue(path, !checked); surface.touch(`${component.id}:${scope.scope}`); } }}>
    <span className="a2ui-check-box">{checked && <Check size={13} />}</span><span>{resolveString(component.label, scope)}</span>
  </button><FieldError component={component} scope={scope} /></div>;
}

function A2ChoicePicker({ component, scope }: { component: A2uiComponent; scope: EvalScope }) {
  const surface = useContext(SurfaceContext)!;
  const [filter, setFilter] = useState("");
  const path = boundPath(component.value, scope);
  const raw = resolveValue(component.value, scope);
  const selected = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" && raw ? [raw] : [];
  const multiple = component.variant === "multipleSelection";
  const options = (Array.isArray(component.options) ? component.options : []) as Array<{ label: unknown; value: string }>;
  const shown = options.filter(option => !filter || resolveString(option.label, scope).toLowerCase().includes(filter.toLowerCase()));
  const toggle = (value: string) => {
    if (!path) return;
    const next = multiple ? (selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]) : [value];
    surface.setValue(path, next); surface.touch(`${component.id}:${scope.scope}`);
  };
  const chips = component.displayStyle === "chips";
  return <div className="field a2ui-field a2ui-choice">
    {component.label !== undefined && <span>{resolveString(component.label, scope)}</span>}
    {component.filterable === true && <input className="a2ui-filter" value={filter} onChange={event => setFilter(event.target.value)} placeholder={surface.ko ? "검색" : "Search"} />}
    <div className={chips ? "a2ui-chips" : "a2ui-options"} role={multiple ? "group" : "radiogroup"}>
      {shown.map(option => { const on = selected.includes(option.value); return <button key={option.value} type="button" role={multiple ? "checkbox" : "radio"} aria-checked={on} className={on ? "selected" : ""} disabled={!path} onClick={() => toggle(option.value)}>
        {!chips && <span className={`a2ui-check-box ${multiple ? "" : "round"}`}>{on && <Check size={12} />}</span>}<span>{resolveString(option.label, scope)}</span>
      </button>; })}
    </div>
    <FieldError component={component} scope={scope} />
  </div>;
}

function A2Slider({ component, scope }: { component: A2uiComponent; scope: EvalScope }) {
  const surface = useContext(SurfaceContext)!;
  const path = boundPath(component.value, scope);
  const min = typeof component.min === "number" ? component.min : 0, max = typeof component.max === "number" ? component.max : 100;
  const steps = typeof component.steps === "number" && component.steps > 0 ? component.steps : undefined;
  const value = resolveNumber(component.value, scope, min);
  return <label className="field a2ui-field a2ui-slider"><span>{resolveString(component.label, scope)}<b>{new Intl.NumberFormat(surface.locale).format(value)}</b></span>
    <input type="range" min={min} max={max} step={steps ? (max - min) / steps : "any"} value={value} disabled={!path} onChange={event => { if (path) surface.setValue(path, Number(event.target.value)); }} style={{ "--a2ui-fill": `${((value - min) / Math.max(1e-9, max - min)) * 100}%` } as CSSProperties} />
    <FieldError component={component} scope={scope} />
  </label>;
}

function A2DateTime({ component, scope }: { component: A2uiComponent; scope: EvalScope }) {
  const surface = useContext(SurfaceContext)!;
  const path = boundPath(component.value, scope);
  const date = component.enableDate === true, time = component.enableTime === true;
  const type = date && time ? "datetime-local" : time ? "time" : "date";
  const raw = resolveString(component.value, scope);
  // ISO 8601 in the data model; the input wants local "YYYY-MM-DDTHH:mm", "YYYY-MM-DD" or "HH:mm".
  const shown = type === "datetime-local" ? raw.slice(0, 16) : type === "date" ? raw.slice(0, 10) : (raw.match(/\d{2}:\d{2}/)?.[0] || "");
  const bound = (value: unknown) => { const text = resolveString(value, scope); return type === "datetime-local" ? text.slice(0, 16) : type === "date" ? text.slice(0, 10) : text.match(/\d{2}:\d{2}/)?.[0]; };
  return <label className="field a2ui-field"><span>{resolveString(component.label, scope)}</span>
    <input type={type} value={shown} min={component.min !== undefined ? bound(component.min) : undefined} max={component.max !== undefined ? bound(component.max) : undefined} readOnly={!path}
      onChange={event => { if (path) surface.setValue(path, event.target.value); }} onBlur={() => surface.touch(`${component.id}:${scope.scope}`)} />
    <FieldError component={component} scope={scope} />
  </label>;
}



/**
 * Shown while the model is still writing a UI: a dark grid of dots with soft bright patches drifting over it, so a
 * long generation reads as work in progress rather than a stall. Canvas-drawn; holds still for reduced motion.
 */
export function A2uiDrawing({ ko }: { ko: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const gap = 16;
    let frame = 0, width = 0, height = 0;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = element.clientWidth; height = element.clientHeight;
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    // Three patches on slow Lissajous paths; their sum lights the dots under them.
    const blobs = [
      { ax: .36, ay: .3, fx: .00021, fy: .00029, px: 0, py: 1.3, r: .085 },
      { ax: .32, ay: .28, fx: .00017, fy: .00023, px: 2.1, py: .4, r: .07 },
      { ax: .28, ay: .32, fx: .00025, fy: .00019, px: 4.2, py: 2.6, r: .055 },
    ];
    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      const size = Math.min(width, height * 2.2);
      const centers = blobs.map(blob => ({ x: width * (.5 + blob.ax * Math.sin(time * blob.fx + blob.px)), y: height * (.5 + blob.ay * Math.sin(time * blob.fy + blob.py)), r: size * blob.r }));
      for (let y = gap / 2 + 2; y < height; y += gap) {
        for (let x = gap / 2 + 2; x < width; x += gap) {
          let light = 0;
          for (const center of centers) { const dx = x - center.x, dy = y - center.y; light += Math.exp(-(dx * dx + dy * dy) / (2 * center.r * center.r)); }
          light = Math.min(1, light);
          context.fillStyle = `rgba(255,255,255,${.11 + light * .75})`;
          context.beginPath(); context.arc(x, y, .85 + light * .75, 0, Math.PI * 2); context.fill();
        }
      }
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    resize();
    const observer = new ResizeObserver(() => { resize(); if (reduced) draw(4000); });
    observer.observe(element);
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  return <div className="a2ui-drawing" role="status" aria-live="polite">
    <canvas ref={canvas} aria-hidden="true" />
    <span>{ko ? "UI를 그리는 중" : "Drawing the UI"}</span>
  </div>;
}
