"use client";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useModalTransition } from "@/lib/use-modal-focus";

// One editor for every long text in the app: harness prompts, model and reasoning system prompts,
// and chat message edits. A cramped inline textarea is never the place to rewrite a prompt, so the
// editing surface is always this dialog and the callers only choose its wording.
export function TextDialog({ title, value, onSave, onClose, multiline = false, help, ko = false, allowEmpty = false, saveLabel, saveIcon, cancelLabel, placeholder, preface, maxLength, secondary, layerClassName }: {
  title: string; value: string; onSave: (value: string) => void; onClose: () => void; multiline?: boolean; help?: string; ko?: boolean;
  allowEmpty?: boolean; saveLabel?: string; saveIcon?: ReactNode; cancelLabel?: string; placeholder?: string; preface?: ReactNode; maxLength?: number;
  /** A second action on the edited text. It stays disabled until the text actually differs. */
  secondary?: { label: string; icon?: ReactNode; busy?: boolean; onAction: (value: string) => void };
  layerClassName?: string;
}) {
  const [text, setText] = useState(value);
  const { ref, close: closeModal, closing } = useModalTransition(onClose);
  const trimmed = text.trim();
  const canSave = allowEmpty || Boolean(trimmed);
  const changed = trimmed !== value.trim();
  const cancel = cancelLabel || (ko ? "취소" : "Cancel");
  const save = saveLabel || (ko ? "저장" : "Save");
  // The dismissing controls need a name of their own: two buttons called "Cancel" in one dialog are
  // ambiguous to anyone navigating by name.
  const close = ko ? "닫기" : "Close";
  return createPortal(<div ref={ref} tabIndex={-1} className={`harness-modal-layer ${layerClassName || ""} ${closing ? "modal-closing" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
    <button className="settings-backdrop" tabIndex={-1} onClick={() => closeModal()} aria-label={close} />
    <form className="harness-dialog text-dialog" onSubmit={(event) => { event.preventDefault(); if (canSave) closeModal(() => onSave(trimmed)); }}>
      <header><h2>{title}</h2><button type="button" onClick={() => closeModal()} aria-label={close}><X size={20} /></button></header>
      {help && <p className="harness-dialog-help">{help}</p>}
      {preface}
      {multiline
        ? <textarea aria-label={title} rows={16} maxLength={maxLength ?? 32000} placeholder={placeholder} value={text} onChange={(event) => setText(event.target.value)} />
        : <input aria-label={title} maxLength={maxLength ?? 200} placeholder={placeholder} value={text} onChange={(event) => setText(event.target.value)} />}
      <footer className="text-dialog-actions">
        <button type="button" className="secondary-button" onClick={() => closeModal()}>{cancel}</button>
        {secondary && <button type="button" className="subtle-action" disabled={!canSave || !changed || secondary.busy} onClick={() => secondary.onAction(trimmed)}>{secondary.icon}{secondary.label}</button>}
        <button className="save-button" disabled={!canSave}>{saveIcon}{save}</button>
      </footer>
    </form>
  </div>, document.body);
}
