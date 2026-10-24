"""Daily haze forecast for Singapore with the v6 physics box model.

usage:
  python -m pipeline.run                      # live: fetch everything, forecast, write site/data/*.json
  python -m pipeline.run --base-day 2026-10-20 --hindcast   # as if run at 00:10 SGT the next day (writes the archive only)

The run starts just after midnight Singapore time. Base day D = the day that just ended (readings to 23:00).
Forecast days: D+1 (next day) .. D+7. Inputs known at that time: NEA readings to 23:00, fires to day D,
the IFS run of 00 UTC on day D, CHIRPS rain to about D-4.
"""
import argparse, json
import numpy as np
import pandas as pd
from . import ifs, fires, obs, dryness, og
from .config import LAT, LON, STATIC, STATE, SITE_DATA, SGT, LAND_MEAN, OUTLOOK_DAYS, FIRE_WINDOW_DAYS, WEATHER_BACK_DAYS
from .model import (back_traj, fire_eff, along_path, integrate, reservoir, pm25_to_psi, WD, DIUR, NBACK, LAG)

PAR = json.load(open(STATIC / "v6_final_v6b.json"))
P = PAR["params"]
LEADS = json.load(open(STATIC / "lead_errors.json"))   # error memory, recent bias and spread by lead day (history + hindcast)
VERSION = "v6b"


def static_inputs():
    land = np.load(STATIC / "lsm05.npy")
    z = np.load(STATIC / "ship_so2_flux.npz")
    blh = pd.read_csv(STATIC / "blh_clim.csv", index_col=0)          # rows month 1-12, columns hour 0-23 SGT
    return land, z["flux"].astype(np.float64), z["lat"], z["lon"], blh


