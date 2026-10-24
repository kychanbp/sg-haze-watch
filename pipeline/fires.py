"""Satellite fires: VIIRS 375 m active fires from NASA GIBS vector tiles (the same records as FIRMS near real time, no key).

The model was calibrated with VIIRS on Suomi NPP (nominal and high confidence). When S-NPP has no data for a day,
NOAA-20 (then NOAA-21) fills that day. Fire day = Singapore date of the satellite pass.
"""
import time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd
import requests
from .config import LAT, LON, STATIC, STATE, WORK, SGT, USER_AGENT

LAYERS = {"N": "VIIRS_SNPP_Thermal_Anomalies_375m_All", "N20": "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
          "N21": "VIIRS_NOAA21_Thermal_Anomalies_375m_All"}
URL = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{layer}/default/{d}/500m/{L}/{r}/{c}.mvt"
BOX = (-8.25, 8.25, 94.75, 120.25)
CACHE = WORK / "fires"; CACHE.mkdir(parents=True, exist_ok=True)
_ses = requests.Session(); _ses.headers["User-Agent"] = USER_AGENT


def _tiles(L, la0, la1, lo0, lo1):
    d = 288 / 2 ** L
    return [(L, r, c) for r in range(int((90 - la1) // d), int((90 - la0) // d) + 1)
            for c in range(int((lo0 + 180) // d), int((lo1 + 180) // d) + 1)]


def _tile(layer, day, L, r, c):
    import mapbox_vector_tile as mvt
    for k in range(6):
        try:
            x = _ses.get(URL.format(layer=layer, d=day, L=L, r=r, c=c), timeout=90)
            if x.status_code == 200: break
            if x.status_code in (400, 404): return []
        except requests.RequestException:
            pass
        time.sleep(2 * (k + 1))
    else:
        return None
    if not x.content: return []
    f = [ft["properties"] for v in mvt.decode(x.content).values() for ft in v["features"]]
    if len(f) >= 4990 and L < 7:                       # a full tile may be capped: split it
        d = 288 / 2 ** L; la1 = 90 - r * d; lo0 = c * d - 180
        parts = [_tile(layer, day, *t) for t in _tiles(L + 1, la1 - d + 1e-6, la1 - 1e-6, lo0 + 1e-6, lo0 + d - 1e-6)]
        return None if any(p is None for p in parts) else sum(parts, [])
    return f


def utc_day(day, sat="N", final=True):
    """All fire records of one UTC date for one satellite. Cached when the day is complete (final=True)."""
    f = CACHE / f"{sat}_{day}.csv"
    if f.exists(): return pd.read_csv(f)
    jobs = _tiles(6, *BOX)
    with ThreadPoolExecutor(8) as ex:
        R = list(ex.map(lambda t: _tile(LAYERS[sat], day, *t), jobs))
    if any(r is None for r in R):
        raise RuntimeError(f"GIBS tiles missing for {sat} {day}")
    df = pd.DataFrame([p for r in R for p in r])
    if len(df):
        df.columns = [c.lower() for c in df.columns]
        df = df.drop_duplicates(subset=["latitude", "longitude", "acq_date", "acq_time"])
        df = df[df.latitude.between(BOX[0], BOX[1]) & df.longitude.between(BOX[2], BOX[3])]
    else:
        df = pd.DataFrame(columns=["latitude", "longitude", "acq_date", "acq_time", "frp", "confidence", "daynight"])
    df["sat"] = sat
    if final: df.to_csv(f, index=False)
    return df


def fetch(first_sgt, last_sgt):
    """Fire records for Singapore days first..last. Satellite passes are on UTC dates; an S-NPP night pass of UTC day d
    (~18 UTC) belongs to Singapore day d + 1. When S-NPP has no day pass on a date (it happens), the day records of
    NOAA-20 (then NOAA-21) fill that date."""
    days = pd.date_range(pd.Timestamp(first_sgt) - pd.Timedelta(days=1), last_sgt)
    today_utc = pd.Timestamp.utcnow().tz_localize(None).floor("D")
    out = []
    for d in days:
        ds = d.strftime("%Y-%m-%d"); final = d < today_utc
        x = utc_day(ds, "N", final)
        if (x.daynight == "D").sum() == 0:
            for sat in ("N20", "N21"):
                y = utc_day(ds, sat, final)
                if (y.daynight == "D").sum():
                    print(f"fires: no S-NPP day pass on {ds}, used {sat}", flush=True)
                    x = pd.concat([x, y[y.daynight == "D"]], ignore_index=True); break
        out.append(x)
    f = pd.concat(out, ignore_index=True)
    for c in ("latitude", "longitude", "frp"):                 # an empty day can turn the columns into text
        f[c] = pd.to_numeric(f[c], errors="coerce")
    f = f[f.confidence.isin(["nominal", "high"]) & f.latitude.notna() & f.longitude.notna()].copy()
    hhmm = f.acq_time.astype(str).str.replace(":", "").str.zfill(4).astype(int)
    t = pd.to_datetime(f.acq_date) + pd.to_timedelta(hhmm // 100, "h") + pd.to_timedelta(hhmm % 100, "min") + SGT
    f["time_sgt"] = t; f["day"] = t.dt.floor("D")
    return f[(f.day >= pd.Timestamp(first_sgt)) & (f.day <= pd.Timestamp(last_sgt))].reset_index(drop=True)


def country_of(lat, lon):
    """0 = other, 1 = Indonesia, 2 = Malaysia (Natural Earth borders + 0.05 deg, rasterised at 0.02 deg)."""
    z = np.load(STATIC / "country_mask.npz")
    m, la0, lo0, d = z["mask"], float(z["lat0"]), float(z["lon0"]), float(z["step"])
    i = np.clip(np.rint((la0 - np.asarray(lat)) / d).astype(int), 0, m.shape[0] - 1)
    j = np.clip(np.rint((np.asarray(lon) - lo0) / d).astype(int), 0, m.shape[1] - 1)
    return m[i, j]


def grid_and_regions(f, days):
    """Daily fire power (MW) on the 0.5 deg grid and the three source-region totals used for the old-smoke reservoir."""
    days = pd.DatetimeIndex(days)
    i = np.rint((8 - f.latitude.values) / 0.5).astype(int); j = np.rint((f.longitude.values - 95) / 0.5).astype(int)
    G = np.zeros((len(days), len(LAT), len(LON)), np.float32); di = days.get_indexer(f.day)
    ok = (di >= 0) & (i >= 0) & (i < len(LAT)) & (j >= 0) & (j < len(LON))
    np.add.at(G, (di[ok], i[ok], j[ok]), f.frp.values[ok].astype(np.float32))
    c = country_of(f.latitude.values, f.longitude.values); ind = c == 1
    lat, lon = f.latitude.values, f.longitude.values
    reg = {"sumatra": ind & (lon < 106.5) & (lat > -6.5), "kalimantan": ind & (lon > 108.5) & (lat > -4.5),
           "malaysia_pen": (c == 2) & (lon < 105)}
    R = pd.DataFrame({k: f[m].groupby("day").frp.sum() for k, m in reg.items()}).reindex(days).fillna(0.0)
    R["count_sumatra"] = f[reg["sumatra"]].groupby("day").size().reindex(days).fillna(0)
    R["count_kalimantan"] = f[reg["kalimantan"]].groupby("day").size().reindex(days).fillna(0)
    R["count_all"] = f.groupby("day").size().reindex(days).fillna(0)
    return G, R


def fill_empty(G, R):
    """A day without any satellite pass gets the mean of the neighbour days (the last day: the day before)."""
    for k in np.where(G.sum(axis=(1, 2)) == 0)[0]:
        if 0 < k < len(G) - 1:
            G[k] = (G[k - 1] + G[k + 1]) / 2; R.iloc[k] = (R.iloc[k - 1] + R.iloc[k + 1]) / 2
        elif k == len(G) - 1 and k > 0:
            G[k] = G[k - 1]; R.iloc[k] = R.iloc[k - 1]
        else:
            continue
        print("fires: filled empty day", R.index[k].date(), flush=True)
    return G, R


STATE_FILE = STATE / "fires_daily.npz"


def update_state(D, window, refresh=3):
    """Daily fire grids for the `window` days to D (Singapore days). Stored grids are reused; the last `refresh` days
    and missing days are fetched again. Returns days, grid, region totals, and the fire records of day D."""
    days = pd.date_range(pd.Timestamp(D) - pd.Timedelta(days=window - 1), D)
    old_days, old_G, old_R = pd.DatetimeIndex([]), None, None
    if STATE_FILE.exists():
        z = np.load(STATE_FILE, allow_pickle=False)
        old_days = pd.DatetimeIndex(z["days"]); old_G = z["grid"]
        old_R = pd.DataFrame(z["regions"], index=old_days, columns=[str(c) for c in z["region_cols"]])
    need = [d for d in days if d not in old_days or d > days[-1] - pd.Timedelta(days=refresh)]
    G = np.zeros((len(days), len(LAT), len(LON)), np.float32); R = None; F_last = None
    if need:
        span = pd.date_range(min(need), max(need))
        F = fetch(span[0], span[-1])
        Gn, Rn = grid_and_regions(F, span)
        F_last = F[F.day == pd.Timestamp(D)]
    for i, d in enumerate(days):
        if need and d in span:
            G[i] = Gn[span.get_loc(d)]; row = Rn.loc[d]
        else:
            G[i] = old_G[old_days.get_loc(d)]; row = old_R.loc[d]
        R = pd.DataFrame([row.values], columns=row.index, index=[d]) if R is None else pd.concat([R, pd.DataFrame([row.values], columns=row.index, index=[d])])
    R.index = days
    keep_days = days.union(old_days[old_days > days[-1] - pd.Timedelta(days=90)]) if len(old_days) else days
    keep_days = keep_days[keep_days >= days[-1] - pd.Timedelta(days=90)]
    allG = np.stack([G[days.get_loc(d)] if d in days else old_G[old_days.get_loc(d)] for d in keep_days])
    allR = pd.concat([R, old_R[~old_R.index.isin(days)]]).reindex(keep_days) if old_R is not None else R.reindex(keep_days)
    np.savez_compressed(STATE_FILE, days=keep_days.values.astype("datetime64[D]").astype(str), grid=allG.astype(np.float32),
                        regions=allR.values.astype(np.float64), region_cols=np.array(list(allR.columns)))
    G, R = fill_empty(G.copy(), R.copy())
    return days, G, R, F_last
