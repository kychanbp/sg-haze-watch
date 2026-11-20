/* SG Haze Watch: the box of air over Singapore seen from the side, with its lid (the temperature inversion),
   and the temperature at each height. Used on the map page and on the "How it works" page. */
const HWBox = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, a, p) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
  const txt = (s, a, p) => { const e = el("text", a, p); e.textContent = s; return e; };
  const ZMAX = 1500, Y0 = 380, Y1 = 22;                         // height axis: 0 m at Y0, ZMAX at Y1
  const py = (z) => Y0 - Math.min(z, ZMAX) * (Y0 - Y1) / ZMAX;

  // Typical air temperature near the ground in Singapore (deg C): lowest at 6 am, highest at 2 pm.
  function tSurf(h) { const x = h < 6 ? h + 24 : h; return x <= 14 ? 25.3 + 3 * (1 - Math.cos(Math.PI * (x - 6) / 8)) : 25.3 + 3 * (1 + Math.cos(Math.PI * (x - 14) / 16)); }
  // A sketch of the temperature at height z (m) when the lid is at h (m).
  // Day: the air cools by 9.8 deg C per km up to the lid, then gets warmer for a short distance (the lid), then cools again.
  // Night: the ground is cool, so the air gets warmer with height up to the lid (an inversion that starts at the ground).
  function temp(z, h, hour) {
    const ts = tSurf(hour);
    let day;
    if (z <= h) day = ts - 9.8e-3 * z;
    else if (z <= h + 80) day = ts - 9.8e-3 * h + 1.4 * (z - h) / 80;
    else day = ts - 9.8e-3 * h + 1.4 - 6.3e-3 * (z - h - 80);
    const night = z <= h ? ts + 2.2 * z / h : ts + 2.2 - 6.5e-3 * (z - h);
    const w = Math.min(1, Math.max(0, (h - 250) / 250));
    return w * day + (1 - w) * night;
  }
  const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const sky = (hr) => hr >= 7 && hr <= 17 ? ["#9fd3f2", "#e3f3fc", "day"] : hr === 6 || hr === 18 ? ["#f2b27a", "#fde3c4", "dusk"] : ["#101c36", "#2c3f66", "night"];

  function draw(svgs, s) {
    const [svg, svgT] = svgs;
    svg.innerHTML = ""; svgT.innerHTML = "";
    const w0 = svg.getBoundingClientRect().width, w1 = svgT.getBoundingClientRect().width;
    const fs = w0 && w0 < 460 ? 1.45 : 1, fsT = w1 && w1 < 200 ? 1.4 : 1;   // bigger labels on small screens
    const [c1, c2, part] = sky(s.hour), night = part === "night", ink = night ? "#e8eef3" : "#1d2a33";
    const g3 = el("linearGradient", { id: "hwb-lid2", x1: 0, x2: 0, y1: 0, y2: 1 }, el("defs", {}, svgT));
    el("stop", { offset: "0", "stop-color": "#f59e42", "stop-opacity": .15 }, g3); el("stop", { offset: ".5", "stop-color": "#f08a24", "stop-opacity": .75 }, g3); el("stop", { offset: "1", "stop-color": "#f59e42", "stop-opacity": .15 }, g3);
    const defs = el("defs", {}, svg);
    const g1 = el("linearGradient", { id: "hwb-sky", x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": c1 }, g1); el("stop", { offset: "1", "stop-color": c2 }, g1);
    const g2 = el("linearGradient", { id: "hwb-lid", x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "#f59e42", "stop-opacity": .15 }, g2); el("stop", { offset: ".5", "stop-color": "#f08a24", "stop-opacity": .75 }, g2); el("stop", { offset: "1", "stop-color": "#f59e42", "stop-opacity": .15 }, g2);
    const mk = el("marker", { id: "hwb-arr", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0 0 L10 5 L0 10 z", fill: night ? "#e8eef3" : "#c25f0f" }, mk);
    const mkw = el("marker", { id: "hwb-arrw", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" }, defs);
    el("path", { d: "M0 0 L10 5 L0 10 z", fill: ink }, mkw);

    // ---- side view (x 10..600) ----
    el("rect", { x: 10, y: Y1 - 12, width: 590, height: Y0 - Y1 + 12, rx: 12, fill: "url(#hwb-sky)" }, svg);
    if (night) for (let i = 0; i < 26; i++) el("circle", { cx: 20 + rnd(i) * 570, cy: Y1 + rnd(i + 40) * 120, r: rnd(i + 80) * 1.4 + .4, fill: "#fff", opacity: .7 }, svg);
    if (part === "night") el("path", { d: "M560 40 a16 16 0 1 0 12 28 a12 12 0 1 1 -12 -28z", fill: "#f4f1c9" }, svg);
    else el("circle", { cx: 560, cy: part === "dusk" ? 62 : 46, r: 16, fill: part === "dusk" ? "#ff9b54" : "#ffd34d" }, svg);
    // height grid
    for (const z of [0, 500, 1000, 1500]) {
      el("line", { x1: 10, x2: 600, y1: py(z), y2: py(z), stroke: ink, "stroke-opacity": .12 }, svg);
      txt(`${z} m`, { x: 16, y: py(z) - 4, fill: ink, "font-size": 11 * fs, opacity: .7 }, svg);
    }
    // ground: sea, Singapore, sea
    el("rect", { x: 10, y: Y0, width: 590, height: 40, fill: "#3f8fc4", rx: 0 }, svg);
    el("path", { d: `M150 ${Y0} q10 -6 30 -6 h240 q20 0 30 6 v40 h-300 z`, fill: night ? "#3d5a3d" : "#6ba86b" }, svg);
    [[180, 34], [204, 52], [228, 40], [262, 62], [292, 46], [330, 70], [358, 50], [392, 38], [420, 28]].forEach(([x, bh], k) =>
      el("rect", { x, y: Y0 - 6 - bh, width: 18, height: bh, fill: night ? "#43546a" : "#8f9eab", stroke: night ? "#5d708a" : "#6f7f8c", "stroke-width": .8 }, svg));
    if (night) [[183, 24], [207, 40], [265, 50], [333, 58], [361, 38], [396, 26]].forEach(([x, y]) => el("rect", { x: x + 4, y: Y0 - y, width: 4, height: 4, fill: "#ffd76a" }, svg));
    el("path", { d: `M520 ${Y0 + 6} h50 l-8 10 h-36 z M534 ${Y0 - 4} h14 v10 h-14 z`, fill: night ? "#9aa8b3" : "#2f3d4a" }, svg);
    el("circle", { cx: 542, cy: Y0 - 14, r: 5, fill: "#9aa3aa", opacity: .6 }, svg); el("circle", { cx: 548, cy: Y0 - 24, r: 7, fill: "#9aa3aa", opacity: .45 }, svg);
    txt("sea", { x: 40, y: Y0 + 26, fill: "#e8f3fa", "font-size": 12 * fs }, svg);
    txt("Singapore", { x: 268, y: Y0 + 26, fill: "#fff", "font-size": 13 * fs, "font-weight": 800 }, svg);
    txt("ships", { x: 470, y: Y0 + 26, fill: "#e8f3fa", "font-size": 12 * fs }, svg);
    txt("← the box is about 56 km long →", { x: 305, y: Y0 + 54, "text-anchor": "middle", fill: "currentColor", "font-size": 12.5 * fs, opacity: .8 }, svg);

    const h = Math.max(30, s.blh), yl = py(h);
    // the box
    const bc = HWBox.bandColor(s.pm);
    el("rect", { x: 70, y: yl, width: 470, height: Y0 - yl, fill: bc, opacity: night ? .38 : .22 }, svg);
    el("rect", { x: 70, y: yl, width: 470, height: Y0 - yl, fill: "none", stroke: bc, "stroke-width": 2, "stroke-dasharray": "6 5" }, svg);
    // particles: the number of dots in each square of the picture follows the PM2.5 (a concentration)
    const area = 470 * (Y0 - yl - 4), n = Math.min(1100, Math.round(s.pm * area * 6e-5));
    for (let i = 0; i < n; i++) el("circle", { cx: 74 + rnd(i) * 462, cy: yl + 3 + rnd(i + 999) * (Y0 - yl - 6), r: 1.6, fill: night ? "#e9dcc8" : "#5b4a3a", opacity: .75 }, svg);
    // the lid
    el("rect", { x: 10, y: yl - 9, width: 590, height: 18, fill: "url(#hwb-lid)" }, svg);
    el("line", { x1: 10, x2: 600, y1: yl, y2: yl, stroke: "#e2741b", "stroke-width": 2.5, "stroke-dasharray": "9 6" }, svg);
    // warm air rising (day) or still, cool air (night)
    if (h > 380) {
      [120, 230, 350, 460].forEach((x, k) => {
        const top = yl + 14, mid = (Y0 + top) / 2, sw = k % 2 ? 14 : -14;
        el("path", { d: `M${x} ${Y0 - 14} C ${x + sw} ${mid + 30}, ${x - sw} ${mid - 30}, ${x} ${top}`, fill: "none", stroke: "#c25f0f", "stroke-width": 2.4, opacity: .8, "marker-end": "url(#hwb-arr)" }, svg);
      });
      txt("warm air rises and mixes the box", { x: 128, y: Math.min(Y0 - 30, (Y0 + yl) / 2 + 4), fill: ink, "font-size": 12.5 * fs, "font-weight": 700 }, svg);
    } else {
      [140, 300, 440].forEach((x) => el("path", { d: `M${x} ${Y0 - 12} h40`, stroke: ink, "stroke-width": 2, opacity: .7, "marker-end": "url(#hwb-arrw)" }, svg));
      txt("cool air stays near the ground", { x: 130, y: Math.max(yl - 34, Y1 + 40), fill: ink, "font-size": 12.5 * fs, "font-weight": 700 }, svg);
    }
    // wind
    const wy = Math.max(yl + 16, Y0 - 50), wl = Math.min(130, 24 + s.wind * 26);
    el("path", { d: `M20 ${wy} h${wl}`, stroke: ink, "stroke-width": 3.2, "marker-end": "url(#hwb-arrw)" }, svg);
    txt(`wind ${s.wind.toFixed(1)} m/s`, { x: 20, y: wy - 8, fill: ink, "font-size": 12 * fs, "font-weight": 700 }, svg);
    // rain
    if (s.rain > 0.1) for (let i = 0; i < 26; i++) { const x = 30 + rnd(i + 7) * 560, y = Y1 + 8 + rnd(i + 70) * 150; el("line", { x1: x, x2: x - 4, y1: y, y2: y + 13, stroke: "#3d9ad6", "stroke-width": 2 }, svg); }
    const lidLab = `lid: warm layer (inversion) at ${Math.round(h)} m`;
    const ly = yl - 14 < Y1 + 10 ? yl + 22 : yl - 14;
    el("rect", { x: 300 - (fs - 1) * 260, y: ly - 13 * fs, width: 6.9 * fs * lidLab.length + 12, height: 19 * fs, rx: 6, fill: night ? "#2c3f66" : "#fff", opacity: .85 }, svg);
    txt(lidLab, { x: 306 - (fs - 1) * 260, y: ly, fill: ink, "font-size": 13.5 * fs, "font-weight": 700 }, svg);

    // ---- temperature at each height (x 640..890) ----
    const X0 = 650, X1 = 885, T0 = 16, T1 = 34, px = (t) => X0 + (t - T0) * (X1 - X0) / (T1 - T0);
    el("rect", { x: 630, y: Y1 - 12, width: 265, height: Y0 - Y1 + 12, rx: 12, fill: "currentColor", opacity: .04 }, svgT);
    for (const t of [20, 25, 30]) { el("line", { x1: px(t), x2: px(t), y1: Y1, y2: Y0, stroke: "currentColor", "stroke-opacity": .12 }, svgT); txt(`${t}°`, { x: px(t), y: Y0 + 16, "text-anchor": "middle", fill: "currentColor", "font-size": 11 * fsT, opacity: .75 }, svgT); }
    for (const z of [0, 500, 1000, 1500]) el("line", { x1: X0, x2: X1, y1: py(z), y2: py(z), stroke: "currentColor", "stroke-opacity": .08 }, svgT);
    el("rect", { x: X0, y: yl - 9, width: X1 - X0, height: 18, fill: "url(#hwb-lid2)" }, svgT);
    let d = ""; for (let z = 0; z <= ZMAX; z += 10) d += (z ? "L" : "M") + px(temp(z, h, s.hour)).toFixed(1) + " " + py(z).toFixed(1);
    el("path", { d, fill: "none", stroke: "#d23a3a", "stroke-width": 3, "stroke-linejoin": "round" }, svgT);
    el("circle", { cx: px(temp(0, h, s.hour)), cy: Y0, r: 4, fill: "#d23a3a" }, svgT);
    txt("Air temperature (°C)", { x: (X0 + X1) / 2, y: Y0 + 32, "text-anchor": "middle", fill: "currentColor", "font-size": 12 * fsT, "font-weight": 700 }, svgT);
    txt(`ground ${tSurf(s.hour).toFixed(0)}°C`, { x: X1, y: Y0 - 8, "text-anchor": "end", fill: "currentColor", "font-size": 11 * fsT, opacity: .8 }, svgT);
    const up = h <= 380;
    const ty = up ? Math.max(Y1 + 30, yl - 46) : Math.min(Y0 - 40, (yl + Y0) / 2);
    txt(up ? "warmer as you go up:" : "cooler as you go up,", { x: X0 + 4, y: ty, fill: "currentColor", "font-size": 11.5 * fsT, "font-weight": 700 }, svgT);
    txt(up ? "an inversion (the lid)" : "so warm air can rise", { x: X0 + 4, y: ty + 14, fill: "currentColor", "font-size": 11.5 * fsT }, svgT);
    if (!up) { txt("warmer again:", { x: X0 + 4, y: yl - 26, fill: "currentColor", "font-size": 11.5 * fsT, "font-weight": 700 }, svgT); txt("the lid", { x: X0 + 4, y: yl - 13, fill: "currentColor", "font-size": 11.5 * fsT }, svgT); }
  }

  // NEA 1-hour PM2.5 bands (colours of the site)
  function bandColor(pm) { const k = pm <= 55 ? "good" : pm <= 150 ? "unhealthy" : pm <= 250 ? "very-unhealthy" : "hazardous"; return HW.color(k); }
  function bandName(pm) { return pm <= 55 ? "Normal" : pm <= 150 ? "Elevated" : pm <= 250 ? "High" : "Very high"; }

  function story(s) {
    const hr = HW.hourLabel(s.hour);
    if (s.blh <= 380) return `<b>${hr}:</b> the ground is cool, so the air near the ground is cooler than the air above it. This is a <b>temperature inversion</b>. Cool air is heavy and cannot go up through the warm layer. The lid is low (${Math.round(s.blh)} m), so the pollution stays in a thin box.`;
    if (s.blh >= 600) return `<b>${hr}:</b> the sun heats the ground. Warm air near the ground goes up and mixes the air up to the lid (${Math.round(s.blh)} m). The box is tall, so the same pollution has more air to spread into.`;
    return `<b>${hr}:</b> the lid is moving (${Math.round(s.blh)} m). In the morning the sun breaks the night inversion and the lid goes up. In the evening the ground cools and a new inversion forms near the ground.`;
  }

  /** mount(container, get(hour) -> {blh, pm, wind, rain}, opt) -> {set(hour), redraw()} */
  function mount(box, get, opt = {}) {
    box.innerHTML = `<div class="sv-grid"><svg class="sideview sv-side" viewBox="0 0 610 445" role="img" aria-label="The box of air over Singapore seen from the side"></svg>
      <svg class="sideview sv-temp" viewBox="625 0 275 445" role="img" aria-label="Air temperature at each height"></svg></div>
      <div class="sv-ctl"><button type="button" class="btn primary sv-play">▶ Play the day</button>
      <input type="range" min="0" max="23" step="1" value="${opt.hour ?? 3}" aria-label="Hour of the day" class="sv-hour">
      <b class="sv-time"></b></div>
      <div class="sv-read"></div><p class="sv-story small"></p>`;
    const svgs = [box.querySelector(".sv-side"), box.querySelector(".sv-temp")], sl = box.querySelector(".sv-hour"), play = box.querySelector(".sv-play");
    let timer = null;
    function redraw() {
      const hour = +sl.value, s = Object.assign({ hour }, get(hour));
      draw(svgs, s);
      box.querySelector(".sv-time").textContent = HW.hourLabel(hour);
      box.querySelector(".sv-read").innerHTML = `<span>Lid: <b>${Math.round(s.blh)} m</b></span><span>PM2.5: <b style="color:${bandColor(s.pm)}">${s.pm.toFixed(0)} µg/m³</b> (${bandName(s.pm)})</span><span>Wind: <b>${s.wind.toFixed(1)} m/s</b></span>${s.rain > 0.1 ? `<span>Rain: <b>${s.rain.toFixed(1)} mm</b></span>` : ""}`;
      box.querySelector(".sv-story").innerHTML = story(s) + (opt.note ? " " + opt.note : "");
    }
    sl.addEventListener("input", () => { stop(); redraw(); });
    function stop() { if (timer) { clearInterval(timer); timer = null; play.textContent = "▶ Play the day"; } }
    play.addEventListener("click", () => {
      if (timer) return stop();
      play.textContent = "⏸ Pause";
      timer = setInterval(() => { sl.value = (+sl.value + 1) % 24; redraw(); }, 650);
    });
    redraw();
    return { redraw, set: (h) => { sl.value = h; redraw(); } };
  }

  return { mount, draw, temp, tSurf, bandColor, bandName };
})();