def compass(dlat, dlon):
    ang = (np.degrees(np.arctan2(dlon, dlat)) + 360) % 360
    return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][int((ang + 22.5) // 45) % 8]


_CM = np.load(STATIC / "country_mask.npz")


def nearest_country(la, lo, r=0.3):
    """Country code (1 Indonesia, 2 Malaysia, 0 other) of the nearest Indonesia/Malaysia pixel within r degrees, and its position."""
    m, la0, lo0, d = _CM["mask"], float(_CM["lat0"]), float(_CM["lon0"]), float(_CM["step"])
    i = int(round((la0 - la) / d)); j = int(round((lo - lo0) / d)); n = int(round(r / d))
    i0, j0 = max(i - n, 0), max(j - n, 0)
    w = m[i0:i + n + 1, j0:j + n + 1]
    ii, jj = np.nonzero(w)
    if not len(ii): return 0, la, lo
    k = np.argmin((ii + i0 - i) ** 2 + (jj + j0 - j) ** 2)
    return int(w[ii[k], jj[k]]), la0 - (ii[k] + i0) * d, lo0 + (jj[k] + j0) * d


def land_name(la, lo):
    """Plain name of a land point (province level, rough boxes; only for the explanation text)."""
    c, la, lo = nearest_country(la, lo)
    if lo >= 108.5 and la > -4.5:                                       # Borneo
        if c == 2: return "Sarawak (Borneo)" if lo < 115.3 else "Sabah (Borneo)"
        if c != 1: return "Borneo"
        if (la > -1.3 and lo < 112.3) or (la > 0.3 and lo < 114.2) or (la <= -1.3 and lo < 111.0): return "West Kalimantan (Borneo)"
        if la < -1.6 and lo >= 114.4: return "South Kalimantan (Borneo)"
        if lo < 115.7 and la < 0.8: return "Central Kalimantan (Borneo)"
        return "East Kalimantan (Borneo)"
    if c == 2: return "Peninsular Malaysia"
    if c != 1: return "southern Thailand" if la > 5.5 else "Singapore and Johor"
    if la < -5.8 and lo > 105.0: return "Java"
    if lo >= 105.0 and -3.6 < la < -1.3 and la > -1.95 - 1.174 * (lo - 104.95): return "Bangka-Belitung"
    if lo >= 103.9 and -0.6 < la < 1.3: return "the Riau Islands"
    if la > 1.8 and lo < 100.4: return "North Sumatra"
    if la > -1.0 and lo >= 100.4: return "Riau (Sumatra)"
    if la <= -4.8: return "Lampung (Sumatra)"
    if la <= -2.6 or (lo >= 103.7 and la <= -2.15): return "South Sumatra" if lo >= 102.6 else "Bengkulu (Sumatra)"
    if lo >= 101.3: return "Jambi (Sumatra)"
    return "West Sumatra"


def place(la, lo, land):
    """Plain name of a point in the region (for the 'where does our air come from' text)."""
    if not np.isfinite(la): return None
    i = int(round((8 - la) / 0.5)); j = int(round((lo - 95) / 0.5))
    on_land = 0 <= i < land.shape[0] and 0 <= j < land.shape[1] and land[i, j] > 0.5
    if abs(la - 1.3) < 0.6 and abs(lo - 103.8) < 0.6: return "Singapore and Johor"
    if on_land: return land_name(la, lo)
    if la > 1.5 and lo > 104.5: return "the South China Sea"
    if lo < 103.0 and la > -1.0: return "the Strait of Malacca"
    if la < -2.5 and lo > 105.5: return "the Java Sea"
    if lo > 104.0 and la < 1.3: return "the sea around Bangka and Riau"
    return "the Indian Ocean" if lo < 98 else "the sea near Singapore"


def smoke_source(Gx, la, lo, day):
    """Name of the land cell with the most fire power (last 3 known days) next to a path point (3 x 3 cells, as the model sees it)."""
    i = int(round((8 - la) / 0.5)); j = int(round((lo - 95) / 0.5))
    d1 = int(np.clip(day, 0, len(Gx) - 1)); d0 = max(0, d1 - 2)
    best, cell = 0.0, None
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ii, jj = i + di, j + dj
            if 0 <= ii < Gx.shape[1] and 0 <= jj < Gx.shape[2]:
                v = float(Gx[d0:d1 + 1, ii, jj].sum())
                if v > best: best, cell = v, (8 - 0.5 * ii, 95 + 0.5 * jj)
    return land_name(*cell) if cell else None


def spread(lead, level):
    """sd of the log error for a lead day (1..7) and a forecast level (ug/m3): history (by level) + real-input extra."""
    h = np.interp(level, LEADS["sd_levels"], LEADS["sd_hist"][lead - 1])
    return float(np.hypot(h, LEADS["extra_sd"][lead - 1]))


def recent_bias(arch, dobs, D):
    """Mean model error, log(measured / model), of the last bias_days days, from our own archived forecasts.
    b_free: the free run of the next-day forecasts; b_init: the run that starts from the 23:00 reading (e_base)."""
    if arch is None or not len(arch): return 0.0, 0.0
    lo, n_min = D - pd.Timedelta(days=LEADS["bias_days"]), LEADS["min_days"]
    a = arch[arch.lead == 1]
    t = pd.to_datetime(a.target); y = t.map(dobs.pm25)
    m = (t > lo) & (t <= D) & y.notna() & (a.free > 0)
    ef = np.log(y[m] / a.free[m])
    e = arch.drop_duplicates("issued"); i = pd.to_datetime(e.issued)
    ei = e.e_base[(i > lo) & (i <= D) & e.e_base.notna()]
    return (float(ef.mean()) if len(ef) >= n_min else 0.0), (float(ei.mean()) if len(ei) >= n_min else 0.0)


def forecast(D, latest, O, fdays, G, Rg, dry_days, DRY_ALL, statics, weather=None, bias=(0.0, 0.0)):
    """Core run (no downloads except the IFS series when `weather` is not given).
    D: base day (Timestamp, SGT); latest: IFS init (UTC); O: island hourly obs (SGT index);
    fdays, G, Rg: daily fire grid (MW per 0.5 deg cell) and region totals up to day D."""
    land, Eflux, elat, elon, blh_clim = statics
    t0 = D - pd.Timedelta(days=WEATHER_BACK_DAYS) - SGT                         # UTC
    t3u, W, sgu, src_run, missing = weather or ifs.series(t0, latest)
    T3 = t3u + SGT                                                                 # SGT
    last_day = (T3[-1] - pd.Timedelta(hours=1)).floor("D")
    # ---------- fires: known to day D, then the mean of the last 3 days ----------
    ext = pd.date_range(fdays[0], last_day)
    nf = len(ext) - len(fdays)
    Gx = np.concatenate([G, np.repeat(G[-3:].mean(0, keepdims=True), nf, 0)]).astype(np.float64)
    R3d = Rg[["sumatra", "kalimantan", "malaysia_pen"]]
    Rx = pd.concat([R3d, pd.DataFrame([R3d.iloc[-3:].mean().values] * nf, columns=R3d.columns,
                                      index=ext[len(fdays):])])
    # ---------- peat dryness (held at the last CHIRPS day) ----------
    ix = dry_days.get_indexer(ext.where(ext <= dry_days[-1], dry_days[-1]))
    ix = np.where(ix < 0, 0, ix)
    DRY = np.nan_to_num(DRY_ALL[ix]).astype(np.float64)
    # ---------- paths ----------
    U9, V9, U1, V1 = (np.ascontiguousarray(W[k], dtype=np.float64) for k in ["u925", "v925", "u100", "v100"])
    R3 = np.ascontiguousarray(W["R3"], dtype=np.float64)
    P9 = back_traj(U9, V9, NBACK); P1 = back_traj(U1, V1, NBACK)
    thh = ((T3 - ext[0]) / pd.Timedelta(hours=1)).values.astype(np.float64)
    Gv = fire_eff(Gx, PAR["mem"])
    S9, Ra, La, Dr = along_path(P9, thh, thh[0], Gv, land, R3, DRY, NBACK, LAG)
    ii = np.rint((P1[..., 0] - elat[0]) / 0.1); jj = np.rint((P1[..., 1] - elon[0]) / 0.1)
    ok = np.isfinite(ii) & np.isfinite(jj) & (ii >= 0) & (ii < len(elat)) & (jj >= 0) & (jj < len(elon))
    SHIP = np.where(ok, Eflux[np.where(ok, ii, 0).astype(int), np.where(ok, jj, 0).astype(int)], 0.0)
    # ---------- Singapore hourly weather (SGT) ----------
    idx = pd.date_range(T3[0], T3[-1], freq="h")
    S = pd.DataFrame(index=idx)
    sg = sgu.copy(); sg.index = sg.index + SGT
    S["u10"] = sg.u10.reindex(idx).interpolate(limit=3, limit_direction="both")
    S["v10"] = sg.v10.reindex(idx).interpolate(limit=3, limit_direction="both")
    S["rain"] = sg.rain.reindex(idx).bfill(limit=2).fillna(0.0).clip(lower=0)      # 3 h total ending at t -> those 3 hours
    S["blh"] = blh_clim.values[idx.month - 1, idx.hour]
    # ---------- box model ----------
    Q, invL, B0, a = np.exp([P["logQ"], P["logInvL"], P["logB0"], P["loga"]]); eps = P["eps"]
    tau, b, tauR, lam = np.exp([P["logtau"], P["logb"], P["logtauR"], P["loglam"]])
    gl, kdry, a_ship = P["gl"], P["kdry"], P["a_ship"]
    hour = idx.hour.values.astype(np.int64); wk = np.asarray(idx.dayofweek >= 5, np.float64)
    h = S.blh.clip(lower=30).values.astype(np.float64)
    Uw = np.hypot(S.u10, S.v10).clip(lower=0.5).values.astype(np.float64); rain = S.rain.values.astype(np.float64)
    k = np.arange(NBACK + 1, dtype=np.float64)
    hourly = lambda x: pd.Series(x, index=T3).reindex(idx).interpolate(limit=3).fillna(0).values
    smk3 = ((S9 * (1 + kdry * Dr / 100.0)) * np.exp(-lam * Ra)) @ np.exp(-k / tau)
    wsh = np.exp(-k / 72.0); wsh[0] = 0.0
    ship3 = (SHIP * np.exp(-lam * Ra)) @ wsh * 3600.0 / 1000.0
    sm = hourly(smk3); shp = a_ship * hourly(ship3)
    Gl = np.concatenate([np.repeat(DRY[:1], LAG, 0), DRY[:-LAG]])
    dry_day = (Gx * Gl).sum((1, 2)) / np.maximum(Gx.sum((1, 2)), 1e-9)
    frp_eff = Rx.sum(axis=1).values * (1 + kdry * dry_day / 100.0)
    rp = pd.Series(reservoir(frp_eff, tauR), index=ext).reindex(idx.floor("D")).fillna(0).values
    land48 = hourly(La[:, 1:49].mean(axis=1))
    bg0 = B0 * (1 + gl * (land48 - LAND_MEAN)); bg = bg0 + shp
    o = O.reindex(idx)
    ci = np.zeros(len(idx)); prev = np.roll(o.pm25.values, 1)
    m = (hour == 0) & np.isfinite(prev); m[0] = False; ci[m] = prev[m]
    z0 = np.zeros(len(idx))
    run = lambda bg_, cinit, q=Q, a_=a, b_=b: integrate(h, Uw, rain, sm, rp, bg_, wk, hour, cinit, q, invL, a_, b_, eps, WD, DIUR, lam)
    C = run(bg, z0); C_f0 = run(bg, z0, a_=0.0); C_ns = run(bg, z0, a_=0.0, b_=0.0)
    C_bg = run(bg, z0, q=1e-9, a_=0.0, b_=0.0); C_sh0 = run(bg0, z0); Ci = run(bg, ci)
    H = pd.DataFrame(dict(obs=o.pm25.values, psi_obs=o.psi.values, free=C, init=Ci, fresh=C - C_f0, old=C_f0 - C_ns,
                          local=C_ns - C_bg, ship=C - C_sh0, background=C_bg - (C - C_sh0), blh=h, wind=Uw, rain=rain,
                          u10=S.u10.values, v10=S.v10.values), index=idx)
    # ---------- daily values and the error correction ----------
    Dd = H.resample("D").mean(); nobs = H.obs.notna().resample("D").sum()
    Dd.loc[nobs < 18, "obs"] = np.nan
    days = pd.date_range(D + pd.Timedelta(days=1), periods=OUTLOOK_DAYS)
    e_raw = float(np.log(Dd.obs.get(D, np.nan)) - np.log(Dd.init.get(D, np.nan)))
    e_D = e_raw if np.isfinite(e_raw) else 0.0
    b_free, b_init = bias
    anom = e_D - b_init if np.isfinite(e_raw) else 0.0
    corr = {d: (b_init if i == 0 else b_free) + LEADS["memory"][i] * anom for i, d in enumerate(days)}
    # hourly forecast with the daily correction; 24-h PSI from readings (to 23:00 of D) + forecast hours
    fc_h = H.init.copy()
    for d in days: fc_h.loc[d:d + pd.Timedelta(hours=23)] *= np.exp(corr[d])
    past = H.obs.loc[:D + pd.Timedelta(hours=23)]
    series_h = pd.concat([past, fc_h.loc[days[0]:days[-1] + pd.Timedelta(hours=23)]])
    rng = np.random.default_rng(1)
    out_days = []
    for i, d in enumerate(days):
        b_ = 0.0
        dm = fc_h.loc[d:d + pd.Timedelta(hours=23)]
        mean = float(dm.mean()); sd = spread(i + 1, mean)
        # spread: log-normal error of the day mean (the same factor for this day and the day before, which share 24-h windows)
        eps_ = rng.normal(b_, sd, 400)
        win = series_h.loc[d - pd.Timedelta(hours=23):d + pd.Timedelta(hours=23)].values.copy()
        is_fc = np.r_[np.zeros(23, bool) if i == 0 else np.ones(23, bool), np.ones(24, bool)][-len(win):]
        sims = np.where(is_fc[None, :], win[None, :] * np.exp(eps_[:, None]), win[None, :])
        roll = np.stack([np.nanmean(sims[:, j:j + 24], axis=1) for j in range(len(win) - 23)], axis=1)
        psi_sims = pm25_to_psi(roll).max(axis=1)
        r0 = pd.Series(win).rolling(24, min_periods=18).mean().values[23:]
        comp = {c: float(H[c].loc[d:d + pd.Timedelta(hours=23)].mean()) for c in ["fresh", "old", "local", "ship", "background"]}
        tot = sum(comp.values())
        hh = H.loc[d:d + pd.Timedelta(hours=23)]
        t_noon = d + pd.Timedelta(hours=14); s = int(np.argmin(abs(T3 - t_noon)))
        path = P9[s]; i24 = path[24]; i48 = path[48]
        seen = S9[s] * np.exp(-k / tau) * np.exp(-lam * Ra[s])
        kmax = int(np.argmax(seen)) if seen.max() > 0 else 24
        out_days.append(dict(
            date=d.strftime("%Y-%m-%d"), lead=i + 1,
            pm25=round(mean * np.exp(b_), 1),
            pm25_lo=round(mean * np.exp(b_ - 1.2816 * sd), 1), pm25_hi=round(mean * np.exp(b_ + 1.2816 * sd), 1),
            psi=int(round(float(pm25_to_psi(np.nanmax(r0) * np.exp(b_))))),
            psi_lo=int(round(float(np.percentile(psi_sims, 10)))), psi_hi=int(round(float(np.percentile(psi_sims, 90)))),
            p_psi100=round(float((psi_sims > 100).mean()), 2),
            pm25_hourly=[round(float(x), 1) for x in dm.values],
            parts={c: round(v / tot, 3) for c, v in comp.items()},
            mixing_height=[int(hh.blh.min()), int(hh.blh.max())],
            wind_ms=round(float(hh.wind.mean()), 1), wind_from=compass(-float(hh.v10.mean()), -float(hh.u10.mean())),
            rain_sg_mm=round(float(hh.rain.sum()), 1),
            air_from=compass(i24[0] - 1.30, i24[1] - 103.82) if np.isfinite(i24[0]) else None,
            air_place_24h=place(i24[0], i24[1], land), air_place_48h=place(i48[0], i48[1], land),
            smoke_place=smoke_source(Gx, path[kmax, 0], path[kmax, 1], min(np.floor((thh[s] - kmax) / 24.0), np.floor(thh[s] / 24.0) - 1))
            if seen.max() > 0 else None,
            smoke_age_h=kmax if seen.max() > 0 else None,
            rain_on_path_mm=round(float(Ra[s, 1:].max()), 1),
            fire_seen=round(float(seen.sum()), 1),
        ))
    return dict(H=H, Dd=Dd, days=days, out_days=out_days, e_D=e_D, e_raw=e_raw, bias=bias, P9=P9, P1=P1, T3=T3, Rg=Rg, G=G, fdays=fdays,
                latest=latest, missing=missing, dry_last=dry_days[-1], dry_day=pd.Series(dry_day, index=ext))


# ---------------------------------------------------------------------------------------------------------------
BANDS = [(0, 50, "good", "Good"), (51, 100, "moderate", "Moderate"), (101, 200, "unhealthy", "Unhealthy"),
         (201, 300, "very-unhealthy", "Very unhealthy"), (301, 10000, "hazardous", "Hazardous")]
P_WATCH = LEADS.get("p_watch", 0.15)              # chance of PSI > 100 that starts a "haze watch" (catch-90% line)


def band(psi):
    for lo, hi, key, name in BANDS:
        if psi <= hi: return key, name
    return BANDS[-1][2], BANDS[-1][3]


def warning(day):
    p = day["p_psi100"]
    if p >= 0.5: return "warn"
    if p >= P_WATCH: return "watch"
    return "none"


def best_hours(pm):
    """Best 3-hour block between 07:00 and 21:00 (lowest forecast PM2.5)."""
    s = pd.Series(pm).rolling(3).mean()
    s = s.iloc[9:22]                                          # blocks that end 09:00 .. 21:00
    e = int(s.idxmin()); return [e - 2, e + 1]


def archive_rows(res, D, kind="live"):
    rows = []
    for d in res["out_days"]:
        rows.append(dict(kind=kind, issued=D.strftime("%Y-%m-%d"), target=d["date"], lead=d["lead"], pm25=d["pm25"], pm25_lo=d["pm25_lo"],
                         pm25_hi=d["pm25_hi"], psi=d["psi"], psi_lo=d["psi_lo"], psi_hi=d["psi_hi"], p_psi100=d["p_psi100"],
                         init=round(float(res["Dd"].init.get(pd.Timestamp(d["date"]), np.nan)), 2),
                         free=round(float(res["Dd"].free.get(pd.Timestamp(d["date"]), np.nan)), 2), e_base=round(res["e_raw"], 3),
                         b_free=round(res["bias"][0], 3), b_init=round(res["bias"][1], 3)))
    return pd.DataFrame(rows)


def save_archive(df):
    f = STATE / "forecast_archive.csv"
    if f.exists():
        old = pd.read_csv(f, dtype={"issued": str, "target": str})
        if "kind" not in old: old["kind"] = "live"
        df = pd.concat([old[~old.issued.isin(df.issued.unique())], df])          # a new run replaces the old one
    df.sort_values(["issued", "lead"]).to_csv(f, index=False)
    return df


def day_obs(O):
    """Measured daily values: mean PM2.5 (18+ hours) and the highest island 24-h PSI of the day."""
    n = O.pm25.notna().resample("D").sum()
    d = pd.DataFrame({"pm25": O.pm25.resample("D").mean(), "psi_peak": O.psi.resample("D").max(), "psi_max_region": O.psi_max.resample("D").max()})
    d.loc[n < 18, "pm25"] = np.nan
    return d


def write_site(res, D, now_utc, O, A, fires_last, arch):
    H, out_days = res["H"], res["out_days"]
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    for d in out_days:
        d["band"], d["band_name"] = band(d["psi"]); d["warning"] = warning(d); d["best_hours"] = best_hours(d["pm25_hourly"])
    nxt = out_days[0]
    last = A.dropna(how="all").iloc[-1:]
    now = dict(time=last.index[0].strftime("%Y-%m-%dT%H:%M"),
               pm25={r: float(last[f"pm25_{r}"].iloc[0]) for r in ["north", "south", "east", "west", "central"] if np.isfinite(last[f"pm25_{r}"].iloc[0])},
               psi={r: float(last[f"psi_{r}"].iloc[0]) for r in ["north", "south", "east", "west", "central"] if np.isfinite(last[f"psi_{r}"].iloc[0])})
    dobs = day_obs(O)
    base = dict(date=D.strftime("%Y-%m-%d"), pm25=round(float(dobs.pm25.get(D, np.nan)), 1) if np.isfinite(dobs.pm25.get(D, np.nan)) else None,
                psi_peak=int(dobs.psi_peak.get(D)) if np.isfinite(dobs.psi_peak.get(D, np.nan)) else None,
                model=round(float(res["Dd"].init.get(D, np.nan)), 1))
    fz = res["Rg"]
    fires_series = dict(days=[d.strftime("%Y-%m-%d") for d in fz.index], sumatra=(fz.sumatra / 1e3).round(2).tolist(),
                        kalimantan=(fz.kalimantan / 1e3).round(2).tolist(), malaysia=(fz.malaysia_pen / 1e3).round(2).tolist(),
                        count=fz.count_all.astype(int).tolist(), unit="GW (sum of satellite fire power)")
    h0 = pd.Timestamp(out_days[0]["date"])
    hh = H.loc[h0:h0 + pd.Timedelta(days=len(out_days)) - pd.Timedelta(hours=1)]
    fc = dict(
        issued_sgt=(pd.Timestamp(now_utc) + SGT).strftime("%Y-%m-%dT%H:%M"), base_day=base, now=now, days=out_days,
        warning=dict(level=nxt["warning"], date=nxt["date"], p=nxt["p_psi100"],
                     next_watch=next((d["date"] for d in out_days if d["warning"] != "none"), None)),
        hourly=dict(start=h0.strftime("%Y-%m-%dT%H:%M"), blh=[int(x) for x in hh.blh.values], wind=[round(float(x), 1) for x in hh.wind.values],
                    rain=[round(float(x), 2) for x in hh.rain.values]),
        fires=fires_series,
        inputs=dict(model=f"{VERSION} physics box model (12 constants, fitted on NEA data April 2014 - 2025)",
                    ifs_run=res["latest"].strftime("%Y-%m-%d %HZ"), ifs_missing_steps=len(res["missing"]),
                    fires_to=res["fdays"][-1].strftime("%Y-%m-%d"), rain_to=res["dry_last"].strftime("%Y-%m-%d"),
                    obs_to=O.pm25.last_valid_index().strftime("%Y-%m-%dT%H:%M"),
                    peat_dryness_mm=round(float(res["dry_day"].get(D, np.nan)), 0) if np.isfinite(res["dry_day"].get(D, np.nan)) else None),
        constants={k: round(v, 4) for k, v in P.items()}, leads=LEADS,
        correction=dict(e_base=round(res["e_raw"], 3) if np.isfinite(res["e_raw"]) else None, b_free=round(res["bias"][0], 3), b_init=round(res["bias"][1], 3)))
    json.dump(fc, open(SITE_DATA / "forecast.json", "w"), separators=(",", ":"))
    try:
        og.make(out_days, pd.Timestamp(now_utc) + SGT, SITE_DATA / "og.png")
    except Exception as e:                                   # the picture is nice to have, never a reason to fail
        print("og image:", e, flush=True)
    # map: fires of day D (0.1 deg cells) and the air paths that arrive at 14:00 on each forecast day
    pts = []
    if fires_last is not None and len(fires_last):
        g = fires_last.assign(la=(fires_last.latitude / 0.1).round() * 0.1, lo=(fires_last.longitude / 0.1).round() * 0.1)
        g = g.groupby(["la", "lo"]).agg(frp=("frp", "sum"), n=("frp", "size")).reset_index()
        pts = [[round(a, 2), round(b, 2), round(c, 1), int(n)] for a, b, c, n in g[["la", "lo", "frp", "n"]].values]
    paths = []
    for d in out_days:
        t = pd.Timestamp(d["date"]) + pd.Timedelta(hours=14); s = int(np.argmin(abs(res["T3"] - t)))
        cut = lambda p: [[round(float(x), 3), round(float(y), 3)] for x, y in p[::3] if np.isfinite(x)]
        paths.append(dict(date=d["date"], p925=cut(res["P9"][s]), p100=cut(res["P1"][s])))
    json.dump(dict(fires_day=D.strftime("%Y-%m-%d"), fires=pts, paths=paths), open(SITE_DATA / "map.json", "w"), separators=(",", ":"))
    # history: measured days and the forecasts made for them (lead 1 and lead 3), last 60 days
    hist_days = pd.date_range(D - pd.Timedelta(days=59), D)
    rows = []
    for d in hist_days:
        r = dict(date=d.strftime("%Y-%m-%d"), pm25=None if not np.isfinite(dobs.pm25.get(d, np.nan)) else round(float(dobs.pm25[d]), 1),
                 psi_peak=None if not np.isfinite(dobs.psi_peak.get(d, np.nan)) else int(dobs.psi_peak[d]))
        for L in (1, 3):
            a = arch[(arch.target == d.strftime("%Y-%m-%d")) & (arch.lead == L)]
            for kind, key in (("live", "fc"), ("test", "hc")):
                b = a[a.kind == kind] if "kind" in a else (a if kind == "live" else a.iloc[:0])
                if len(b):
                    b = b.iloc[-1]; r[f"{key}{L}"] = [b.pm25, b.pm25_lo, b.pm25_hi, int(b.psi), float(b.p_psi100)]
        rows.append(r)
    json.dump(dict(days=rows), open(SITE_DATA / "history.json", "w"), separators=(",", ":"))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-day"); ap.add_argument("--hindcast", action="store_true"); ap.add_argument("--now")
    ap.add_argument("--skip-if-done", action="store_true", help="do nothing when the site already has the forecast of this base day")
    a = ap.parse_args(argv)
    now_utc = pd.Timestamp(a.now) if a.now else pd.Timestamp.now("UTC").tz_localize(None)
    if a.base_day:
        D = pd.Timestamp(a.base_day); now_utc = D + pd.Timedelta(hours=16, minutes=10) if a.hindcast else now_utc
    else:
        D = (now_utc + SGT).floor("D") - pd.Timedelta(days=1)
    if a.skip_if_done and (SITE_DATA / "forecast.json").exists():
        done = json.load(open(SITE_DATA / "forecast.json")).get("base_day", {}).get("date")
        if done == D.strftime("%Y-%m-%d"):
            print(f"forecast for base day {done} is already there: nothing to do", flush=True); return None
    latest = ifs.latest_run(min(now_utc, D + pd.Timedelta(hours=16, minutes=10)) if a.hindcast else now_utc)
    print(f"base day {D.date()}, IFS run {latest}", flush=True)
    A = obs.update(D) if not a.hindcast else obs.load()
    O = obs.island(A)
    O = O.loc[:D + pd.Timedelta(hours=23)]                       # nothing after 23:00 of the base day
    fdays, G, Rg, F_last = fires.update_state(D, FIRE_WINDOW_DAYS)
    dry_days, DRY_ALL = dryness.update(D - pd.Timedelta(days=1)) if not a.hindcast else dryness.load()
    statics = static_inputs()
    f = STATE / "forecast_archive.csv"
    old = pd.read_csv(f, dtype={"issued": str, "target": str}) if f.exists() else None
    if old is not None: old = old[old.issued < D.strftime("%Y-%m-%d")]
    bias = recent_bias(old, day_obs(O), D)
    print(f"recent model error (last {LEADS['bias_days']} days): free {bias[0]:+.3f}, init {bias[1]:+.3f}", flush=True)
    res = forecast(D, latest, O, fdays, G, Rg, dry_days, DRY_ALL, statics, bias=bias)
    arch = save_archive(archive_rows(res, D))
    for d in res["out_days"]:
        print(d["date"], d["pm25"], f"[{d['pm25_lo']}-{d['pm25_hi']}]", "PSI", d["psi"], f"[{d['psi_lo']}-{d['psi_hi']}]",
              "P>100", d["p_psi100"], "air from", d["air_from"], d["air_place_24h"], "| smoke", d["smoke_place"], flush=True)
    if not a.hindcast:
        write_site(res, D, now_utc, O, A, F_last, arch)
    return res


if __name__ == "__main__":
    main()
