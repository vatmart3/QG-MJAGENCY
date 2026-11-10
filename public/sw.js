/* LE PORT — service worker : application installable et notifications de la Douane. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// hors ligne : une page simple plutôt qu'une erreur du navigateur (rien n'est mis en cache)
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).catch(
      () =>
        new Response(
          '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LE PORT</title><body style="font-family:system-ui;background:#b7b3f2;color:#1d1b33;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><div style="font-size:48px">⚓</div><h1>Pas de réseau</h1><p>Le port se reconnecte dès que tu retrouves internet.</p></div></body></html>',
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
    ),
  );
});

self.addEventListener("push", (e) => {
  let d = { titre: "LE PORT", corps: "", url: "/", tag: "port" };
  try {
    d = { ...d, ...e.data.json() };
  } catch {
    if (e.data) d.corps = e.data.text();
  }
  e.waitUntil(
    self.registration.showNotification(d.titre, {
      body: d.corps,
      tag: d.tag,
      renotify: true,
      icon: "/icons/192",
      badge: "/icons/96",
      data: { url: d.url },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
