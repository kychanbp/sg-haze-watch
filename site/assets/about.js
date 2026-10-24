/* SG Haze Watch: about page. Fills the forecast-quality table from data/static/skill.json. */
(async function () {
  const $ = (id) => document.getElementById(id);
  let S;
  try { S = await HW.getJSON("data/static/skill.json"); } catch (e) { $("skill-table").innerHTML = "<tr><td>The test results are not available now.</td></tr>"; return; }
  $("pwatch").textContent = Math.round(S.p_watch * 100) + "%";
  $("skill-intro").insertAdjacentHTML("beforeend", ` Test period: ${HW.dateLong(S.first)} to ${HW.dateLong(S.last)} ${S.first.slice(0, 4)}.`);
  const pct = (x) => Math.round(x * 100) + "%", sign = (x) => (x > 0 ? "+" : "−") + Math.abs(Math.round((Math.exp(x) - 1) * 100)) + "%";
  const of = (c) => `${c.hits} of ${c.events}`, fl = (c) => `${c.false_alarms} of ${c.clear_days}`;
  $("skill-table").innerHTML = `<tr><th rowspan="2">Days ahead</th><th rowspan="2">Error</th><th rowspan="2">Typical miss (PM2.5)</th><th rowspan="2">In range</th><th colspan="2">⚠️ Warning</th><th colspan="2">⚠️ or 👀 Watch</th></tr>` +
    `<tr><th>caught</th><th>false</th><th>caught</th><th>false</th></tr>` +
    S.leads.map((r) => `<tr><td><b>${r.lead === 1 ? "next day" : r.lead + " days"}</b></td><td>${sign(r.bias)}</td><td>${r.mae_pm25} µg/m³</td><td>${pct(r.in_range)}</td>` +
      `<td>${of(r.warn)}</td><td>${fl(r.warn)}</td><td>${of(r.warn_or_watch)}</td><td>${fl(r.warn_or_watch)}</td></tr>`).join("");
  const L = S.lead1;
  if (L) {
    $("flag-test").hidden = false;
    $("flag-test").textContent = `In the 2026 test (next day), warnings caught ${L.warn_caught} of the ${L.events} days with PSI above 100, with ${L.warn_false === 0 ? "no false warnings" : L.warn_false + " false warnings"}. ` +
      `Warnings and watches together caught ${L.caught} of ${L.events}. A warning or a watch came on ${L.false_alarms} of ${L.clear_days} clear days` +
      (L.false_psi ? `, and on these days the PSI was ${L.false_psi[0]} to ${L.false_psi[1]}.` : ".");
    if (L.onsets && L.onsets.events)
      $("onset").textContent = `When the haze arrives after a clear day, the warning often comes late. In the 2026 test, the warning caught ${L.onsets.warn} of ${L.onsets.events} such days, and the watch caught ${L.onsets.flag - L.onsets.warn} more.`;
  }
})();
