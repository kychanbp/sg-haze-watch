/* SG Haze Watch service worker: the app opens with no network and shows the last forecast.
   Files of this site: network first (always the newest when online), the stored copy when offline.
   A page or a script that is slow (more than 3 s) comes from the stored copy; the forecast data always waits for the network.
   Leaflet and the fonts never change for one address: stored copy first. Map tiles are not stored. */
const CACHE = "haze-watch-v1";
const SHELL = [
  "index.html", "map.html", "learn.html", "about.html", "manifest.webmanifest",
  "assets/style.css", "assets/common.js", "assets/app.js", "assets/map.js", "assets/learn.js", "assets/about.js", "assets/box.js",
  "assets/icon.svg", "assets/icon-96.png", "assets/icon-192.png",
  "data/forecast.json", "data/map.json", "data/history.json",
  "data/static/skill.json", "data/static/blh_clim.json", "data/static/emissions.json", "data/static/emis_all.png", "data/static/peat.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];
const LIBS = /^(unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;
const SLOW_MS = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // one stored copy per file: the "?v=" part (it only stops old copies in the browser cache) is not part of the key
    let key = url.origin + url.pathname;
    if (key.endsWith("/")) key += "index.html";
    const home = new URL("index.html", self.registration.scope).href;
    const net = fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return r;
    });
    e.waitUntil(net.then(() => null, () => null));
    const isData = url.pathname.includes("/data/");
    e.respondWith((async () => {
      try {
        const slow = isData ? null : new Promise((res) => setTimeout(res, SLOW_MS)).then(() => caches.match(key));
        const first = await (slow ? Promise.race([net, slow]) : net);
        return first || await net;
      } catch (err) {
        const hit = await caches.match(key) || (req.mode === "navigate" ? await caches.match(home) : null);
        return hit || Response.error();
      }
    })());
  } else if (LIBS.test(url.hostname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    })));
  }
});
