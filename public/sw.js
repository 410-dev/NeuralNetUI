// Neural Chat service worker: makes the app installable over HTTPS.
// It caches nothing; every request goes to the network. Page navigations that
// fail while offline get a small fallback page instead of the browser error.
const OFFLINE_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Neural Chat</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#0a0a0c;color:#e8e8ec;font-family:system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}button{margin-top:16px;padding:10px 18px;border-radius:10px;border:1px solid #2a2a30;background:#16161a;color:inherit;font:inherit;cursor:pointer}</style></head><body><div><p>서버에 연결할 수 없습니다.<br>Can't reach the server.</p><button onclick="location.reload()">다시 시도 / Retry</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE_HTML, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  })));
});

// Agent notifications. Every device receives them; a "close" message, sent once the person looks at the agent on
// any device, replaces the notification under the same tag and closes it so it disappears everywhere.
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const tag = data.tag || "neuralnetui-agent";
  event.waitUntil((async () => {
    if (data.close) {
      // Browsers expect a visible notification for each push, so a silent replacement is shown and closed at once.
      await self.registration.showNotification(data.title || "Neural Chat", { tag, silent: true, renotify: false });
      for (const notification of await self.registration.getNotifications({ tag })) notification.close();
      return;
    }
    await self.registration.showNotification(data.title || "Neural Chat", { body: data.body || "", tag, renotify: true, icon: "/pwa/icon-192.png", badge: "/pwa/icon-192.png", data: { url: data.url || "/?agent=1" } });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/?agent=1", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.focus(); existing.postMessage({ type: "open-agent" }); return; }
    await self.clients.openWindow(url);
  })());
});
