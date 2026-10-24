/* SG Haze Watch: pollution map page. Reads data/forecast.json, data/map.json, data/static/emissions.json. */
(async function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (x, d = 0) => (x == null || Number.isNaN(x) ? "–" : Number(x).toFixed(d));
  let F, M, E;
  try {
    [F, M, E] = await Promise.all([HW.getJSON("data/forecast.json"), HW.getJSON("data/map.json"), HW.getJSON("data/static/emissions.json")]);
  } catch (e) {
    $("bigmap").innerHTML = "<p style='padding:16px'>The map data is not available now. Please try again later.</p>";
    return;
  }
  const SG = [1.3521, 103.8198];
  let sel = 0;

  // ---------- map ----------
  const map = L.map("bigmap", { scrollWheelZoom: false, zoomSnap: 0.25, minZoom: 4, maxZoom: 11 }).setView([0.3, 106.5], 5.25);
  HW.basemap(map);
  const groups = {};

  // emissions (one at a time)
  const RAMPS = {
    all: "linear-gradient(90deg,#fcfdbf,#fc8961,#b73779,#51127c,#000004)", ships: "linear-gradient(90deg,#f7fbff,#6baed6,#08306b)",
    traffic: "linear-gradient(90deg,#fff5f0,#fb6a4a,#67000d)", power_industry: "linear-gradient(90deg,#fcfbfd,#9e9ac8,#3f007d)",
    homes_farms: "linear-gradient(90deg,#f7fcf5,#74c476,#00441b)",
  };
  let emisLayer = null;
  function setEmis(k) {
    if (emisLayer) { map.removeLayer(emisLayer); emisLayer = null; }
    $("ramp").style.background = RAMPS[k] || "var(--line)";
    $("ramp").parentElement.style.opacity = k === "none" ? .35 : 1;
    if (k === "none" || !E.layers[k]) return;
    emisLayer = L.imageOverlay("data/" + E.layers[k].file, E.bounds, { opacity: .85, className: "pix" }).addTo(map);
  }
  // peat
  groups.peat = L.imageOverlay("data/" + E.peat.file, E.peat.bounds, { opacity: .9, className: "pix" });
  // fires
  groups.fires = L.layerGroup();
  const fires = M.fires.slice().sort((a, b) => a[2] - b[2]);
  for (const [la, lo, frp, n] of fires) {
    L.circleMarker([la, lo], { radius: Math.min(2.5 + Math.sqrt(frp) / 2.6, 15), stroke: frp > 300, color: "#7a1d0c", weight: 1, fillColor: frp > 300 ? "#d23a3a" : "#ff8a1c", fillOpacity: .7 })
      .bindTooltip(`🔥 ${fmt(frp)} MW of fire power<br>${n} fire spot${n > 1 ? "s" : ""} in this 10 km square`).addTo(groups.fires);
  }
  $("fires-note").textContent = `${HW.dateLong(M.fires_day)}: ${M.fires.reduce((s, x) => s + x[3], 0).toLocaleString()} fire spots, ${fmt(M.fires.reduce((s, x) => s + x[2], 0) / 1000, 1)} GW in total. A bigger dot means more fire power.`;
  // our box: about 56 km long (L from the model fit)
  const half = 28 / 111.32;
  groups.box = L.layerGroup([
    L.rectangle([[SG[0] - half, SG[1] - half], [SG[0] + half, SG[1] + half]], { color: "#e2741b", weight: 2.5, dashArray: "7 6", fillColor: "#e2741b", fillOpacity: .08 })
      .bindTooltip("📦 Our box: about 56 km long. The model treats all the air in it as one well-mixed box, from the ground up to the lid."),
  ]);
  L.circleMarker(SG, { radius: 6, color: "#fff", weight: 2, fillColor: "#0f6fa8", fillOpacity: 1 }).bindTooltip("Singapore").addTo(map);
  // paths
  groups.path = L.layerGroup(); groups.path100 = L.layerGroup();
  function drawPaths() {
    groups.path.clearLayers(); groups.path100.clearLayers();
    const P = M.paths[sel] || {};
    const add = (pts, grp, color, dash) => {
      if (!pts || pts.length < 2) return;
      L.polyline(pts, { color, weight: 4, opacity: .9, dashArray: dash }).addTo(grp);
      [8, 16, 24, 32].forEach((k, n) => { if (pts[k]) L.circleMarker(pts[k], { radius: 5, color, weight: 2, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(`${n + 1} day${n ? "s" : ""} before`, { permanent: !dash && n < 3, direction: "right", className: "daylabel", offset: [6, 0] }).addTo(grp); });
    };
    add(P.p925, groups.path, "#0f6fa8", null);
    add(P.p100, groups.path100, "#14a3a3", "6 6");
  }
  function toggle(k, on) { if (!groups[k]) return; on ? groups[k].addTo(map) : map.removeLayer(groups[k]); }
  document.querySelectorAll("#layers input").forEach((inp) => {
    inp.addEventListener("change", () => {
      if (inp.type === "radio") { setEmis(inp.value); document.querySelectorAll("#layers input[type=radio]").forEach((r) => r.closest("label").classList.toggle("on", r.checked)); }
      else { toggle(inp.dataset.layer, inp.checked); inp.closest("label").classList.toggle("on", inp.checked); }
    });
  });
  setEmis("all"); ["fires", "path", "box"].forEach((k) => toggle(k, true));
  drawPaths();

  // ---------- day chips (shared by the map paths and the side view) ----------
  function chips(id) {
    $(id).innerHTML = F.days.map((d, i) => `<button type="button" class="chip${i === sel ? " on" : ""}" data-i="${i}">${HW.dayName(d.date)} ${HW.dateShort(d.date)}</button>`).join("");
    $(id).querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => { sel = +b.dataset.i; refresh(); }));
  }
  function refresh() {
    ["map-days", "sv-days"].forEach((id) => $(id).querySelectorAll(".chip").forEach((b, i) => b.classList.toggle("on", i === sel)));
    drawPaths(); side.redraw();
  }
  chips("map-days"); chips("sv-days");

  // ---------- side view of the box ----------
  const start = new Date(F.hourly.start.slice(0, 10) + "T00:00:00Z");
  const side = HWBox.mount($("sideview"), (hour) => {
    const d = F.days[sel], off = Math.round((new Date(d.date + "T00:00:00Z") - start) / 3600e3) + hour;
    const pick = (a, dflt) => (a && a[off] != null ? a[off] : dflt);
    return { blh: pick(F.hourly.blh, 500), pm: d.pm25_hourly[hour], wind: pick(F.hourly.wind, 2), rain: pick(F.hourly.rain, 0) };
  }, { hour: 3, note: "" });

  // ---------- sources this week ----------
  const tots = F.days.map((d) => d.pm25), mx = Math.max(...tots);
  $("stacks").innerHTML = F.days.map((d) =>
    `<div class="stack"><span>${HW.dayName(d.date)}<br><small>${HW.dateShort(d.date)}</small></span><div class="parts" style="width:${(d.pm25 / mx * 100).toFixed(1)}%">` +
    HW.PARTS.map((p) => `<i style="width:${(d.parts[p.key] * 100).toFixed(1)}%;background:var(--${p.key})" title="${p.name}: ${fmt(d.parts[p.key] * d.pm25)} µg/m³"></i>`).join("") +
    `</div><span class="tot">${fmt(d.pm25)}</span></div>`).join("");
  $("stack-legend").innerHTML = HW.PARTS.map((p) => `<span><i style="background:var(--${p.key})"></i>${p.emoji} ${p.name}</span>`).join("");

  // ---------- emissions table ----------
  const NAMES = { ships: "🚢 Ships", traffic: "🚗 Road traffic", power_industry: "🏭 Power and industry", homes_farms: "🏠 Homes and farms", all: "<b>All human emissions</b>" };
  const t = (x) => x >= 1e6 ? (x / 1e6).toFixed(2) + " million" : Math.round(x / 100) * 100 >= 1000 ? (Math.round(x / 100) * 100).toLocaleString() : Math.round(x).toLocaleString();
  $("emis-table").innerHTML = `<tr><th>Source</th><th>Whole map (t/year)</th><th>Near Singapore (t/year)</th></tr>` +
    ["ships", "traffic", "power_industry", "homes_farms", "all"].map((k) => `<tr><td>${NAMES[k]}</td><td>${t(E.layers[k].total_t_per_year_region)}</td><td>${t(E.layers[k].singapore_t_per_year)}</td></tr>`).join("");

  document.addEventListener("themechange", () => location.reload());
})();
