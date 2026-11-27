/**
 * Talks to the NeuralNetUI mobile app when the page runs inside it. The app's WebView adds `NeuralNetUIApp/` to the
 * user agent and exposes `window.ReactNativeWebView`; requests go out with postMessage and come back as a
 * `nnui-native-reply` event carrying the same id.
 */
type NativeWindow = Window & { ReactNativeWebView?: { postMessage(message: string): void } };

export function isNativeShell() {
  return typeof window !== "undefined" && /\bNeuralNetUIApp\//.test(navigator.userAgent) && Boolean((window as NativeWindow).ReactNativeWebView);
}

export type NativePushReply = { permission: "granted" | "denied" | "undetermined"; enabled: boolean; token?: string; platform?: "android" | "ios"; error?: string };

let sequence = 0;
/** `status` reports permission and, when the app has notifications on, its token; `enable` asks for permission first. */
export function nativePush(action: "status" | "enable" | "disable", timeoutMs = 30_000): Promise<NativePushReply> {
  const bridge = (window as NativeWindow).ReactNativeWebView;
  if (!bridge) return Promise.reject(new Error("Not running in the app."));
  const id = `push-${Date.now()}-${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { window.removeEventListener("nnui-native-reply", onReply); reject(new Error("The app did not answer.")); }, timeoutMs);
    function onReply(event: Event) {
      const detail = (event as CustomEvent<NativePushReply & { id?: string }>).detail;
      if (detail?.id !== id) return;
      window.clearTimeout(timer); window.removeEventListener("nnui-native-reply", onReply);
      if (detail.error) reject(new Error(detail.error)); else resolve(detail);
    }
    window.addEventListener("nnui-native-reply", onReply);
    bridge.postMessage(JSON.stringify({ type: "push", action, id }));
  });
}
