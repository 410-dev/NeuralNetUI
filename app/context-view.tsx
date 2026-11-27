"use client";

import { Brain, Check, Clock, Eraser, EyeOff, Layers, Minimize2, Paperclip, Pencil, RotateCcw, Undo2, Wrench, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { applyContextState, type ContextMessageOverride, type ContextState } from "@/lib/context-state";
import type { StoredMessage, ToolEvent } from "@/lib/types";
import { useModalTransition } from "@/lib/use-modal-focus";
import { TextDialog } from "./text-dialog";

/**
 * The model's actual context for this branch, shown as a conversation and editable in place. Edits change only what
 * the model receives; the transcript keeps the original. Editing one message never removes the ones after it.
 */
type Props = {
  ko: boolean;
  messages: StoredMessage[];
  state: ContextState | undefined;
  includeReasoning: boolean;
  systemPrompt: string;
  summaryEditing: boolean;
  setSummaryEditing: (value: boolean) => void;
  onSave: (state: ContextState) => Promise<boolean>;
  confirm: (request: { tone?: "danger" | "warning" | "info"; title: string; message?: string; confirmLabel?: string }) => Promise<boolean>;
  onClose: () => void;
};

type TextEdit = { kind: "content" | "reasoning"; messageId: string; value: string; original: string };

const pretty = (value: unknown) => { try { return JSON.stringify(value ?? null, null, 2); } catch { return String(value); } };

export function ContextView({ ko, messages, state, includeReasoning, systemPrompt, summaryEditing, setSummaryEditing, onSave, confirm, onClose }: Props) {
  const current: ContextState = state || { overrides: {} };
  const applied = applyContextState(messages, current);
  const entries = new Map(applied.entries.map(entry => [entry.original.id, entry]));
  const summaryIndex = current.summary ? messages.findIndex(message => message.id === current.summary!.throughMessageId) : -1;
  const droppedIndex = current.droppedThroughMessageId ? messages.findIndex(message => message.id === current.droppedThroughMessageId) : -1;
  const [textEdit, setTextEdit] = useState<TextEdit>();
  const [toolEdit, setToolEdit] = useState<{ messageId: string; event: ToolEvent }>();
  const [systemOpen, setSystemOpen] = useState(false);

  const patchOverride = (messageId: string, change: (override: ContextMessageOverride) => ContextMessageOverride) => {
    const overrides = { ...current.overrides };
    const next = change({ ...(overrides[messageId] || {}) });
    const cleaned = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) as ContextMessageOverride;
    if (cleaned.tools && !Object.keys(cleaned.tools).length) delete cleaned.tools;
    if (Object.keys(cleaned).length) overrides[messageId] = cleaned; else delete overrides[messageId];
    void onSave({ ...current, overrides });
  };
  const saveText = (edit: TextEdit, value: string) => {
    patchOverride(edit.messageId, override => edit.kind === "content"
      ? { ...override, content: value === edit.original ? undefined : value }
      : { ...override, reasoning: value === edit.original ? undefined : value, removeReasoning: undefined });
    setTextEdit(undefined);
  };
  const clearSummary = async () => {
    if (!await confirm({ tone: "warning", title: ko ? "압축 요약 해제" : "Remove summary", message: ko ? "요약을 지우면 요약이 대신하던 메시지가 다시 모델에게 전달됩니다." : "The messages the summary stood in for will be sent to the model again.", confirmLabel: ko ? "해제" : "Remove" })) return;
    const { summary: _summary, ...rest } = current;
    void onSave(rest);
  };

  const t = (korean: string, english: string) => ko ? korean : english;
  return <div className="context-view">
    <header className="context-view-banner">
      <Layers size={17} />
      <div><strong>{t("모델에게 전달될 실제 컨텍스트", "What the model actually receives")}</strong><small>{t("여기서 고친 내용은 모델 입력에만 적용되고 채팅 기록은 바뀌지 않습니다. 중간을 고쳐도 뒤의 대화는 그대로 남습니다.", "Edits here change only the model input; the chat transcript stays as it is. Editing one message keeps everything after it.")}</small></div>
      <button type="button" onClick={onClose} aria-label={t("닫기", "Close")}><X size={16} /></button>
    </header>

    {systemPrompt && <section className="context-card context-system">
      <button type="button" className="context-card-head" aria-expanded={systemOpen} onClick={() => setSystemOpen(value => !value)}><span>{t("시스템 프롬프트", "System prompt")}</span><small>{t("추론 메뉴에서 편집", "Edit from the reasoning menu")}</small></button>
      {systemOpen && <p className="context-text">{systemPrompt}</p>}
    </section>}

    {applied.summary !== undefined && <section className="context-card context-summary">
      <div className="context-card-head"><span><Minimize2 size={14} />{t(`압축 요약 · 메시지 ${summaryIndex + 1}개를 대신함`, `Compaction summary · stands in for ${summaryIndex + 1} messages`)}</span>
        <span className="context-actions"><button type="button" onClick={() => setSummaryEditing(true)}><Pencil size={13} />{t("편집", "Edit")}</button><button type="button" onClick={() => void clearSummary()}><Undo2 size={13} />{t("요약 해제", "Remove")}</button></span></div>
      <p className="context-text">{applied.summary}</p>
    </section>}

    {messages.map((message, index) => {
      if (index <= summaryIndex) return null;
      const override = current.overrides[message.id];
      const divider = index === droppedIndex ? <div className="context-divider" key={`${message.id}-dropped`}><Eraser size={13} /><span>{t("이 지점까지 도구 세부 내용과 추론을 버림", "Tool details and reasoning are dropped up to here")}</span><button type="button" onClick={() => { const { droppedThroughMessageId: _dropped, ...rest } = current; void onSave(rest); }}><Undo2 size={12} />{t("되돌리기", "Undo")}</button></div> : null;
      if (override?.removed) return <div key={message.id} data-context-message-id={message.id}>
        <article className={`context-message ${message.role} excluded`}><p className="context-text">{message.content || t("(내용 없음)", "(no text)")}</p>
          <footer><span className="context-badge"><EyeOff size={12} />{t("모델에 보내지 않음", "Not sent")}</span><button type="button" onClick={() => patchOverride(message.id, value => ({ ...value, removed: undefined }))}><RotateCcw size={12} />{t("다시 포함", "Include")}</button></footer></article>{divider}</div>;
      const entry = entries.get(message.id);
      if (!entry) return divider;
      const shown = entry.message;
      const reasoning = includeReasoning ? shown.reasoning : undefined;
      return <div key={message.id} data-context-message-id={message.id}>
        <article className={`context-message ${message.role}`}>
          {reasoning && <details className="context-reasoning"><summary><Brain size={13} />{t("추론", "Reasoning")}</summary><p className="context-text">{reasoning}</p>
            <div className="context-actions"><button type="button" onClick={() => setTextEdit({ kind: "reasoning", messageId: message.id, value: reasoning, original: message.reasoning || "" })}><Pencil size={12} />{t("편집", "Edit")}</button><button type="button" onClick={() => patchOverride(message.id, value => ({ ...value, reasoning: undefined, removeReasoning: true }))}><EyeOff size={12} />{t("빼기", "Remove")}</button></div></details>}
          {includeReasoning && !reasoning && override?.removeReasoning && message.reasoning && <p className="context-note"><EyeOff size={12} />{t("추론을 뺐습니다", "Reasoning removed")} <button type="button" onClick={() => patchOverride(message.id, value => ({ ...value, removeReasoning: undefined }))}>{t("되돌리기", "Undo")}</button></p>}
          {message.contextPrefix && <p className="context-prefix" title={t("시스템이 모델에게만 붙이는 줄입니다. 채팅에는 보이지 않습니다.", "Added by the system for the model only; not shown in the chat.")}><Clock size={12} />{message.contextPrefix}</p>}
          {shown.content ? <p className="context-text">{shown.content}</p> : <p className="context-text muted">{t("(텍스트 없음)", "(no text)")}</p>}
          {message.attachments?.length ? <p className="context-note"><Paperclip size={12} />{t(`첨부 ${message.attachments.length}개`, `${message.attachments.length} attachments`)}</p> : null}
          {(shown.toolEvents || []).map(event => <div className="context-tool" key={event.id}><Wrench size={13} /><span><strong>{event.name}</strong><small>{override?.tools?.[event.id] ? t("수정됨", "Edited") : t("도구 호출과 결과", "Tool call and result")}</small></span>
            <button type="button" onClick={() => setToolEdit({ messageId: message.id, event })}><Pencil size={12} />{t("편집", "Edit")}</button>
            <button type="button" onClick={() => patchOverride(message.id, value => ({ ...value, tools: { ...value.tools, [event.id]: { removed: true } } }))}><EyeOff size={12} />{t("빼기", "Remove")}</button></div>)}
          {(message.toolEvents || []).filter(event => override?.tools?.[event.id]?.removed).map(event => <p className="context-note" key={event.id}><EyeOff size={12} />{t(`${event.name} 도구를 뺐습니다`, `${event.name} removed`)} <button type="button" onClick={() => patchOverride(message.id, value => { const tools = { ...value.tools }; delete tools[event.id]; return { ...value, tools }; })}>{t("되돌리기", "Undo")}</button></p>)}
          <footer>
            {entry.overridden && <span className="context-badge edited"><Check size={12} />{t("수정됨", "Edited")}</span>}
            {entry.detailsDropped && <span className="context-badge"><Eraser size={12} />{t("세부 내용 버림", "Details dropped")}</span>}
            <button type="button" onClick={() => setTextEdit({ kind: "content", messageId: message.id, value: shown.content, original: message.content })}><Pencil size={12} />{t("편집", "Edit")}</button>
            {entry.overridden && <button type="button" onClick={() => patchOverride(message.id, () => ({}))}><RotateCcw size={12} />{t("원래대로", "Revert")}</button>}
            <button type="button" onClick={() => patchOverride(message.id, value => ({ ...value, removed: true }))}><EyeOff size={12} />{t("빼기", "Exclude")}</button>
          </footer>
        </article>
        {divider}
      </div>;
    })}

    {textEdit && <TextDialog ko={ko} multiline allowEmpty title={textEdit.kind === "content" ? t("모델에게 보낼 내용 편집", "Edit what the model receives") : t("모델에게 보낼 추론 편집", "Edit the reasoning sent to the model")} value={textEdit.value} saveLabel={t("저장", "Save")} cancelLabel={t("취소", "Cancel")} onClose={() => setTextEdit(undefined)} onSave={value => saveText(textEdit, value)} />}
    {summaryEditing && applied.summary !== undefined && <TextDialog ko={ko} multiline title={t("압축 요약 편집", "Edit the compaction summary")} value={applied.summary} saveLabel={t("저장", "Save")} cancelLabel={t("취소", "Cancel")} onClose={() => setSummaryEditing(false)} onSave={value => { void onSave({ ...current, summary: { ...current.summary!, text: value } }); setSummaryEditing(false); }} />}
    {toolEdit && <ToolEditDialog ko={ko} event={toolEdit.event} onClose={() => setToolEdit(undefined)} onSave={(args, result) => { patchOverride(toolEdit.messageId, value => ({ ...value, tools: { ...value.tools, [toolEdit.event.id]: { arguments: args, result } } })); setToolEdit(undefined); }} />}
  </div>;
}

