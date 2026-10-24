"""Score the hindcast against the NEA readings (day-mean PM2.5 and the highest island 24-h PSI of each day).

usage: HAZE_STATE=/dir python -m pipeline.evaluate [--from YYYY-MM-DD] [--write]
  --write: save site/data/static/skill.json (numbers for the web pages). The test forecasts reach the track-record
           chart through the archive (seed STATE/forecast_archive.csv with STATE/hindcast_archive.csv). The spread in
           pipeline/static/lead_errors.json is set by hand from the printed table (see the note in that file).
"""
import sys, json
import numpy as np
import pandas as pd
from . import obs
from .config import STATE, ROOT
from .run import day_obs, LEADS

OUT = ROOT / "site" / "data" / "static"


def load():
    H = pd.read_csv(STATE / "hindcast_days.csv", parse_dates=["date", "base"])
    d = day_obs(obs.island(obs.load()))
    H = H.merge(d.rename(columns={"pm25": "obs", "psi_peak": "obs_psi"}), left_on="date", right_index=True, how="left")
    H["base_psi"] = H.base.map(d.psi_peak)                  # PSI of the base day: was the haze already there?
    return H[H.obs.notna() & H.obs_psi.notna()].copy()


def contingency(event, flag):
    hit = int((event & flag).sum()); miss = int((event & ~flag).sum()); fa = int((~event & flag).sum()); clear = int((~event).sum())
    return dict(events=int(event.sum()), hits=hit, misses=miss, false_alarms=fa, clear_days=clear,
                pod=round(hit / max(hit + miss, 1), 3), far_clear=round(fa / max(clear, 1), 3))


def score(H, p_watch):
    rows = []
    for L, g in H.groupby("lead"):
        e = np.log(g.pm25 / g.obs)
        ev = g.obs_psi > 100
        r = dict(lead=int(L), n=len(g), bias=round(float(e.mean()), 3), sd=round(float(e.std()), 3), rmse=round(float(np.sqrt((e ** 2).mean())), 3),
                 mae_pm25=round(float((g.pm25 - g.obs).abs().mean()), 1), mae_psi=round(float((g.psi - g.obs_psi).abs().mean()), 1),
                 in_range=round(float(((g.obs >= g.pm25_lo) & (g.obs <= g.pm25_hi)).mean()), 3),
                 psi_in_range=round(float(((g.obs_psi >= g.psi_lo) & (g.obs_psi <= g.psi_hi)).mean()), 3),
                 free_bias=round(float(np.log(g.free / g.obs).mean()), 3))
        for name, flag in [("warn", g.p_psi100 >= 0.5), ("warn_or_watch", g.p_psi100 >= p_watch), ("psi_gt_92", g.psi > 92)]:
            r[name] = contingency(ev, flag)
        rows.append(r)
    return rows


def main(argv):
    H = load()
    if "--from" in argv:                                    # first base day to score (e.g. after the 28-day bias warm-up)
        H = H[H.base >= pd.Timestamp(argv[argv.index("--from") + 1])]
    p_watch = LEADS["p_watch"]
    rows = score(H, p_watch)
    print(f"{len(H)} rows, base days {H.base.min().date()} .. {H.base.max().date()}, p_watch {p_watch}")
    print("lead  n   bias    sd   rmse  MAE_pm  MAE_psi  in80%  psi_in80%  free_bias | warn hit/ev FA/clear | warn+watch | psi>92")
    for r in rows:
        w, ww, p92 = r["warn"], r["warn_or_watch"], r["psi_gt_92"]
        print(f"{r['lead']:>3} {r['n']:>3} {r['bias']:>6} {r['sd']:>5} {r['rmse']:>5} {r['mae_pm25']:>7} {r['mae_psi']:>8} {r['in_range']:>6} {r['psi_in_range']:>9} {r['free_bias']:>10} |"
              f" {w['hits']}/{w['events']} {w['false_alarms']}/{w['clear_days']} | {ww['hits']}/{ww['events']} {ww['false_alarms']}/{ww['clear_days']} | {p92['hits']}/{p92['events']} {p92['false_alarms']}/{p92['clear_days']}")
    # the watch line that catches 90% of the PSI > 100 days at lead 1, and its false alarms
    g = H[H.lead == 1]; ev = g.obs_psi > 100
    for p in [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]:
        c = contingency(ev, g.p_psi100 >= p)
        print(f"  lead 1, flag when P(PSI>100) >= {p:.2f}: caught {c['hits']}/{c['events']} ({c['pod']:.0%}), false alarms {c['false_alarms']}/{c['clear_days']} clear days ({c['far_clear']:.0%})")
    if "--write" in argv:
        l1 = rows[0]
        fa = g[(g.p_psi100 >= p_watch) & ~ev].obs_psi                  # how high the PSI was on the false-flag days
        on = g[ev & (g.base_psi <= 100)]                               # haze that came after a clear day (the hard case)
        skill = dict(first=H.date.min().strftime("%Y-%m-%d"), last=H.date.max().strftime("%Y-%m-%d"), p_watch=p_watch, leads=rows,
                     lead1=dict(in_range_pct=round(100 * l1["in_range"]), mae_pm25=l1["mae_pm25"], mae_psi=l1["mae_psi"],
                                caught=l1["warn_or_watch"]["hits"], events=l1["warn_or_watch"]["events"],
                                false_alarms=l1["warn_or_watch"]["false_alarms"], clear_days=l1["warn_or_watch"]["clear_days"],
                                warn_caught=l1["warn"]["hits"], warn_false=l1["warn"]["false_alarms"],
                                false_psi=[round(float(fa.min())), round(float(fa.max()))] if len(fa) else None,
                                onsets=dict(events=int(on.shape[0]), warn=int((on.p_psi100 >= 0.5).sum()), flag=int((on.p_psi100 >= p_watch).sum()))))
        L1 = skill["lead1"]
        skill["text"] = (f"For the next day, the PM2.5 was inside the forecast range on {L1['in_range_pct']}% of the days. "
                         f"The forecast flagged {L1['caught']} of the {L1['events']} days with PSI above 100 "
                         f"(warning or watch), with {L1['false_alarms']} false flags on {L1['clear_days']} clear days"
                         + (f" (on these days the PSI was {L1['false_psi'][0]} to {L1['false_psi'][1]})." if L1["false_psi"] else "."))
        json.dump(skill, open(OUT / "skill.json", "w"), indent=1)
        print("wrote", OUT / "skill.json")


if __name__ == "__main__":
    main(sys.argv[1:])
