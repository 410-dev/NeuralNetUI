/** True when a key press ends a stretch of at least `idleMs` without keyboard input. */
export function returnsFromIdle(lastKeyAt: number, now: number, idleMs: number) { return now - lastKeyAt >= idleMs; }
