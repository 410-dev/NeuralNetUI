"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export const MODAL_TRANSITION_MS = 190;

export function useModalFocus(onClose: () => void) {
  const layer = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const root = layer.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== root);
    const inert = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });
    const focusable = () => [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')]
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
    // Header controls come first in the markup, so a search or editing dialog would open with the
    // keyboard on Close. A dialog that has a field to work in names it and receives focus there.
    // On a touch screen, focusing a field raises the keyboard over half the dialog before the
    // person has asked to type, so the preference only applies where a real pointer is in use.
    const preferred = () => {
      if (!window.matchMedia("(pointer: fine)").matches) return null;
      const marked = root.querySelector<HTMLElement>("[data-autofocus]");
      return marked && !marked.hasAttribute("disabled") && marked.getClientRects().length > 0 ? marked : null;
    };
    const focusFirst = () => (preferred() || focusable()[0] || root).focus();
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (root.inert) return;
      // An open dropdown inside the dialog takes the first Escape for itself.
      if (event.key === "Escape" && document.activeElement?.closest(".select-menu.open")) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      const elements = focusable(); const first = elements[0]; const last = elements.at(-1);
      if (!first) { event.preventDefault(); root.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => { if (!root.inert && !root.contains(event.target as Node)) focusFirst(); };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    focusFirst();
    return () => {
      document.removeEventListener("keydown", keydown, true); document.removeEventListener("focusin", focusin);
      siblings.forEach((element, index) => { element.inert = inert[index]; });
      // Legacy callers can still unmount immediately after invoking their close callback. Leave a
      // non-interactive visual snapshot behind for one shared exit beat so every independent modal
      // closes as smoothly as the settings panel while those callers migrate to useModalTransition.
      if (!root.classList.contains("modal-closing") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const snapshot = root.cloneNode(true) as HTMLElement;
        snapshot.removeAttribute("id"); snapshot.inert = true; snapshot.setAttribute("aria-hidden", "true");
        snapshot.classList.add("modal-closing", "modal-exit-snapshot");
        document.body.append(snapshot);
        window.setTimeout(() => snapshot.remove(), MODAL_TRANSITION_MS);
      }
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return layer;
}

/** Keeps a modal mounted long enough for the shared exit motion to finish. */
export function useModalTransition(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = useCallback((after?: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    const finish = () => { after?.(); onClose(); };
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    setClosing(true);
    timer.current = setTimeout(finish, MODAL_TRANSITION_MS);
  }, [onClose]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const ref = useModalFocus(() => close());
  return { ref, close, closing };
}
