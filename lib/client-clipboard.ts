type ClipboardAdapter = {
  isSecureContext: boolean;
  writeText?: (text: string) => Promise<void>;
  fallbackCopy: (text: string) => boolean;
};

export async function copyTextWithAdapter(adapter: ClipboardAdapter, text: string) {
  if (adapter.isSecureContext && adapter.writeText) {
    try {
      await adapter.writeText(text);
      return true;
    } catch {
      // Some browsers expose the API while denying it for the current page.
    }
  }
  return adapter.fallbackCopy(text);
}

function fallbackDocumentCopy(text: string) {
  if (typeof document === "undefined" || !document.body) return false;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    position: "fixed",
    inset: "0 auto auto -9999px",
    width: "1px",
    height: "1px",
    opacity: "0",
    fontSize: "16px",
    pointerEvents: "none",
  });
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try { copied = document.execCommand("copy"); }
  catch { copied = false; }
  textarea.remove();
  active?.focus({ preventScroll: true });
  return copied;
}

export function copyTextToClipboard(text: string) {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  return copyTextWithAdapter({
    isSecureContext: typeof window !== "undefined" && window.isSecureContext,
    writeText: clipboard?.writeText ? (value) => clipboard.writeText(value) : undefined,
    fallbackCopy: fallbackDocumentCopy,
  }, text);
}
