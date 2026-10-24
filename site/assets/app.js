/* SG Haze Watch: forecast page. Reads data/forecast.json, data/map.json, data/history.json. */
(async function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (x, d = 0) => (x == null || Number.isNaN(x) ? "–" : Number(x).toFixed(d));
  let F, M, Hs;
  try {
    [F, M, Hs] = await Promise.all([HW.getJSON("data/forecast.json"), HW.getJSON("data/map.json"), HW.getJSON("data/history.json").catch(() => ({ days: [] }))]);
  } catch (e) {
    $("hero-title").textContent = "The forecast is not available now. Please try again later.";
    return;
  }
  const days = F.days;
  const today = HW.sgToday();
  const hourNow = new Date(Date.now() + 8 * 3600e3).getUTCHours();
  let focus = days.findIndex((d) => d.date >= today);
  if (focus < 0) focus = days.length - 1;
  if (hourNow >= 18 && days[focus].date === today && focus + 1 < days.length) focus += 1;   // in the evening, show tomorrow

  // ---------- hero ----------
  const ADVICE = {
    good: "Normal activities for everyone.",
    moderate: "Normal activities for everyone.",
    unhealthy: "Healthy people: do less long or hard exercise outdoors. Older people, children and pregnant women: keep long or hard outdoor exercise to a minimum. People with heart or lung disease: avoid it.",
    "very-unhealthy": "Healthy people: avoid long or hard exercise outdoors. Older people, children and pregnant women: keep outdoor activity to a minimum. People with heart or lung disease: avoid outdoor activity.",
    hazardous: "Everyone: keep outdoor activity to a minimum. Older people, children, pregnant women and people with heart or lung disease: avoid outdoor activity.",
  };
  // "Today, Sat 24 Oct" or "Tue 27 Oct": never the day name two times
  const whenLong = (s) => { const r = HW.dayName(s); return r === HW.dayName(s, false) ? HW.dateLong(s) : `${r}, ${HW.dateLong(s)}`; };
  function stars(lead) { const n = [5, 4, 4, 3, 3, 2, 2][lead - 1] || 2; return "★".repeat(n) + "☆".repeat(5 - n); }
  function showHero(i) {
    const d = days[i], b = HW.band(d.psi);
    $("hero-mascot").innerHTML = HW.mascot(b.key, { label: `Air quality ${b.name}` });
    $("hero-kicker").textContent = `Forecast · ${whenLong(d.date)}`;
    $("hero-title").innerHTML = `<span class="bignum t-${b.key}">PSI ${d.psi}</span> <span class="pill b-${b.key}">${b.name}</span>`;
    $("hero-sub").innerHTML = `Likely range: <b>PSI ${d.psi_lo}–${d.psi_hi}</b>`;
    const stat = (k, v, u) => `<div class="stat"><span class="k">${k}</span><b>${v}</b><span class="u">${u}</span></div>`;
    $("hero-facts").innerHTML = [
      stat("PM2.5 day mean", `${fmt(d.pm25)} <small>µg/m³</small>`, `likely ${fmt(d.pm25_lo)}–${fmt(d.pm25_hi)}`),
      stat("Wind", `${fmt(d.wind_ms, 1)} <small>m/s</small>`, `from the ${d.wind_from}`),
      stat("Rain", `${fmt(d.rain_sg_mm)} <small>mm</small>`, "in Singapore"),
      stat("Lid height", `${d.mixing_height[0]}–${d.mixing_height[1]} <small>m</small>`, "night to afternoon"),
    ].join("");
    const p = Math.round(d.p_psi100 * 100), pc = p >= 50 ? "unhealthy" : p >= F.leads.p_watch * 100 ? "moderate" : "good";
    $("hero-chance").innerHTML = `<span><b>Chance of PSI above 100</b></span><div class="meter"><i style="width:${Math.max(p, 2)}%;background:${HW.color(pc)}"></i></div><b>${p}%</b>`;
    const day = whenLong(d.date);
    const bn = {
      warn: `<div class="banner warn"><span class="ico">⚠️</span><div>Haze warning for ${day}: the PSI is likely to go above 100 (unhealthy).<p>${ADVICE[b.key === "good" || b.key === "moderate" ? "unhealthy" : b.key]} <a href="https://www.haze.gov.sg/">NEA advice</a></p></div></div>`,
      watch: `<div class="banner watch"><span class="ico">👀</span><div>Haze watch for ${day}: the PSI could go above 100 (chance ${p}%).<p>Check the NEA readings before long outdoor activities. <a href="https://www.haze.gov.sg/">NEA advice</a></p></div></div>`,
      none: `<div class="banner none"><span class="ico">✅</span><div>No haze warning for ${day}.<p>${ADVICE[b.key]}</p></div></div>`,
    };
    $("hero-banner").innerHTML = bn[d.warning];
    document.querySelectorAll(".day").forEach((el, k) => el.classList.toggle("sel", k === i));
    showParts(i); showPath(i); drawHours(i);
  }

  // share
  function shareText(i) {
    const d = days[i], b = HW.band(d.psi);
    const nxt = days.slice(i + 1, i + 4).map((x) => `${HW.dayName(x.date, false)} ${x.psi}`).join(", ");
    return `🌫️ SG Haze Watch – ${HW.dayName(d.date)} ${HW.dateShort(d.date)}: PSI about ${d.psi} (${b.name}), PM2.5 about ${fmt(d.pm25)} µg/m³. Chance of PSI above 100: ${Math.round(d.p_psi100 * 100)}%. Next days: ${nxt}.`;
  }
  const url = location.href.split("#")[0].split("?")[0];
  const SHARE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>`;
  $("share").classList.toggle("native", !!navigator.share);
  $("share").innerHTML = (navigator.share ? `<button class="btn primary sh-main" id="sh-native" type="button">${SHARE_ICON}Share with friends</button>` : "") +
    `<a class="btn ${navigator.share ? "ghost" : "primary"} sh-alt" id="sh-wa" target="_blank" rel="noopener">WhatsApp</a><a class="btn ghost sh-alt" id="sh-tg" target="_blank" rel="noopener">Telegram</a><button class="btn ghost sh-alt" id="sh-copy" type="button">Copy</button>`;
  function updateShare() {
    const t = shareText(focus);
    $("sh-wa").href = "https://wa.me/?text=" + encodeURIComponent(t + " " + url);
    $("sh-tg").href = "https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(t);
  }
  $("sh-copy").onclick = async () => { try { await navigator.clipboard.writeText(shareText(focus) + " " + url); $("sh-copy").textContent = "Copied ✓"; } catch (e) { } };
  const nativeShare = () => navigator.share({ title: "SG Haze Watch", text: shareText(focus), url }).catch(() => { });
  if (navigator.share) { $("sh-native").onclick = nativeShare; $("share-top").hidden = false; $("share-top").onclick = nativeShare; }

  // notices: no network (the app shows the copy saved on this device), or an old forecast
  const issued = new Date(F.issued_sgt + ":00+08:00"), notes = [];
  if (!navigator.onLine) { notes.push("📴 No network. This is the last forecast that this device saved."); addEventListener("online", () => location.reload(), { once: true }); }
  if (Date.now() - issued > 30 * 3600e3) notes.push(`This forecast was made on ${F.issued_sgt.replace("T", " ")} (Singapore time) and is old.` + (navigator.onLine ? " The nightly update may have failed." : ""));
  if (notes.length) { $("stale").style.display = "block"; $("stale").textContent = notes.join(" "); }
  $("updated").textContent = `Forecast made ${F.issued_sgt.replace("T", " ")} Singapore time · weather: ECMWF IFS run ${F.inputs.ifs_run} · fires to ${F.inputs.fires_to} · readings to ${F.inputs.obs_to.replace("T", " ")} · peat dryness ${F.inputs.peat_dryness_mm ?? "–"} mm. A new forecast comes every night at about 00:30.`;

  // ---------- 7 days ----------
  $("days").innerHTML = days.map((d, i) => {
    const b = HW.band(d.psi), sc = 300, l = Math.min(d.psi_lo, sc) / sc * 100, r = Math.min(d.psi_hi, sc) / sc * 100, c = Math.min(d.psi, sc) / sc * 100;
    const flag = d.warning === "warn" ? "⚠️" : d.warning === "watch" ? "👀" : "", p = Math.round(d.p_psi100 * 100);
    return `<button class="day" type="button" data-i="${i}" aria-label="${HW.dateLong(d.date)}: PSI ${d.psi}, ${b.name}, chance of PSI above 100 ${p}%">
      <span class="d-when"><b class="dname">${HW.dayName(d.date)}${flag ? ` <span class="flag">${flag}</span>` : ""}</b><span class="ddate">${HW.dateShort(d.date)}</span><span class="stars" title="How sure: ${d.lead === 1 ? "next day" : d.lead + " days ahead"}">${stars(d.lead)}</span></span>
      <span class="mini">${HW.mascot(b.key, { still: true })}</span>
      <span class="d-psi"><b class="psi t-${b.key}">${d.psi}</b><span class="range"><span class="lbl">PSI </span>${d.psi_lo}–${d.psi_hi}</span></span>
      <span class="d-bar"><span class="bar" title="likely range"><i style="left:${l}%;width:${Math.max(r - l, 2)}%;background:${HW.color(b.key)}"></i><b style="left:calc(${c}% - 2px)"></b></span><span class="range">PM2.5 ~${fmt(d.pm25)}</span></span>
      <span class="d-chance"><span>&gt;100</span><b>${flag ? `<i class="flag2">${flag}</i> ` : ""}${p}%</b></span></button>`;
  }).join("");
  const phone = matchMedia("(max-width: 640px)");
  document.querySelectorAll(".day").forEach((el) => el.addEventListener("click", () => {
    focus = +el.dataset.i; showHero(focus); updateShare();
    if (phone.matches) $("hero").scrollIntoView({ behavior: "smooth", block: "start" });       // the day list sits under the day card
  }));

  // ---------- what is in the air ----------
  function showParts(i) {
    const d = days[i];
    $("whatsin-day").textContent = `${whenLong(d.date)}: parts of the PM2.5 (model).`;
    $("parts").innerHTML = HW.PARTS.map((p) => `<i style="width:${(d.parts[p.key] * 100).toFixed(1)}%;background:var(--${p.key})" title="${p.name}"></i>`).join("");
    $("parts-legend").innerHTML = HW.PARTS.map((p) => `<span><i style="background:var(--${p.key})"></i>${p.emoji} ${p.name} <b>${Math.round(d.parts[p.key] * 100)}%</b> (${fmt(d.parts[p.key] * d.pm25)} µg/m³)</span>`).join("");
    $("why").innerHTML = whyText(d);
  }
  function whyText(d) {
    const s = [];
    s.push(`The air that reaches Singapore comes from the <b>${d.air_from || "–"}</b>. One day before, it was over <b>${d.air_place_24h || "the sea"}</b>${d.air_place_48h && d.air_place_48h !== d.air_place_24h ? `, and two days before over <b>${d.air_place_48h}</b>` : ""}.`);
    const fireShare = d.parts.fresh;
    if (fireShare > 0.15 && d.smoke_place) s.push(`On the way it passes over fires near <b>${d.smoke_place}</b> (about ${Math.round(d.smoke_age_h / 24 * 10) / 10} days before it arrives). Fresh smoke is ${Math.round(fireShare * 100)}% of our PM2.5.`);
    else if (fireShare > 0.03) s.push(`It picks up a little smoke from fires on the way.`);
    else s.push(`It does not pass over many fires, so there is almost no fresh smoke.`);
    if (d.rain_on_path_mm >= 20) s.push(`Rain on the way (about ${fmt(d.rain_on_path_mm)} mm) washes much of the smoke out. 🌧️`);
    else if (d.rain_on_path_mm < 5) s.push(`There is little rain on the way (${fmt(d.rain_on_path_mm, 1)} mm), so the smoke stays in the air.`);
    if (d.parts.old > 0.35) s.push(`Old smoke that hangs over the whole region is a big part (${Math.round(d.parts.old * 100)}%).`);
    if (d.wind_ms < 1.5) s.push(`The wind in Singapore is light (${fmt(d.wind_ms, 1)} m/s), so the air in our "box" changes slowly.`);
    return s.join(" ");
  }

  // ---------- mini map ----------
  let map, pathLayer;
  function initMap() {
    if (!window.L) return;
    map = L.map("minimap", { scrollWheelZoom: false, dragging: !L.Browser.mobile, attributionControl: true, zoomSnap: 0.25 }).setView([0.5, 106.5], 5);
    HW.basemap(map);
    const fl = L.layerGroup().addTo(map);
    for (const [la, lo, frp] of M.fires) {
      L.circleMarker([la, lo], { radius: Math.min(2 + Math.sqrt(frp) / 3, 12), stroke: false, fillColor: frp > 300 ? "#d23a3a" : "#ff8a1c", fillOpacity: 0.65 }).addTo(fl);
    }
    L.circleMarker([1.3, 103.82], { radius: 7, color: "#fff", weight: 2, fillColor: "#0f6fa8", fillOpacity: 1 }).bindTooltip("Singapore").addTo(map);
    pathLayer = L.layerGroup().addTo(map);
    $("fire-day").textContent = HW.dateLong(M.fires_day);
  }
  function showPath(i) {
    const d = days[i];
    $("path-text").textContent = `Air that arrives in Singapore at 2 pm (${whenLong(d.date)}).`;
    if (!map) return;
    pathLayer.clearLayers();
    const p = (M.paths.find((x) => x.date === d.date) || {}).p925 || [];
    if (p.length < 2) return;
    L.polyline(p, { color: "#0f6fa8", weight: 4, opacity: 0.85 }).addTo(pathLayer);
    [8, 16, 24, 32].forEach((k, n) => {           // points every 3 h: 8 points = 24 h
      if (p[k]) L.circleMarker(p[k], { radius: 5, color: "#0f6fa8", weight: 2, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(`${n + 1} day${n ? "s" : ""} before`, { permanent: n === 1, direction: "top", className: "" }).addTo(pathLayer);
    });
    map.fitBounds(L.latLngBounds(p.concat([[1.3, 103.82]])).pad(0.25), { maxZoom: 7 });
  }

  // ---------- hourly chart + box ----------
  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  const PM_BANDS = [[55, "good", "Normal"], [150, "unhealthy", "Elevated"], [250, "very-unhealthy", "High"], [1e9, "hazardous", "Very high"]];
  const pmBand = (v) => PM_BANDS.find((b) => v <= b[0]);
  function hourData(i) {
    const d = days[i], off = (new Date(d.date) - new Date(F.hourly.start.slice(0, 10))) / 864e5 * 24;
    return d.pm25_hourly.map((v, h) => ({ h, pm: v, blh: F.hourly.blh[off + h], wind: F.hourly.wind[off + h], rain: F.hourly.rain[off + h] }));
  }
  function drawHours(i) {
    const svg = $("hourchart"); svg.innerHTML = "";
    const D = hourData(i), W = 640, H = 260, L0 = 44, R0 = 50, T0 = 14, B0 = 34;
    const ymax = Math.max(60, ...D.map((x) => x.pm)) * 1.1, hmax = 1200;
    const x = (h) => L0 + (h + 0.5) * (W - L0 - R0) / 24, y = (v) => H - B0 - v / ymax * (H - T0 - B0), y2 = (v) => H - B0 - v / hmax * (H - T0 - B0);
    const g = svgEl("g", { class: "axis" }, svg);
    for (let v = 0; v <= ymax; v += ymax > 160 ? 50 : 20) { svgEl("line", { x1: L0, x2: W - R0, y1: y(v), y2: y(v), stroke: "currentColor", "stroke-opacity": .12 }, g); svgEl("text", { x: L0 - 6, y: y(v) + 4, "text-anchor": "end" }, g).textContent = v; }
    for (let v = 0; v <= hmax; v += 300) svgEl("text", { x: W - R0 + 6, y: y2(v) + 4 }, g).textContent = v + " m";
    for (let h = 0; h < 24; h += 3) svgEl("text", { x: x(h), y: H - B0 + 16, "text-anchor": "middle" }, g).textContent = HW.hourLabel(h);
    svgEl("text", { x: L0 - 34, y: T0 + 2 }, g).textContent = "µg/m³";
    const bw = (W - L0 - R0) / 24 * 0.72;
    D.forEach((p) => {
      const r = svgEl("rect", { x: x(p.h) - bw / 2, y: y(p.pm), width: bw, height: Math.max(1, y(0) - y(p.pm)), rx: 3, fill: HW.color(pmBand(p.pm)[1]), opacity: .85 }, svg);
      r.style.cursor = "pointer";
      const hov = (ev) => { HW.tip(`<b>${HW.hourLabel(p.h)}</b>: PM2.5 ${fmt(p.pm)} µg/m³ (${pmBand(p.pm)[2]})<br>Lid ${fmt(p.blh)} m · wind ${fmt(p.wind, 1)} m/s${p.rain > 0.05 ? ` · rain ${fmt(p.rain, 1)} mm` : ""}`, ev); drawBox(p); };
      r.addEventListener("mousemove", hov); r.addEventListener("click", hov); r.addEventListener("mouseleave", () => HW.tip(null));
    });
    svgEl("path", { d: D.map((p, k) => (k ? "L" : "M") + x(p.h) + " " + y2(p.blh)).join(" "), fill: "none", stroke: HW.color("brand") || "#0f6fa8", "stroke-width": 3, "stroke-dasharray": "6 4" }, svg);
    svgEl("text", { x: W - R0 - 4, y: y2(D[14].blh) - 8, "text-anchor": "end", fill: "currentColor", style: "font-weight:700" }, svg).textContent = "lid height";
    const d = days[i];
    $("besttime").innerHTML = `Best time for outdoor activity (${whenLong(d.date)}): <b>${HW.hourLabel(d.best_hours[0])} to ${HW.hourLabel(d.best_hours[1])}</b> (lowest PM2.5 in the forecast). The hourly shape is less sure than the day average.`;
    drawBox(D[14]);
  }
  function drawBox(p) {
    const svg = $("boxview"); svg.innerHTML = "";
    const W = 420, H = 260, G = 222, top = 20, scale = (G - top) / 1300;
    const lidY = G - Math.min(p.blh, 1300) * scale, day = p.h >= 7 && p.h <= 18;
    svgEl("rect", { x: 0, y: 0, width: W, height: G, fill: day ? "#cfe8f7" : "#1d2b45", opacity: day ? .55 : .9, rx: 10 }, svg);
    if (day) svgEl("circle", { cx: 370, cy: 40, r: 16, fill: "#ffd34d" }, svg);
    else svgEl("path", { d: "M372 28 a16 16 0 1 0 12 28 a12 12 0 1 1 -12 -28z", fill: "#f4f1c9" }, svg);
    svgEl("rect", { x: 0, y: lidY - 16, width: W, height: 16, fill: "#f6a04d", opacity: .35 }, svg);       // warm layer above the lid
    svgEl("text", { x: 10, y: lidY - 20, fill: day ? "#3a4b58" : "#e8eef3", style: "font-weight:700" }, svg).textContent = `lid (warm air above): ${Math.round(p.blh)} m`;
    const b = pmBand(p.pm);
    svgEl("rect", { x: 40, y: lidY, width: W - 80, height: G - lidY, fill: HW.color(b[1]), opacity: .28 }, svg);
    svgEl("line", { x1: 0, x2: W, y1: lidY, y2: lidY, stroke: "#f08a24", "stroke-width": 3, "stroke-dasharray": "8 5" }, svg);
    const n = Math.min(260, Math.round(p.pm * 2.2));      // dots: the same concentration looks denser in a thin box
    for (let k = 0; k < n; k++) {
      const rx = Math.sin(k * 12.9898) * 43758.5453, ry = Math.sin(k * 78.233) * 12345.6789;
      svgEl("circle", { cx: 44 + (rx - Math.floor(rx)) * (W - 88), cy: lidY + 3 + (ry - Math.floor(ry)) * (G - lidY - 6), r: 1.8, fill: day ? "#4a4036" : "#d9cbb8", opacity: .7 }, svg);
    }
    const aw = Math.min(110, 20 + p.wind * 30);
    svgEl("path", { d: `M14 ${G - 40} h${aw} m-10 -7 l10 7 l-10 7`, stroke: day ? "#1d2a33" : "#e8eef3", "stroke-width": 3, fill: "none" }, svg);
    svgEl("text", { x: 14, y: G - 50, fill: day ? "#1d2a33" : "#e8eef3", style: "font-weight:700" }, svg).textContent = `wind ${fmt(p.wind, 1)} m/s`;
    if (p.rain > 0.05) for (let k = 0; k < 14; k++) svgEl("line", { x1: 60 + k * 23, x2: 56 + k * 23, y1: top + 30 + (k % 3) * 12, y2: top + 42 + (k % 3) * 12, stroke: "#4aa3df", "stroke-width": 2 }, svg);
    svgEl("rect", { x: 0, y: G, width: W, height: H - G, fill: "#5a9e5a", rx: 0 }, svg);
    [[60, 26], [90, 40], [118, 30], [150, 52], [180, 34], [250, 46], [282, 28], [310, 38], [345, 24]].forEach(([bx, bh]) => svgEl("rect", { x: bx, y: G - bh, width: 18, height: bh, fill: day ? "#8a99a6" : "#3a4a5c" }, svg));
    svgEl("text", { x: W / 2, y: H - 14, "text-anchor": "middle", fill: "#fff", style: "font-weight:800" }, svg).textContent = `${HW.hourLabel(p.h)} · PM2.5 ${fmt(p.pm)} µg/m³`;
  }

  // ---------- fires chart ----------
  (function fireChart() {
    const svg = $("firechart"), f = F.fires, W = 640, H = 220, L0 = 40, R0 = 10, T0 = 10, B0 = 30;
    const n = f.days.length, tot = f.days.map((_, k) => f.sumatra[k] + f.kalimantan[k] + f.malaysia[k]);
    const ymax = Math.max(5, ...tot) * 1.1, bw = (W - L0 - R0) / n;
    const y = (v) => H - B0 - v / ymax * (H - T0 - B0);
    const g = svgEl("g", { class: "axis" }, svg);
    const step = ymax > 60 ? 20 : ymax > 25 ? 10 : 5;
    for (let v = 0; v <= ymax; v += step) { svgEl("line", { x1: L0, x2: W - R0, y1: y(v), y2: y(v), stroke: "currentColor", "stroke-opacity": .12 }, g); svgEl("text", { x: L0 - 6, y: y(v) + 4, "text-anchor": "end" }, g).textContent = v; }
    svgEl("text", { x: 2, y: T0 + 4 }, g).textContent = "GW";
    const cols = [["kalimantan", "#e8702a", "Kalimantan (Borneo)"], ["sumatra", "#d23a3a", "Sumatra"], ["malaysia", "#7d3cc8", "Peninsular Malaysia"]];
    f.days.forEach((dd, k) => {
      let base = 0;
      cols.forEach(([key, c]) => {
        const v = f[key][k];
        svgEl("rect", { x: L0 + k * bw + 1, y: y(base + v), width: bw - 2, height: Math.max(0, y(base) - y(base + v)), fill: c, opacity: .85 }, svg); base += v;
      });
      const hit = svgEl("rect", { x: L0 + k * bw, y: T0, width: bw, height: H - T0 - B0, fill: "transparent" }, svg);
      hit.addEventListener("mousemove", (ev) => HW.tip(`<b>${HW.dateLong(dd)}</b><br>Kalimantan ${fmt(f.kalimantan[k], 1)} GW<br>Sumatra ${fmt(f.sumatra[k], 1)} GW<br>Malaysia ${fmt(f.malaysia[k], 1)} GW<br>${f.count[k]} fire spots in the region`, ev));
      hit.addEventListener("mouseleave", () => HW.tip(null));
      if (k % 7 === n % 7) svgEl("text", { x: L0 + (k + 0.5) * bw, y: H - B0 + 16, "text-anchor": "middle" }, g).textContent = HW.dateShort(dd);
    });
    $("fire-legend").innerHTML = cols.map(([, c, name]) => `<span><i style="background:${c}"></i>${name}</span>`).join("");
  })();

  // ---------- track record ----------
  (function track() {
    const rows = (Hs.days || []).slice(-45), svg = $("trackchart"), W = 640, H = 240, L0 = 40, R0 = 10, T0 = 10, B0 = 30;
    const has = rows.filter((r) => r.pm25 != null || r.fc1 || r.hc1);
    if (!has.length) { svg.style.display = "none"; $("track-text").textContent = "The track record starts when the first forecasts are checked against the readings."; return; }
    const vals = rows.flatMap((r) => [r.pm25, r.fc1 && r.fc1[2], r.hc1 && r.hc1[2]]).filter((v) => v != null);
    const ymax = Math.max(60, ...vals) * 1.08, n = rows.length, bw = (W - L0 - R0) / n;
    const y = (v) => H - B0 - v / ymax * (H - T0 - B0), xc = (k) => L0 + (k + 0.5) * bw;
    const g = svgEl("g", { class: "axis" }, svg);
    for (let v = 0; v <= ymax; v += ymax > 150 ? 50 : 20) { svgEl("line", { x1: L0, x2: W - R0, y1: y(v), y2: y(v), stroke: "currentColor", "stroke-opacity": .12 }, g); svgEl("text", { x: L0 - 6, y: y(v) + 4, "text-anchor": "end" }, g).textContent = v; }
    svgEl("line", { x1: L0, x2: W - R0, y1: y(55.5), y2: y(55.5), stroke: HW.color("unhealthy"), "stroke-dasharray": "5 4", "stroke-width": 1.5 }, svg);
    svgEl("text", { x: W - R0 - 4, y: y(55.5) - 5, "text-anchor": "end", fill: HW.color("unhealthy"), style: "font-weight:700" }, svg).textContent = "PSI 100 level (day mean)";
    let inside = 0, cnt = 0;
    rows.forEach((r, k) => {
      const f = r.fc1 || r.hc1, live = !!r.fc1;
      if (f) {
        svgEl("rect", { x: xc(k) - bw * 0.3, y: y(f[2]), width: bw * 0.6, height: Math.max(2, y(f[1]) - y(f[2])), rx: 3, fill: live ? HW.color("brand") : "#9aa8b3", opacity: live ? .45 : .35 }, svg);
        svgEl("line", { x1: xc(k) - bw * 0.35, x2: xc(k) + bw * 0.35, y1: y(f[0]), y2: y(f[0]), stroke: live ? HW.color("brand") : "#7b8b98", "stroke-width": 2 }, svg);
      }
      if (r.pm25 != null) {
        svgEl("circle", { cx: xc(k), cy: y(r.pm25), r: 3.6, fill: HW.color(HW.band(r.psi_peak || HW.psi(r.pm25)).key), stroke: "#fff", "stroke-width": 1 }, svg);
        if (f) { cnt++; if (r.pm25 >= f[1] && r.pm25 <= f[2]) inside++; }
      }
      const hit = svgEl("rect", { x: L0 + k * bw, y: T0, width: bw, height: H - T0 - B0, fill: "transparent" }, svg);
      hit.addEventListener("mousemove", (ev) => HW.tip(`<b>${HW.dateLong(r.date)}</b><br>Measured: ${r.pm25 == null ? "–" : fmt(r.pm25) + " µg/m³, highest PSI " + (r.psi_peak ?? "–")}<br>${f ? (live ? "Forecast" : "Test run (hindcast)") + `: ${fmt(f[0])} (${fmt(f[1])}–${fmt(f[2])}), PSI ${f[3]}, chance >100: ${Math.round(f[4] * 100)}%` : "no forecast"}`, ev));
      hit.addEventListener("mouseleave", () => HW.tip(null));
      if (k % 7 === n % 7) svgEl("text", { x: xc(k), y: H - B0 + 16, "text-anchor": "middle" }, g).textContent = HW.dateShort(r.date);
    });
    const hc = rows.some((r) => !r.fc1 && r.hc1);
    $("track-score").innerHTML = `<p class="small">${cnt ? `The measured value was inside the forecast range on <b>${inside} of ${cnt}</b> days shown.` : ""} ${hc ? "Grey bars are test runs (hindcasts): the same method run later with only the data that was known at the time. Blue bars are real forecasts made by this site." : ""} <a href="about.html#skill">More about the forecast quality</a></p>`;
  })();

  initMap();
  showHero(focus); updateShare();
  document.addEventListener("themechange", () => location.reload());

  // ---------- live NEA readings ----------
  async function live() {
    const pmBandName = (v) => pmBand(v);
    try {
      const [p, q] = await Promise.all([fetch("https://api-open.data.gov.sg/v2/real-time/api/psi").then((r) => r.json()), fetch("https://api-open.data.gov.sg/v2/real-time/api/pm25").then((r) => r.json())]);
      const ip = p.data.items[0], iq = q.data.items[0];
      render(ip.timestamp, ip.readings.psi_twenty_four_hourly, iq.readings.pm25_one_hourly);
    } catch (e) {
      render(F.now.time + ":00+08:00", F.now.psi, F.now.pm25, true);
    }
    function render(ts, psi, pm, old) {
      const t = new Date(ts), hh = new Date(t.getTime() + 8 * 3600e3);
      $("now-time").textContent = `${old ? "(last known) " : ""}${HW.dateLong(hh.toISOString().slice(0, 10))}, ${HW.hourLabel(hh.getUTCHours())}`;
      const regs = ["north", "south", "east", "west", "central"];
      $("now-psi").innerHTML = `<span class="now-lab">24-h PSI</span>` + regs.filter((r) => psi[r] != null).map((r) => { const b = HW.band(psi[r]); return `<div class="reg" title="${b.name}"><b class="t-${b.key}">${Math.round(psi[r])}</b><span>${r}</span></div>`; }).join("");
      $("now-pm").innerHTML = `<span class="now-lab">1-h PM2.5 (µg/m³)</span>` + regs.filter((r) => pm[r] != null).map((r) => { const b = pmBandName(pm[r]); return `<div class="reg" title="${b[2]}"><b class="t-${b[1]}">${Math.round(pm[r])}</b><span>${r}<em> · ${b[2]}</em></span></div>`; }).join("");
    }
  }
  live();
  HW.installBar();
  HW.autoRefresh();
})();
