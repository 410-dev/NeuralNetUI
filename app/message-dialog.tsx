"use client";
import { useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useModalFocus } from "@/lib/use-modal-focus";

// Every question and announcement the app used to hand to the browser lives here instead, so a
// message keeps the application's own surface, spacing and focus behaviour. The tone chooses the
// mark and the accent: irreversible work reads as danger, recoverable work as warning.
export type MessageTone = "danger" | "warning" | "info" | "success";
export type MessageChoice = { id: string; label: string; quiet?: boolean };
export type MessageRequest = { tone?: MessageTone; title: string; message?: string; detail?: string; confirmLabel?: string; cancelLabel?: string; choices?: MessageChoice[] };

const TONE_MARKS: Record<MessageTone, ReactNode> = {
  danger: <TriangleAlert size={19} />,
  warning: <CircleAlert size={19} />,
  info: <Info size={19} />,
  success: <CircleCheck size={19} />,
};

export function MessageDialog({ tone = "info", title, message, detail, choices, cancelLabel, onChoose, onClose }: MessageRequest & { onChoose: (id: string) => void; onClose: () => void }) {
  const ref = useModalFocus(onClose);
  return createPortal(<div ref={ref} tabIndex={-1} className={`message-dialog-layer tone-${tone}`} role="alertdialog" aria-modal="true" aria-label={title}>
    <button className="settings-backdrop" tabIndex={-1} onClick={onClose} aria-label={title} />
    <section className="message-dialog">
      <header><span className="message-dialog-mark">{TONE_MARKS[tone]}</span><h2>{title}</h2></header>
      {message && <p className="message-dialog-body">{message}</p>}
      {detail && <p className="message-dialog-detail">{detail}</p>}
      <footer>
        {cancelLabel && <button type="button" className="secondary-button" onClick={onClose}>{cancelLabel}</button>}
        {(choices || []).map((choice) => <button key={choice.id} type="button" className={choice.quiet ? "secondary-button" : "message-dialog-confirm"} onClick={() => onChoose(choice.id)}>{choice.label}</button>)}
      </footer>
    </section>
  </div>, document.body);
}

type PendingMessage = MessageRequest & { resolve: (value: string) => void };

/**
 * `confirm` resolves true only when the confirming action is taken, `choose` names which action was
 * taken, and `notify` states something and resolves once it is dismissed. All three replace the
 * native dialogs, so the call sites keep reading as one straight-line asynchronous flow.
 */
export function useMessageDialog(ko: boolean) {
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const request = useCallback((value: MessageRequest) => new Promise<string>((resolve) => setPending({ ...value, resolve })), []);
  const choose = useCallback((value: MessageRequest & { choices: MessageChoice[] }) => request({ cancelLabel: ko ? "취소" : "Cancel", ...value }), [ko, request]);
  const confirm = useCallback(async (value: MessageRequest) => await request({
    cancelLabel: ko ? "취소" : "Cancel", ...value, choices: [{ id: "confirm", label: value.confirmLabel || (ko ? "확인" : "Confirm") }],
  }) === "confirm", [ko, request]);
  const notify = useCallback((value: MessageRequest) => request({ ...value, cancelLabel: undefined, choices: [{ id: "close", label: value.confirmLabel || (ko ? "닫기" : "Close") }] }), [ko, request]);
  const settle = (value: string) => { const current = pending; setPending(null); current?.resolve(value); };
  const dialog = pending
    ? <MessageDialog
        tone={pending.tone}
        title={pending.title}
        message={pending.message}
        detail={pending.detail}
        choices={pending.choices}
        cancelLabel={pending.cancelLabel}
        onChoose={settle}
        onClose={() => settle("")}
      />
    : null;
  return { dialog, confirm, choose, notify };
}