/** Tool arguments and result as JSON, edited in a modal so a stray keystroke cannot corrupt them inline. It shares the
 * text editor's layer, transitions and buttons. */
function ToolEditDialog({ ko, event, onClose, onSave }: { ko: boolean; event: ToolEvent; onClose: () => void; onSave: (args: unknown, result: unknown) => void }) {
  const [args, setArgs] = useState(pretty(event.arguments));
  const [result, setResult] = useState(pretty(event.result));
  const [error, setError] = useState("");
  const { ref, close, closing } = useModalTransition(onClose);
  const title = ko ? `${event.name} 도구 내용 편집` : `Edit ${event.name}`;
  const submit = () => {
    let parsedArgs: unknown, parsedResult: unknown;
    try { parsedArgs = JSON.parse(args || "null"); parsedResult = JSON.parse(result || "null"); }
    catch (caught) { setError((ko ? "JSON 형식이 올바르지 않습니다: " : "Invalid JSON: ") + (caught instanceof Error ? caught.message : String(caught))); return; }
    close(() => onSave(parsedArgs, parsedResult));
  };
  return createPortal(<div ref={ref} tabIndex={-1} className={`harness-modal-layer ${closing ? "modal-closing" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
    <button className="settings-backdrop" tabIndex={-1} onClick={() => close()} aria-label={ko ? "닫기" : "Close"} />
    <form className="harness-dialog text-dialog context-tool-dialog" onSubmit={item => { item.preventDefault(); submit(); }}>
      <header><h2>{title}</h2><button type="button" onClick={() => close()} aria-label={ko ? "닫기" : "Close"}><X size={20} /></button></header>
      <label className="field"><span>{ko ? "호출 인자 (JSON)" : "Arguments (JSON)"}</span><textarea data-autofocus spellCheck={false} value={args} onChange={item => { setArgs(item.target.value); setError(""); }} rows={6} /></label>
      <label className="field"><span>{ko ? "결과 (JSON)" : "Result (JSON)"}</span><textarea spellCheck={false} value={result} onChange={item => { setResult(item.target.value); setError(""); }} rows={12} /></label>
      {error && <p className="context-tool-error" role="alert">{error}</p>}
      <footer className="text-dialog-actions">
        <button type="button" className="secondary-button" onClick={() => close()}>{ko ? "취소" : "Cancel"}</button>
        <button className="save-button">{ko ? "저장" : "Save"}</button>
      </footer>
    </form>
  </div>, document.body);
}
