"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Info } from "lucide-react";

/**
 * Keeps a popover mounted through its closing animation so opening and closing both animate.
 * Callers render while `mounted` and add the `closing` class for the exit keyframes.
 */
export function usePopoverPresence(open: boolean, duration = 170) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); return; }
    if (!mounted) return;
    setClosing(true);
    const timer = window.setTimeout(() => { setMounted(false); setClosing(false); }, duration);
    return () => window.clearTimeout(timer);
  }, [open, mounted, duration]);
  return { mounted, closing };
}

export type SelectOptionNote = { state: "yes" | "partial" | "no"; label: string; detail?: string };
/** Hover-revealed capability table for one option, with a flat summary for assistive technology. */
export type SelectOptionInfo = { title: string; rows: SelectOptionNote[]; summary: string };
export type SelectOption = { value: string; label: string; detail?: string; info?: SelectOptionInfo };

/**
 * The workspace's only dropdown. Native selects cannot carry the pill shape, the popover
 * animation or the option descriptions the model picker established, so every choice uses this.
 */
export function SelectMenu({ value, options, onChange, label, placeholder, disabled, compact }: {
  value: string; options: SelectOption[]; onChange: (value: string) => void;
  label: string; placeholder?: string; disabled?: boolean; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState<"down" | "up">("down");
  const [highlight, setHighlight] = useState(0);
  // The popover clips its own overflow, so a capability tooltip is placed against the viewport.
  const [info, setInfo] = useState<{ index: number; right: number; top?: number; bottom?: number } | null>(null);
  const fieldId = useId();
  const { mounted, closing } = usePopoverPresence(open);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  // Roving focus keeps arrow keys and screen readers on the same option.
  useEffect(() => { if (open) listRef.current?.querySelectorAll<HTMLButtonElement>("[role=\"option\"]")[highlight]?.focus(); }, [open, highlight]);

  function show() {
    if (disabled || !options.length) return;
    const box = triggerRef.current?.getBoundingClientRect();
    const wanted = Math.min(options.length * 44 + 16, 320);
    setDrop(box && box.bottom + wanted > window.innerHeight && box.top > wanted ? "up" : "down");
    setHighlight(Math.max(0, selectedIndex));
    setOpen(true);
  }
  function hide(restoreFocus = true) { setOpen(false); setInfo(null); if (restoreFocus) triggerRef.current?.focus(); }
  function choose(next: string) { onChange(next); hide(); }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && open) { event.preventDefault(); hide(); return; }
    if (event.key === "Tab" && open) { setOpen(false); return; }
    if (!open) { if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") { event.preventDefault(); show(); } return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setHighlight((current) => (current + 1) % options.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setHighlight((current) => (current - 1 + options.length) % options.length); }
    else if (event.key === "Home") { event.preventDefault(); setHighlight(0); }
    else if (event.key === "End") { event.preventDefault(); setHighlight(options.length - 1); }
  }

  return <div className={`select-menu ${compact ? "compact" : ""} ${open ? "open" : ""}`} ref={wrapRef} onKeyDown={onKeyDown}>
    <button ref={triggerRef} type="button" className="select-trigger" disabled={disabled || !options.length} aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => (open ? hide(false) : show())}>
      <span>{selected?.label || placeholder || ""}</span>
      <ChevronDown size={15} className={open ? "rotate" : ""} />
    </button>
    {mounted && <div ref={listRef} className={`popover select-popover ${drop === "up" ? "popover-up" : ""} ${closing ? "closing" : ""}`} role="listbox" aria-label={label} tabIndex={-1}>
      {options.map((option, index) => <div className="select-option-row" role="presentation" key={option.value}>
        <button type="button" role="option" aria-selected={option.value === value} aria-describedby={option.info ? `${fieldId}-note-${index}` : undefined} tabIndex={index === highlight ? 0 : -1} className={`select-option ${option.value === value ? "selected" : ""}`} onClick={() => choose(option.value)}>
          <span className="selection-dot">{option.value === value && <Check size={13} />}</span>
          <span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
        </button>
        {option.info && <>
          <span className="visually-hidden" id={`${fieldId}-note-${index}`}>{option.info.summary}</span>
          <span className="select-info" aria-hidden="true"
            onPointerEnter={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const right = Math.round(window.innerWidth - box.right);
              // Hang the table above the marker once it sits low enough that below would overflow.
              setInfo(box.bottom > window.innerHeight * .55
                ? { index, right, bottom: Math.round(window.innerHeight - box.top + 8) }
                : { index, right, top: Math.round(box.bottom + 8) });
            }}
            onPointerLeave={() => setInfo(null)}><Info size={14} /></span>
        </>}
      </div>)}
    </div>}
    {info && options[info.index]?.info && typeof document !== "undefined" && createPortal(
      <div className="capability-tip" role="presentation" style={{ top: info.top, bottom: info.bottom, right: info.right }}>
        <strong>{options[info.index].info!.title}</strong>
        {options[info.index].info!.rows.map((row) => <span key={row.label} className={`capability-row ${row.state}`}>
          <i />
          <span><b>{row.label}</b>{row.detail && <em>{row.detail}</em>}</span>
        </span>)}
      </div>, document.body)}
  </div>;
}
