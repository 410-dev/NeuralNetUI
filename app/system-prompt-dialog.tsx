"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, RotateCcw, X } from "lucide-react";
import { SelectMenu } from "@/app/select-menu";
import { useModalTransition } from "@/lib/use-modal-focus";
import { composeSystemPrompt, DEFAULT_PRESET_KEY, MAX_SYSTEM_PROMPT_OVERRIDE_LENGTH, systemPromptOverride, type SystemPromptOverrides } from "@/lib/system-prompt";
import type { ModelConfig } from "@/lib/types";

/**
 * Shows the whole system prompt a model sends with each reasoning preset and lets the person rewrite it for the
 * current chat only. The default it starts from is the account's own prompt for the model (or the server default)
 * with the preset applied. Edits to several presets are kept until Save; a prompt put back to that default is removed.
 */
export function SystemPromptDialog({ ko, model, personalPrompt, initialPresetId, overrides, onSave, onClose }: {
  ko: boolean; model: ModelConfig; personalPrompt?: string; initialPresetId?: string; overrides: SystemPromptOverrides;
  onSave: (changes: Array<{ presetId?: string; prompt: string | null }>) => Promise<void>; onClose: () => void;
}) {
  const presets = model.reasoningPresets;
  const [presetId, setPresetId] = useState(presets.some(preset => preset.id === initialPresetId) ? initialPresetId : presets[0]?.id);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { ref, close, closing } = useModalTransition(onClose);
  const key = presetId || DEFAULT_PRESET_KEY;
  const composedFor = (id?: string) => composeSystemPrompt({ systemPrompt: personalPrompt?.trim() ? personalPrompt : model.systemPrompt }, presets.find(preset => preset.id === id));
  const storedFor = (id?: string) => systemPromptOverride(overrides, model.id, id) ?? composedFor(id);
  const composed = composedFor(presetId);
  const text = drafts[key] ?? storedFor(presetId);
  const customized = text.trim() !== composed.trim();
  const changes = Object.entries(drafts).filter(([id, value]) => value !== storedFor(id === DEFAULT_PRESET_KEY ? undefined : id)).map(([id, value]) => {
    const preset = id === DEFAULT_PRESET_KEY ? undefined : id;
    return { presetId: preset, prompt: value.trim() === composedFor(preset).trim() ? null : value };
  });
  const title = ko ? "시스템 프롬프트 편집" : "Edit system prompt";
  async function save() {
    if (!changes.length) { close(); return; }
    setSaving(true); setError("");
    try { await onSave(changes); close(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : ko ? "저장하지 못했습니다." : "Unable to save."); }
    finally { setSaving(false); }
  }
  return createPortal(<div ref={ref} tabIndex={-1} className={`harness-modal-layer system-prompt-layer ${closing ? "modal-closing" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
    <button className="settings-backdrop" tabIndex={-1} onClick={() => close()} aria-label={ko ? "닫기" : "Close"} />
    <form className="harness-dialog system-prompt-dialog" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><div><h2>{title}</h2><small>{model.name}</small></div><button type="button" onClick={() => close()} aria-label={ko ? "닫기" : "Close"}><X size={20} /></button></header>
      {presets.length > 0 && <div className="system-prompt-preset">
        <span>{ko ? "추론 프리셋" : "Reasoning preset"}</span>
        <SelectMenu label={ko ? "추론 프리셋" : "Reasoning preset"} value={presetId || ""} onChange={setPresetId}
          options={presets.map(preset => ({ value: preset.id, label: preset.name, detail: systemPromptOverride(overrides, model.id, preset.id) !== undefined || drafts[preset.id] !== undefined && drafts[preset.id].trim() !== composedFor(preset.id).trim() ? (ko ? "이 채팅 전용" : "This chat") : undefined }))} />
      </div>}
      <p className="harness-dialog-help">{ko
        ? "선택한 추론 프리셋이 적용된 이 모델의 전체 시스템 프롬프트입니다. 편집 내용은 이 채팅에만 적용되며, 이 채팅에서 새 채팅을 열면 그대로 이어집니다. 페이지를 새로 불러오면 새 채팅은 설정 > 모델의 값으로 시작합니다."
        : "The model's whole system prompt with the selected reasoning preset applied. Edits apply to this chat only and carry over to a new chat opened from it. After a page reload, new chats start from the value in Settings > Models."}</p>
      <div className="system-prompt-status"><b className={customized ? "customized" : ""}>{customized ? (ko ? "이 채팅 전용" : "This chat") : (ko ? "기본값" : "Default")}</b>
        <button type="button" className="subtle-action" disabled={!customized} onClick={() => setDrafts(current => ({ ...current, [key]: composed }))}><RotateCcw size={14} />{ko ? "기본값으로 되돌리기" : "Restore default"}</button></div>
      <textarea data-autofocus aria-label={title} rows={16} maxLength={MAX_SYSTEM_PROMPT_OVERRIDE_LENGTH} value={text} placeholder={ko ? "시스템 프롬프트가 없습니다." : "No system prompt."} onChange={(event) => setDrafts(current => ({ ...current, [key]: event.target.value }))} />
      {error && <p className="system-prompt-error" role="alert">{error}</p>}
      <footer className="text-dialog-actions">
        <button type="button" className="secondary-button" onClick={() => close()}>{ko ? "취소" : "Cancel"}</button>
        <button className="save-button" disabled={saving || !changes.length}>{saving && <LoaderCircle className="spin" size={14} />}{ko ? "저장" : "Save"}</button>
      </footer>
    </form>
  </div>, document.body);
}
