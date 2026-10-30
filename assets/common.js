/* SG Haze Watch: shared helpers (bands, mascot, dates, theme, tooltip, app install). No libraries. */
const HW = (() => {
  const BANDS = [
    { key: "good", name: "Good", lo: 0, hi: 50, emoji: "😀" },
    { key: "moderate", name: "Moderate", lo: 51, hi: 100, emoji: "🙂" },
    { key: "unhealthy", name: "Unhealthy", lo: 101, hi: 200, emoji: "😷" },
    { key: "very-unhealthy", name: "Very unhealthy", lo: 201, hi: 300, emoji: "😫" },
    { key: "hazardous", name: "Hazardous", lo: 301, hi: 9999, emoji: "☠️" },
  ];
  const band = (psi) => BANDS.find((b) => psi <= b.hi) || BANDS[BANDS.length - 1];
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const color = (key) => css("--" + key);

  // NEA PSI from 24-h PM2.5 (PM2.5 sub-index), linear between the breakpoints
  const PC = [0, 12, 55, 150, 250, 350, 500], PI = [0, 50, 100, 200, 300, 400, 500];
  function psi(c) {
    if (!(c >= 0)) return NaN;
    for (let i = 1; i < PC.length; i++) if (c <= PC[i]) return PI[i - 1] + (c - PC[i - 1]) * (PI[i] - PI[i - 1]) / (PC[i] - PC[i - 1]);
    return 500;
  }

  // Puff, the little cloud of air. Its face follows the air quality band.
  function mascot(key, opt = {}) {
    const c = color(key) || "#2e9e5b";
    const sick = ["unhealthy", "very-unhealthy", "hazardous"].includes(key);
    const dots = { good: 0, moderate: 3, unhealthy: 9, "very-unhealthy": 16, hazardous: 24 }[key] || 0;
    let p = "";
    const rnd = (i) => { const x = Math.sin(i * 99.13 + 7) * 43758.5453; return x - Math.floor(x); };
    for (let i = 0; i < dots; i++) {
      const a = rnd(i) * Math.PI * 2, r = 74 + rnd(i + 50) * 22;
      p += `<circle cx="${100 + Math.cos(a) * r}" cy="${104 + Math.sin(a) * r * 0.8}" r="${2 + rnd(i + 9) * 3}" fill="${c}" opacity=".45">` +
        (opt.still ? "" : `<animate attributeName="cy" values="${104 + Math.sin(a) * r * 0.8};${98 + Math.sin(a) * r * 0.8};${104 + Math.sin(a) * r * 0.8}" dur="${2 + rnd(i) * 2}s" repeatCount="indefinite"/>`) + `</circle>`;
    }
    const eyes = {
      good: `<ellipse cx="78" cy="98" rx="7" ry="9" fill="#1d2a33"/><ellipse cx="122" cy="98" rx="7" ry="9" fill="#1d2a33"/><circle cx="80" cy="95" r="2.5" fill="#fff"/><circle cx="124" cy="95" r="2.5" fill="#fff"/>`,
      moderate: `<ellipse cx="78" cy="99" rx="6.5" ry="8" fill="#1d2a33"/><ellipse cx="122" cy="99" rx="6.5" ry="8" fill="#1d2a33"/><circle cx="80" cy="96" r="2.2" fill="#fff"/><circle cx="124" cy="96" r="2.2" fill="#fff"/>`,
      unhealthy: `<path d="M70 98 q8 -7 16 0" stroke="#1d2a33" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M114 98 q8 -7 16 0" stroke="#1d2a33" stroke-width="4" fill="none" stroke-linecap="round"/>`,
      "very-unhealthy": `<path d="M70 92 l14 6" stroke="#1d2a33" stroke-width="4" stroke-linecap="round"/><path d="M130 92 l-14 6" stroke="#1d2a33" stroke-width="4" stroke-linecap="round"/><ellipse cx="78" cy="102" rx="5" ry="6" fill="#1d2a33"/><ellipse cx="122" cy="102" rx="5" ry="6" fill="#1d2a33"/>`,
      hazardous: `<path d="M71 92 l14 14 M85 92 l-14 14 M115 92 l14 14 M129 92 l-14 14" stroke="#1d2a33" stroke-width="4" stroke-linecap="round"/>`,
    }[key];
    const mouth = sick
      ? `<g><path d="M62 112 q38 -12 76 0 v18 q-38 22 -76 0z" fill="#fff" stroke="#cfd8de" stroke-width="2"/><path d="M62 116 l-16 -10 M138 116 l16 -10" stroke="#cfd8de" stroke-width="3"/><path d="M74 120 h52 M76 127 h48" stroke="#dfe6ea" stroke-width="2"/></g>`
      : key === "good"
        ? `<path d="M84 116 q16 16 32 0" stroke="#1d2a33" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="64" cy="114" r="7" fill="#ff8fa3" opacity=".55"/><circle cx="136" cy="114" r="7" fill="#ff8fa3" opacity=".55"/>`
        : `<path d="M88 118 q12 6 24 0" stroke="#1d2a33" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    const body = `<path d="M52 140 q-30 0 -30 -28 q0 -26 28 -28 q4 -34 40 -36 q22 -18 46 -4 q30 -2 36 30 q30 4 28 34 q-2 32 -34 32 z" fill="${c}" opacity=".9"/>` +
      `<path d="M52 140 q-30 0 -30 -28 q0 -26 28 -28 q4 -34 40 -36 q22 -18 46 -4 q30 -2 36 30 q30 4 28 34 q-2 32 -34 32 z" fill="#fff" opacity=".35"/>`;
    const bob = opt.still ? "" : `<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="3s" repeatCount="indefinite"/>`;
    return `<svg viewBox="0 0 200 200" role="img" aria-label="${opt.label || "Air quality: " + key}">${p}<g>${bob}${body}${eyes}${mouth}</g></svg>`;
  }

  // dates: the forecast speaks Singapore time
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const sgToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const parseDay = (s) => new Date(s + "T00:00:00Z");
  function dayName(s, rel = true) {
    const t = sgToday();
    const diff = Math.round((parseDay(s) - parseDay(t)) / 864e5);
    if (rel && diff === 0) return "Today";
    if (rel && diff === 1) return "Tomorrow";
    if (rel && diff === -1) return "Yesterday";
    return DOW[parseDay(s).getUTCDay()];
  }
  const dateShort = (s) => { const d = parseDay(s); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  const dateLong = (s) => { const d = parseDay(s); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  const hourLabel = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 || h === 24 ? " am" : " pm");

  // theme toggle (remembered per viewer)
  function initTheme() {
    let t = null; try { t = localStorage.getItem("hw-theme"); } catch (e) { }
    if (t) document.documentElement.dataset.theme = t;
    const b = document.querySelector(".theme-btn");
    if (!b) return;
    const sync = () => {
      const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
      b.textContent = dark ? "☀️" : "🌙"; b.title = dark ? "Light mode" : "Dark mode";
      if (document.documentElement.dataset.theme) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#0d1620" : "#eef5fa"));
    };
    b.addEventListener("click", () => {
      const dark = b.textContent === "☀️";
      document.documentElement.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("hw-theme", document.documentElement.dataset.theme); } catch (e) { }
      sync(); document.dispatchEvent(new Event("themechange"));
    });
    sync();
  }

  // tooltip
  let tipEl;
  function tip(html, ev) {
    if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tip"; document.body.appendChild(tipEl); }
    if (!html) { tipEl.style.opacity = 0; return; }
    tipEl.innerHTML = html; tipEl.style.opacity = 1;
    const x = Math.min(ev.clientX + 14, innerWidth - tipEl.offsetWidth - 8), y = Math.max(8, ev.clientY - tipEl.offsetHeight - 12);
    tipEl.style.left = x + "px"; tipEl.style.top = y + "px";
  }

  async function getJSON(url) {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "v=" + Math.floor(Date.now() / 6e5), { cache: "no-store" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  // base map: Esri grey canvas (no key needed), light or dark with the page theme
  const isDark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  function basemap(map) {
    const k = isDark() ? "Dark" : "Light", u = (s) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${k}_Gray_${s}/MapServer/tile/{z}/{y}/{x}`;
    const att = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
    L.tileLayer(u("Base"), { attribution: att, maxZoom: 16 }).addTo(map);
    map.createPane("labels"); map.getPane("labels").style.zIndex = 650; map.getPane("labels").style.pointerEvents = "none";
    L.tileLayer(u("Reference"), { pane: "labels", maxZoom: 16 }).addTo(map);
  }

  const PARTS = [
    { key: "fresh", name: "Fresh fire smoke", emoji: "🔥", text: "smoke from fires of the last few days, carried here by the wind" },
    { key: "old", name: "Old regional smoke", emoji: "🌫️", text: "older smoke that hangs over the whole region" },
    { key: "local", name: "Singapore's own", emoji: "🚗", text: "traffic, industry and cooking in Singapore" },
    { key: "ship", name: "Ships", emoji: "🚢", text: "ship exhaust (sulphur) from the busy sea lanes" },
    { key: "background", name: "Background", emoji: "🌏", text: "the small amount that is always in the air of the region" },
  ];

  // ---------- the app: top bar, install on the home screen, refresh ----------
  function topBar() {
    const h = document.querySelector(".top");
    if (!h) return;
    const f = () => h.classList.toggle("scrolled", scrollY > 6);
    addEventListener("scroll", f, { passive: true }); f();
  }

  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let promptEv = null;
  const onPrompt = [];
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptEv = e; onPrompt.forEach((f) => f()); });
  addEventListener("appinstalled", () => { promptEv = null; document.querySelectorAll(".install-bar").forEach((el) => el.remove()); onPrompt.forEach((f) => f()); });
  async function install() {
    if (!promptEv) return false;
    promptEv.prompt();
    const r = await promptEv.userChoice.catch(() => null);
    promptEv = null;
    return !!(r && r.outcome === "accepted");
  }
  const IOS_SHARE = `<svg class="ios-share" viewBox="0 0 24 24" aria-label="Share"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>`;

  // a small card above the tab bar on phones; "Not now" hides it for 14 days
  function installBar() {
    const KEY = "hw-install-later";
    let later = 0; try { later = +localStorage.getItem(KEY) || 0; } catch (e) { }
    if (Date.now() < later || standalone()) return;
    const show = () => {
      if (standalone() || document.querySelector(".install-bar") || !matchMedia("(max-width: 760px)").matches) return;
      if (!promptEv && !isIOS()) return;
      const bar = document.createElement("div");
      bar.className = "install-bar"; bar.setAttribute("role", "dialog"); bar.setAttribute("aria-label", "Get the app");
      bar.innerHTML = `<img src="assets/icon-96.png" alt="" width="40" height="40"><div><b>Get the Haze Watch app</b><span>` +
        (promptEv ? "Add it to your home screen. It opens full screen, and it shows the last forecast with no network."
          : `Tap ${IOS_SHARE} Share in Safari, then <b>Add to Home Screen</b>.`) + `</span></div>` +
        (promptEv ? `<button class="btn primary" type="button" data-act="add">Add</button>` : "") +
        `<button class="x" type="button" aria-label="Not now" data-act="x">×</button>`;
      bar.addEventListener("click", async (e) => {
        const act = e.target.closest("button") && e.target.closest("button").dataset.act;
        if (act === "add" && await install()) bar.remove();
        if (act === "x") { bar.remove(); try { localStorage.setItem(KEY, String(Date.now() + 14 * 864e5)); } catch (err) { } }
      });
      document.body.appendChild(bar);
    };
    setTimeout(show, 2500); onPrompt.push(() => setTimeout(show, 400));
  }

  // the "Get the app" card on the about page
  function installCard(el) {
    if (!el) return;
    const render = () => {
      if (standalone()) { el.innerHTML = `<p>✅ You use Haze Watch as an app on this device now.</p>`; return; }
      el.innerHTML = `<p>Put Haze Watch on your home screen. It opens full screen like an app, and it shows the last forecast when there is no network. It is free, it needs no app store, and it does not track you.</p>` +
        (promptEv ? `<p><button class="btn primary" type="button">📲 Install the app</button></p>` : "") +
        `<ul><li><b>iPhone and iPad:</b> open this site in Safari, tap ${IOS_SHARE} Share, then <b>Add to Home Screen</b>.</li>` +
        `<li><b>Android:</b> open this site in Chrome, tap the menu ⋮, then <b>Install app</b> or <b>Add to Home screen</b>.</li></ul>`;
      const b = el.querySelector("button");
      if (b) b.onclick = async () => { await install(); render(); };
    };
    render(); onPrompt.push(render);
  }

  // an app can stay open for days: get the new forecast when it comes back after some hours
  function autoRefresh(hours = 3) {
    const t0 = Date.now();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - t0 > hours * 3600e3) location.reload(); });
  }

  return { BANDS, band, color, psi, mascot, dayName, dateShort, dateLong, hourLabel, sgToday, initTheme, tip, getJSON, PARTS, isDark, basemap, installBar, installCard, autoRefresh, topBar };
})();
document.addEventListener("DOMContentLoaded", () => { HW.initTheme(); HW.topBar(); HW.installCard(document.getElementById("install-card")); });
// offline copy of the site and the last forecast (sw.js)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { }));
