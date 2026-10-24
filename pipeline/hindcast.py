"""Hindcast: make the forecast as if it was made at 00:10 Singapore time after each base day, with only the data
known at that time (readings to 23:00, fires to that day, the IFS run of 00 UTC, CHIRPS rain to 4 days before).
It tests the whole daily job, including the guesses that a real forecast must make: future fires = mean of the last
3 days, IFS forecast weather, month-hour mixing height.

usage: HAZE_STATE=/some/dir python -m pipeline.hindcast START END     (base days, Singapore dates)
output: STATE/hindcast_days.csv (one row per base day and lead), STATE/hindcast_hourly.csv (forecast hours, lead 1-2),
        STATE/hindcast_archive.csv (the rows of forecast_archive.csv, kind = test: seed the live archive with it)
"""
import sys, time
import numpy as np
import pandas as pd
from . import obs, fires, dryness as dz
from .config import STATE, FIRE_WINDOW_DAYS
from .run import forecast, static_inputs, recent_bias, archive_rows, day_obs


def dryness_period(first, last):
    """Bucket from 1 January of the first year (CHIRPS final where it exists, else preliminary) to `last`."""
    T, Ps = [], []
    for y in range(first.year, last.year + 1):
        ds = dz._open(dz.FINAL.format(y=y))
        if ds is not None:
            t, G = dz.regrid(ds); T.append(t); Ps.append(G)
        end = T[-1][-1] if T else pd.Timestamp(f"{y}-01-01") - pd.Timedelta(days=1)
        for m in pd.period_range(max(end + pd.Timedelta(days=1), pd.Timestamp(f"{y}-01-01")), min(last, pd.Timestamp(f"{y}-12-31")), freq="M"):
            ds = dz._open(dz.PRELIM.format(y=m.year, m=m.month))
            if ds is None: continue
            t, G = dz.regrid(ds); ok = np.isfinite(G).any(axis=(1, 2)) & (t > (T[-1][-1] if T else end))
            T.append(t[ok]); Ps.append(G[ok])
    t = T[0].append(T[1:]) if len(T) > 1 else T[0]; P = np.concatenate(Ps)
    o = np.argsort(t.values); t, P = t[o], P[o]
    D = dz.bucket(P, np.zeros(P.shape[1:]))
    return t, D


def main(start, end):
    days = pd.date_range(start, end)
    A = obs.update(days[-1] + pd.Timedelta(days=8), days_back=len(days) + 20, refresh_days=1)
    O_all = obs.island(A)
    dd, DRY = dryness_period(days[0], days[-1])
    statics = static_inputs()
    dobs = day_obs(O_all)
    rows, hrs, arch = [], [], None
    for D in days:
        t0 = time.time()
        latest = D.normalize()                                        # 00 UTC run of the base day
        O = O_all.loc[:D + pd.Timedelta(hours=23)]
        fdays, G, Rg, _ = fires.update_state(D, FIRE_WINDOW_DAYS)
        m = dd <= D - pd.Timedelta(days=4)
        bias = recent_bias(arch, dobs, D)                             # from the earlier test forecasts only
        res = forecast(D, latest, O, fdays, G, Rg, dd[m], DRY[m], statics, bias=bias)
        a = archive_rows(res, D, kind="test"); arch = a if arch is None else pd.concat([arch, a], ignore_index=True)
        for d in res["out_days"]:
            r = {k: v for k, v in d.items() if k not in ("pm25_hourly", "parts", "mixing_height")}
            r.update({f"part_{k}": v for k, v in d["parts"].items()})
            r.update(base=D.strftime("%Y-%m-%d"), init=float(res["Dd"].init.get(pd.Timestamp(d["date"]), np.nan)),
                     free=float(res["Dd"].free.get(pd.Timestamp(d["date"]), np.nan)), e_base=res["e_raw"], b_free=bias[0], b_init=bias[1],
                     base_obs=float(res["Dd"].obs.get(D, np.nan)), base_init=float(res["Dd"].init.get(D, np.nan)))
            rows.append(r)
            if d["lead"] <= 2:
                for hh, v in enumerate(d["pm25_hourly"]):
                    hrs.append(dict(base=D.strftime("%Y-%m-%d"), lead=d["lead"], time=pd.Timestamp(d["date"]) + pd.Timedelta(hours=hh), pm25=v))
        print(D.date(), f"{time.time() - t0:.0f} s", [(d["pm25"], d["psi"], d["p_psi100"]) for d in res["out_days"][:3]], flush=True)
        pd.DataFrame(rows).to_csv(STATE / "hindcast_days.csv", index=False)
        pd.DataFrame(hrs).to_csv(STATE / "hindcast_hourly.csv", index=False)
        arch.to_csv(STATE / "hindcast_archive.csv", index=False)      # same columns as forecast_archive.csv (kind = test)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
