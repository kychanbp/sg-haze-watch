"""Peat dryness index (water deficit, mm) per 0.5 deg cell from CHIRPS daily rain (v4 of the model).

Bucket: D(t) = max(0, D(t-1) + ET (1 - D / DMAX) - P(t)), ET = 4 mm/day, DMAX = 400 mm (fixed, not fitted).
D = 0: the peat is wet. D = 100 mm: the water table is about 0.4-0.5 m down. Dry peat burns deeper and gives more smoke.

State: STATE/dryness.npz holds the last 90 days. Each run adds the new CHIRPS preliminary days (monthly netCDF, ~3.5 MB).
"""
import io
import numpy as np
import pandas as pd
import requests
from .config import LAT, LON, STATE, WORK, USER_AGENT

ET, DMAX = 4.0, 400.0
PRELIM = "https://data.chc.ucsb.edu/products/CHIRPS-2.0/prelim/global_daily/netcdf/p25/chirps-v2.0.{y}.{m:02d}.days_p25.nc"
FINAL = "https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_daily/netcdf/p25/chirps-v2.0.{y}.days_p25.nc"
FILE = STATE / "dryness.npz"
KEEP = 90


def bucket(P, d0):
    """P: rain (mm/day) [days, 33, 51] with NaN for sea; d0: start state. Returns D [days, 33, 51]."""
    D = np.zeros(P.shape, np.float32); d = d0.astype(np.float64).copy()
    for t in range(len(P)):
        p = P[t]
        x = np.maximum(0.0, d + ET * (1.0 - d / DMAX) - np.nan_to_num(p))
        d = np.where(np.isnan(p), 0.0, x)
        D[t] = d
    return D


def regrid(ds):
    """CHIRPS 0.25 deg -> mean of the 4 points inside each 0.5 deg cell (sea = NaN)."""
    x = ds.precip.sel(latitude=slice(-8.3, 8.3), longitude=slice(94.7, 120.3))
    la, lo = x.latitude.values, x.longitude.values; v = x.values.astype(np.float32); v[v < 0] = np.nan
    G = np.full((v.shape[0], len(LAT), len(LON)), np.nan, np.float32)
    for i, a in enumerate(LAT):
        mi = (la > a - 0.25) & (la < a + 0.25)
        for j, b in enumerate(LON):
            mj = (lo > b - 0.25) & (lo < b + 0.25)
            with np.errstate(all="ignore"):
                G[:, i, j] = np.nanmean(v[:, mi][:, :, mj].reshape(v.shape[0], -1), axis=1)
    return pd.DatetimeIndex(x.time.values), G


def _open(url):
    import xarray as xr
    cache = WORK / "chirps"; cache.mkdir(parents=True, exist_ok=True)
    f = cache / url.rsplit("/", 1)[1]
    r = requests.get(url, timeout=600, headers={"User-Agent": USER_AGENT})
    if r.status_code != 200: return None
    f.write_bytes(r.content)
    return xr.open_dataset(f)


def load():
    if not FILE.exists(): return None, None
    z = np.load(FILE); return pd.DatetimeIndex(z["days"]), z["dry"]


def update(until):
    """Add CHIRPS preliminary days after the last stored day, up to `until` (or as far as CHIRPS goes)."""
    days, D = load()
    if days is None: raise RuntimeError("no dryness state; run pipeline/prep_static.py first")
    start = days[-1] + pd.Timedelta(days=1)
    if start > pd.Timestamp(until): return days, D
    T, P = [], []
    for m in pd.period_range(start, until, freq="M"):
        try:
            ds = _open(PRELIM.format(y=m.year, m=m.month))
        except Exception as e:
            print("dryness: CHIRPS not reached", m, e, flush=True); ds = None
        if ds is None: continue
        t, G = regrid(ds)
        ok = np.isfinite(G).any(axis=(1, 2)) & (t >= start) & (t <= pd.Timestamp(until))
        T.append(t[ok]); P.append(G[ok])
    if not T or sum(len(t) for t in T) == 0:
        print("dryness: no new CHIRPS days after", days[-1].date(), flush=True); return days, D
    t = T[0].append(T[1:]) if len(T) > 1 else T[0]; P = np.concatenate(P)
    o = np.argsort(t.values); t, P = t[o], P[o]
    full = pd.date_range(start, t[-1])
    if len(full) != len(t):                     # a gap in CHIRPS: stop before it
        k = int(np.argmax(full[: len(t)] != t)) if (full[: len(t)] != t).any() else len(t)
        t, P = t[:k], P[:k]
        if len(t) == 0: return days, D
    Dn = bucket(P, D[-1])
    days = days.append(t); D = np.concatenate([D, Dn])[-KEEP:]; days = days[-KEEP:]
    np.savez_compressed(FILE, days=days.values.astype("datetime64[D]").astype(str), dry=D.astype(np.float32))
    print(f"dryness: +{len(t)} days to {days[-1].date()}", flush=True)
    return days, D
