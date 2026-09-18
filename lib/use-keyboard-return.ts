"use client";
import { useEffect, useRef } from "react";
import { returnsFromIdle } from "./keyboard-return";

/**
 * Calls `onReturn` on the first key press after `idleMs` without keyboard input, counted from mount.
 * Server checks use this instead of a timer, so an idle tab sends nothing and a returning user sees fresh state.
 */
export function useKeyboardReturn(idleMs: number, onReturn: () => void, enabled = true) {
  const callback = useRef(onReturn);
  useEffect(() => { callback.current = onReturn; }, [onReturn]);
  useEffect(() => {
    if (!enabled) return;
    let lastKeyAt = Date.now();
    const onKey = () => { const now = Date.now(); if (returnsFromIdle(lastKeyAt, now, idleMs)) callback.current(); lastKeyAt = now; };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [idleMs, enabled]);
}
