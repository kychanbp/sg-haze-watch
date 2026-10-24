/* SG Haze Watch: "How it works" page. The box lab runs the same hourly box equation as the forecast (pipeline/model.py). */
(async function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (x, d = 0) => (x == null || Number.isNaN(x) ? "–" : Number(x).toFixed(d));
  $("puff").innerHTML = HW.mascot("good", { label: "Puff, a small cloud of air" });
  const SECTIONS = [["pm25", "PM2.5"], ["sources", "Sources"], ["box", "The box"], ["lid", "The lid"], ["wind", "Wind"], ["equation", "Equation"], ["lab", "Box lab"], ["smoke", "Smoke"], ["forecast", "Forecast"], ["test", "Fair test"], ["quiz", "Quiz"]];
  $("toc").innerHTML = SECTIONS.map(([id, n]) => `<a class="chip" href="#${id}" style="text-decoration:none">${n}</a>`).join("");

  // data: constants of the live model, the month-hour lid heights, the 2026 test (optional)
  const [F, B, S] = await Promise.all([HW.getJSON("data/forecast.json").catch(() => null), HW.getJSON("data/static/blh_clim.json"), HW.getJSON("data/static/skill.json").catch(() => null)]);
  const K = (F && F.constants) || { logQ: 5.2468, logInvL: -10.9298, logB0: 2.1166, loga: -4.8608, eps: 0.1729, logtau: 5.4806, logb: -8.2066, logtauR: 1.0714, loglam: -2.8218, gl: -0.1557, kdry: 0.372, a_ship: 0.7342 };
  const Q = Math.exp(K.logQ), L = Math.exp(-K.logInvL), B0 = Math.exp(K.logB0), LAM = Math.exp(K.loglam), EPS = K.eps, WD = 0.002, DIUR = 0.4;
  const month = new Date(Date.now() + 8 * 3600e3).getUTCMonth();
  const BLH = B.blh[month];
  const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month];

  // ---------- wind: residence time ----------
  function wind() {
    const u = +$("w-u").value, t = L / u / 3600;
    $("w-uo").textContent = u.toFixed(1) + " m/s";
    $("w-text").innerHTML = `Residence time = ${Math.round(L).toLocaleString()} m ÷ ${u.toFixed(1)} m/s = ${Math.round(L / u).toLocaleString()} s ≈ <b>${t.toFixed(1)} hours</b>. Each hour, about <b>${Math.round(100 * (1 - Math.exp(-1 / t)))}%</b> of the air in the box is new air.`;
  }
  $("w-u").addEventListener("input", wind); wind();

  // ---------- the box lab ----------
  function simulate(p) {
    const cin = B0 + 1.0 + p.smoke;                        // background + about 1 ug/m3 of ship exhaust (after 2020) + smoke
    const run = (eFac) => {
      let c = cin, hp = null; const out = [];
      for (let i = 0; i < 72; i++) {
        const hr = i % 24, h = Math.max(30, BLH[hr] * p.lid);
        const dayOn = hr >= 7 && hr <= 21 ? 1 : 0;
        const E = Q * eFac * (1 - DIUR + 2 * DIUR * dayOn * 12 / 15);
        if (hp != null && h > hp) c = c - (h - hp) / h * (c - cin);     // the lid goes up: cleaner air from above mixes in
        const k = p.u / L + WD / h + LAM * p.rain / 3600, src = E / h / 3600 + p.u / L * cin, ceq = src / k;
        c = ceq + (c - ceq) * Math.exp(-k * 3600);
        if (i >= 48) out.push(c);
        hp = h;
      }
      return out;
    };
    const C = run(p.e), C0 = run(0);
    return { C, C0, cin, h: BLH.map((x) => Math.max(30, x * p.lid)) };
  }
  const ids = ["u", "s", "r", "e", "h"];
  const read = () => ({ u: +$("l-u").value, smoke: +$("l-s").value, rain: +$("l-r").value, e: +$("l-e").value / 100, lid: +$("l-h").value });
  let sim = simulate(read()), P = read();
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (t, a, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
  function chart() {
    const svg = $("labchart"); svg.innerHTML = "";
    const W = 520, H = 280, L0 = 40, R0 = 48, T0 = 14, B0_ = 30;
    const ymax = Math.max(30, ...sim.C) * 1.15, hmax = 2000;
    const x = (h) => L0 + h * (W - L0 - R0) / 23, y = (v) => H - B0_ - v / ymax * (H - T0 - B0_), y2 = (v) => H - B0_ - v / hmax * (H - T0 - B0_);
    const g = svgEl("g", { class: "axis" }, svg);
    const step = ymax > 150 ? 50 : ymax > 60 ? 20 : 10;
    for (let v = 0; v <= ymax; v += step) { svgEl("line", { x1: L0, x2: W - R0, y1: y(v), y2: y(v), stroke: "currentColor", "stroke-opacity": .12 }, g); svgEl("text", { x: L0 - 6, y: y(v) + 4, "text-anchor": "end" }, g).textContent = v; }
    for (let v = 0; v <= hmax; v += 500) svgEl("text", { x: W - R0 + 6, y: y2(v) + 4 }, g).textContent = v + " m";
    for (let h = 0; h < 24; h += 3) svgEl("text", { x: x(h), y: H - B0_ + 16, "text-anchor": "middle" }, g).textContent = HW.hourLabel(h);
    svgEl("text", { x: 2, y: T0 + 2 }, g).textContent = "µg/m³";
    const area = (top, bot) => "M" + sim.C.map((_, h) => x(h) + " " + y(top[h])).join(" L") + " L" + sim.C.map((_, h) => x(23 - h) + " " + y(bot[23 - h])).join(" L") + " Z";
    const zero = sim.C.map(() => 0);
    svgEl("path", { d: area(sim.C0, zero), fill: HW.color("background"), opacity: .45 }, svg);
    svgEl("path", { d: area(sim.C, sim.C0), fill: HW.color("local"), opacity: .55 }, svg);
    svgEl("path", { d: "M" + sim.C.map((v, h) => x(h) + " " + y(v)).join(" L"), fill: "none", stroke: HW.color("ink"), "stroke-width": 2.5 }, svg);
    svgEl("line", { x1: L0, x2: W - R0, y1: y(sim.cin), y2: y(sim.cin), stroke: HW.color("ship"), "stroke-width": 1.5, "stroke-dasharray": "3 4" }, svg);
    svgEl("text", { x: L0 + 4, y: y(sim.cin) - 5, fill: HW.color("ship"), style: "font-weight:700" }, svg).textContent = `air that comes in: ${fmt(sim.cin)} µg/m³`;
    svgEl("path", { d: "M" + sim.h.map((v, h) => x(h) + " " + y2(Math.min(v, hmax))).join(" L"), fill: "none", stroke: "#e2741b", "stroke-width": 2.5, "stroke-dasharray": "7 5" }, svg);
    svgEl("text", { x: x(13), y: y2(Math.min(sim.h[13], hmax)) - 7, "text-anchor": "middle", fill: "#e2741b", style: "font-weight:700" }, svg).textContent = "lid height";
    const mean = sim.C.reduce((a, b) => a + b, 0) / 24, local = mean - sim.C0.reduce((a, b) => a + b, 0) / 24, psi = Math.round(HW.psi(mean)), b = HW.band(psi);
    const mx = Math.max(...sim.C), hmx = sim.C.indexOf(mx);
    $("labout").innerHTML = `<div><b>${fmt(mean)} µg/m³</b><span>PM2.5, mean of the day</span></div><div><b class="t-${b.key}">PSI ${psi}</b><span>${b.name} (if the whole day is like this)</span></div>` +
      `<div><b>${fmt(mx)} µg/m³</b><span>highest hour: ${HW.hourLabel(hmx)}</span></div><div><b>${Math.round(100 * local / mean)}%</b><span>from Singapore's own emissions</span></div>`;
  }
  function lab() {
    P = read(); sim = simulate(P);
    $("l-uo").textContent = P.u.toFixed(1) + " m/s"; $("l-so").textContent = P.smoke + " µg/m³"; $("l-ro").textContent = P.rain.toFixed(1) + " mm";
    $("l-eo").textContent = Math.round(P.e * 100) + "%"; $("l-ho").textContent = "× " + P.lid.toFixed(2);
    chart(); if (side) side.redraw();
  }
  ids.forEach((k) => $("l-" + k).addEventListener("input", lab));
  const PRESETS = [["☀️ Normal day", [2, 0, 0, 100, 1]], ["🍃 Calm day", [0.7, 0, 0, 100, 1]], ["🌧️ Rainy day", [2, 0, 2, 100, 1]], ["🔥 Haze day", [2.5, 80, 0, 100, 1]], ["🚫 No local emissions", [2, 0, 0, 0, 1]]];
  $("l-pre").innerHTML = PRESETS.map(([n], i) => `<button type="button" class="chip" data-i="${i}">${n}</button>`).join("");
  $("l-pre").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    PRESETS[+b.dataset.i][1].forEach((v, k) => { $("l-" + ids[k]).value = v; });
    $("l-pre").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b)); lab();
  }));

  // ---------- the lid, seen from the side (a typical day of this month, the lab inputs) ----------
  let side = null;
  side = HWBox.mount($("lidview"), (hour) => ({ blh: sim.h[hour], pm: sim.C[hour], wind: P.u, rain: P.rain }),
    { hour: 3, note: `<span class="muted">Lid heights: the average ${MON} day (ERA5, 2014–2025). PM2.5: the box lab below, with its inputs.</span>` });
  lab();

  // ---------- constants ----------
  const ROWS = [
    ["Local emissions", "PM2.5 from Singapore on each m² each hour (mean)", `${fmt(Q)} µg/m²/h`],
    ["Box length L", "the size of the box along the wind", `${fmt(L / 1000)} km`],
    ["Background", "PM2.5 in clean air that comes in", `${fmt(B0, 1)} µg/m³`],
    ["Weekend drop", "less traffic and work on Saturday and Sunday", `${fmt(EPS * 100)}%`],
    ["Smoke decay time τ", "smoke spreads out and mixes away", `${fmt(Math.exp(K.logtau))} hours`],
    ["Rain washout λ", "part of the particles that 1 mm of rain removes", `${fmt(LAM, 3)} per mm`],
    ["Peat dryness", "extra smoke for each 100 mm of water deficit", `+${fmt(K.kdry * 100)}%`],
    ["Ship factor", "how much ship exhaust becomes PM2.5", fmt(K.a_ship, 2)],
    ["Fresh smoke factor", "PM2.5 for each unit of fire power under the path", fmt(Math.exp(K.loga), 4)],
    ["Old smoke factor", "PM2.5 from the smoke that hangs over the whole region", fmt(Math.exp(K.logb) * 1e4, 2) + " × 10⁻⁴"],
    ["Old smoke memory", "how long the regional smoke stays", `${fmt(Math.exp(K.logtauR), 1)} days`],
    ["Land effect", "change of the background with land on the path", fmt(K.gl, 2)],
  ];
  $("consts").innerHTML = `<tr><th>Constant</th><th>Meaning</th><th>Value</th></tr>` + ROWS.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("");

  // ---------- the 2026 test ----------
  if (S && S.lead1) {
    const s = S.lead1;
    $("hc-kv").innerHTML = `<b>${s.in_range_pct}%</b><span>of the days in the 2026 test: the next-day PM2.5 was inside the forecast range</span>`;
    $("hc-text").innerHTML = `<p class="small" style="margin-top:10px"><b>2026 test (${HW.dateLong(S.first)} to ${HW.dateLong(S.last)}).</b> We made the forecast for each day of this haze season again, with only the data that was known at that time. ${S.text || ""} <a href="about.html#skill">All the numbers</a>.</p>`;
    if (s.onsets && s.onsets.events)
      $("onset").innerHTML = `<b>Sudden haze.</b> When the haze arrives after a clear day, the model often sees it late. In the 2026 test, the warning caught only ${s.onsets.warn} of ${s.onsets.events} such days (the watch caught ${s.onsets.flag - s.onsets.warn} more).`;
  }

  // ---------- quiz ----------
  const QZ = [
    ["The same emissions go into a box that is 4 times thinner. What happens to the PM2.5 from these emissions?", ["It goes down 4 times", "It stays the same", "It goes up 4 times"], 2, "Concentration = mass ÷ volume. The same mass in a quarter of the volume gives 4 times the concentration."],
    ["At night, the air near the ground is cooler than the air above it. What is the name of this?", ["Convection", "A temperature inversion", "Evaporation"], 1, "Normally the air gets cooler as you go up. In an inversion it gets warmer. The warm layer is a lid."],
    ["The box is 56 km long. The wind speed is 2 m/s. About how long does the wind need to change all the air in the box?", ["About 1 hour", "About 8 hours", "About 3 days"], 1, "56,000 m ÷ 2 m/s = 28,000 s, which is about 7.8 hours."],
    ["On a haze day, the air that comes in has 90 µg/m³ of PM2.5. What does a strong wind do?", ["It cleans our air", "It brings the smoke in faster", "Nothing"], 1, "The wind makes the box air more like the air that comes in. When that air is smoky, strong wind brings the smoke in faster."],
    ["Smoke travels for 4 days (96 hours) with no rain. The decay time τ is 240 hours. About how much smoke is left?", ["About 33%", "About 67%", "All of it"], 1, "e^(−96 ÷ 240) = e^(−0.4) = 0.67."],
    ["10 mm of rain falls on the path of the smoke. λ = 0.06 per mm. How much smoke is left?", ["About 6%", "About 55%", "About 94%"], 1, "e^(−0.06 × 10) = e^(−0.6) = 0.55. Rain removes 45% of the smoke."],
    ["Why are some years much more hazy than others?", ["Singapore has more cars in those years", "El Niño or the Indian Ocean Dipole makes the peat dry, so fires make more smoke", "The sun is hotter in those years"], 1, "Less rain makes the peat dry. Dry peat burns deeper and longer and makes more smoke."],
    ["Why does our model have only 12 constants?", ["Computers cannot use more", "Each constant has a physical meaning, and few constants stop overfitting", "To make the website faster"], 1, "A model with many constants can copy the past data and then fail on new data. That is overfitting."],
    ["Why do we test the model on a year that it did not see?", ["A test on the same data looks too good", "To use less data", "Because old data is wrong"], 0, "The model must forecast days that it did not use to find its constants. Only then is the test fair."],
    ["The forecast says: chance of PSI above 100 is 30%. What does this mean?", ["The PSI will be 30", "In about 3 of 10 days like this one, the PSI goes above 100", "30% of Singapore will have haze"], 1, "A chance tells you how often it happens on days with a forecast like this one."],
  ];
  let score = 0, done = 0;
  $("qs").innerHTML = QZ.map(([q, opts, , why], i) => `<div class="q" data-i="${i}"><p><b>${i + 1}. ${q}</b></p>${opts.map((o, k) => `<button type="button" data-k="${k}">${o}</button>`).join("")}<p class="why">${why}</p></div>`).join("");
  document.querySelectorAll(".quiz .q").forEach((qd) => qd.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    if (qd.classList.contains("done")) return;
    const i = +qd.dataset.i, ok = +b.dataset.k === QZ[i][2];
    qd.classList.add("done"); b.classList.add(ok ? "ok" : "no");
    if (!ok) qd.querySelectorAll("button")[QZ[i][2]].classList.add("ok");
    done++; if (ok) score++;
    $("qscore").textContent = `Score: ${score} of ${done}` + (done === QZ.length ? (score >= 8 ? " 🎉 Excellent! Puff is proud of you." : " Good try! Read the steps again and try once more.") : "");
  })));
  document.addEventListener("themechange", () => { chart(); side.redraw(); });
})();
