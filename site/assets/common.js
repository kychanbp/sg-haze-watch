/* SG Haze Watch: shared helpers (bands, mascot, dates, theme, tooltip). No libraries. */
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
    const sync = () => { const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches); b.textContent = dark ? "☀️" : "🌙"; b.title = dark ? "Light mode" : "Dark mode"; };
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

  return { BANDS, band, color, psi, mascot, dayName, dateShort, dateLong, hourLabel, sgToday, initTheme, tip, getJSON, PARTS, isDark, basemap };
})();
document.addEventListener("DOMContentLoaded", HW.initTheme);
