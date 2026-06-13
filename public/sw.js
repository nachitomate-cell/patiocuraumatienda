// Service worker minimo para que la PWA abra sin conexion (app shell).
// Los datos de negocio los maneja Firestore con su cache offline propia.
const CACHE = "patio-pos-v2";
const APP_SHELL = ["/", "/venta", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // No interceptar llamadas a Firebase/Google: las gestiona el SDK.
  if (/firebase|googleapis|gstatic/.test(url.host)) return;

  // respondWith() exige SIEMPRE un Response; si se resuelve a undefined el
  // navegador lanza "Failed to convert value to 'Response'". Por eso todas las
  // ramas de abajo terminan en un Response real (de red, de cache o sintetico).
  const offline = () =>
    new Response("Sin conexion", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

  // Navegaciones (cambios de página): siempre red primero. Nunca servir una
  // redireccion cacheada, que rompe la navegacion ("redirect mode not follow").
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches
          .match("/venta")
          .then((r) => r || caches.match("/"))
          .then((r) => r || offline())
      )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          // Solo cachear respuestas finales (no redirecciones).
          if (res.ok && !res.redirected && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || offline());
      return cached || network;
    })
  );
});
