"use client";
import { Check, Eye, EyeOff, KeyRound, LoaderCircle, Lock, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ToolEvent } from "@/lib/types";
import type { SecureInputField, SecureInputKind } from "@/lib/secure-input-names";

const AUTOCOMPLETE: Record<SecureInputKind, string> = { text: "off", email: "username email", username: "username", password: "current-password", otp: "one-time-code" };
const INPUT_TYPE: Record<SecureInputKind, string> = { text: "text", email: "email", username: "text", password: "password", otp: "text" };

type Outcome = { id: string; label: string; status: "filled" | "held" | "empty"; submitted?: boolean };

/**
 * The card a request_user_input call shows in the chat. What the person types is sent straight to the waiting tool
 * call (it fills the page or holds the value for five minutes); it is never stored in the chat or shown to the model,
 * and the form forgets it as soon as it is sent.
 */
export function SecureInputCard({ event, ko, onSubmit }: { event: ToolEvent; ko: boolean; onSubmit?: (value: unknown) => Promise<boolean> }) {
  const args = event.arguments && typeof event.arguments === "object" ? event.arguments as { title?: string; description?: string; fields?: SecureInputField[] } : {};
  const fields = Array.isArray(args.fields) ? args.fields.filter(field => field && typeof field.id === "string") : [];
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({}), [shown, setShown] = useState<Record<string, boolean>>({});
  const result = event.result && typeof event.result === "object" ? event.result as { status?: string; fields?: Outcome[] } : undefined;
  const waiting = event.status === "waiting" && Boolean(onSubmit);
  async function send(value: unknown) {
    if (!onSubmit) return;
    setBusy(true);
    try { if (await onSubmit(value)) { setValues({}); setOpen(false); } } finally { setBusy(false); }
  }
  function submit(formEvent: FormEvent) { formEvent.preventDefault(); void send({ values }); }
  const title = args.title || (ko ? "입력 요청" : "Input requested");
  let status: React.ReactNode;
  if (event.status === "calling") status = <span className="secure-input-status"><LoaderCircle size={13} className="spin" />{ko ? "입력하는 중" : "Entering"}</span>;
  else if (event.status === "error") status = <span className="secure-input-status error">{ko ? "입력하지 못했습니다" : "Could not enter it"}</span>;
  else if (result?.status === "cancelled") status = <span className="secure-input-status">{ko ? "입력을 취소했습니다" : "Cancelled"}</span>;
  else if (result?.status === "submitted") status = <span className="secure-input-status done"><Check size={13} />{(result.fields || []).map(item => `${item.label}: ${item.status === "filled" ? (ko ? "입력됨" : "entered") : item.status === "held" ? (ko ? "5분간 보관" : "held 5 min") : (ko ? "비어 있음" : "empty")}`).join(" · ")}</span>;
  else if (event.status === "waiting" && !onSubmit) status = <span className="secure-input-status">{ko ? "입력을 기다리는 중" : "Waiting for input"}</span>;
  return <section className={`secure-input-card ${waiting ? "waiting" : ""}`} aria-label={title}>
    <div className="secure-input-head">
      <span className="secure-input-icon"><KeyRound size={18} /></span>
      <div><strong>{title}</strong><small>{args.description || (ko ? "가상 컴퓨터의 브라우저에 입력할 값입니다." : "For the virtual computer's browser.")}</small></div>
      {waiting && !open && <button type="button" className="secure-input-open" onClick={() => setOpen(true)}>{ko ? "입력" : "Enter"}</button>}
    </div>
    {waiting && open && <form className="secure-input-form" onSubmit={submit} autoComplete="on">
      {fields.map(field => {
        const secret = field.kind === "password";
        return <label key={field.id} className="field"><span>{field.label}</span>
          <span className="secure-input-control">
            <input name={field.id} type={secret && shown[field.id] ? "text" : INPUT_TYPE[field.kind] || "text"} autoComplete={AUTOCOMPLETE[field.kind] || "off"} inputMode={field.kind === "otp" ? "numeric" : undefined}
              spellCheck={false} autoCapitalize="off" value={values[field.id] || ""} onChange={change => setValues(current => ({ ...current, [field.id]: change.target.value }))} disabled={busy} />
            {secret && <button type="button" aria-label={shown[field.id] ? (ko ? "가리기" : "Hide") : (ko ? "보기" : "Show")} onClick={() => setShown(current => ({ ...current, [field.id]: !current[field.id] }))}>{shown[field.id] ? <EyeOff size={15} /> : <Eye size={15} />}</button>}
          </span></label>;
      })}
      <p className="secure-input-note"><Lock size={12} />{ko ? "입력한 값은 모델에게 전달되지 않고 가상 컴퓨터의 입력란에 바로 들어가거나, 최대 5분 동안만 보관된 뒤 지워집니다. 대화 기록에도 남지 않습니다." : "What you enter is not shown to the model: it goes straight into the page, or is held for at most five minutes and then deleted. It is not saved in the chat."}</p>
      <footer><button type="button" className="secondary-button" disabled={busy} onClick={() => void send({ cancelled: true })}><X size={14} />{ko ? "취소" : "Cancel"}</button><button type="submit" className="save-button" disabled={busy || !fields.some(field => values[field.id])}>{busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{ko ? "보내기" : "Send"}</button></footer>
    </form>}
    {status && <div className="secure-input-foot">{status}</div>}
  </section>;
}
