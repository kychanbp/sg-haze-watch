"""ECMWF IFS open data (0.25 deg, CC-BY-4.0). No key needed.

Fields: wind at 925 hPa (fire smoke paths) and at 100 m (ship exhaust paths), rain on the 0.5 deg grid;
10 m wind and rain at the Singapore point. The IFS open data has no mixing height (see blh_climatology in run.py).

Past days come from the 00 and 12 UTC runs at steps 0-9 h (an "analysis" series, the same way as ERA5 is used in the
calibration). The future comes from the newest run: 3-hourly to 144 h, then 6-hourly to 192 h.
"""
import json, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd
import requests
from .config import LAT, LON, WORK, USER_AGENT

SOURCES = ["https://storage.googleapis.com/ecmwf-open-data",
           "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com",
           "https://data.ecmwf.int/forecasts"]
WANT = {("pl", "u", "925"): "u925", ("pl", "v", "925"): "v925", ("sfc", "100u", None): "u100", ("sfc", "100v", None): "v100",
        ("sfc", "10u", None): "u10", ("sfc", "10v", None): "v10", ("sfc", "tp", None): "tp"}
REGIONAL = ["u925", "v925", "u100", "v100", "tp"]
SG_LAT, SG_LON = [1.5], [103.75, 104.0]          # ERA5 cells used for Singapore in the calibration
FC_STEPS = list(range(0, 145, 3)) + list(range(150, 193, 6))
CACHE = WORK / "ifs"; CACHE.mkdir(parents=True, exist_ok=True)
_ses = requests.Session(); _ses.headers["User-Agent"] = USER_AGENT
_geo = {}


# before February 2024 the open data was 0.4 deg ("0p4-beta") without 100 m wind: the 1000 hPa wind stands in for it
WANT_04 = dict(WANT); del WANT_04[("sfc", "100u", None)], WANT_04[("sfc", "100v", None)]
WANT_04.update({("pl", "u", "1000"): "u100", ("pl", "v", "1000"): "v100"})


def _path(src, init, step, res="0p25"):
    d, h = init.strftime("%Y%m%d"), init.strftime("%H")
    if res == "0p4-beta": return f"{src}/{d}/{h}z/0p4-beta/oper/{d}{h}0000-{step}h-oper-fc"
    return f"{src}/{d}/{h}z/ifs/0p25/oper/{d}{h}0000-{step}h-oper-fc"


def _get(url, headers=None, tries=6):
    for k in range(tries):
        try:
            r = _ses.get(url, headers=headers or {}, timeout=120)
            if r.status_code in (200, 206): return r
            if r.status_code in (403, 404): return None
        except requests.RequestException:
            pass
        time.sleep(1.5 * (k + 1))
    return None


def _decode(buf):
    import eccodes
    g = eccodes.codes_new_from_message(bytes(buf))
    try:
        ni, nj = eccodes.codes_get(g, "Ni"), eccodes.codes_get(g, "Nj")
        la0 = eccodes.codes_get(g, "latitudeOfFirstGridPointInDegrees"); lo0 = eccodes.codes_get(g, "longitudeOfFirstGridPointInDegrees")
        dx = eccodes.codes_get(g, "iDirectionIncrementInDegrees")
        v = eccodes.codes_get_values(g).reshape(nj, ni)
    finally:
        eccodes.codes_release(g)
    key = (ni, nj, la0, lo0, dx)
    if key not in _geo:
        la = la0 - dx * np.arange(nj); lo = (lo0 + dx * np.arange(ni) + 180) % 360 - 180
        near = lambda arr, xs: np.array([np.argmin(abs(arr - x)) for x in xs])
        _geo[key] = (near(la, LAT), near(lo, LON), near(la, SG_LAT), near(lo, SG_LON))
    i, j, si, sj = _geo[key]
    return v[np.ix_(i, j)].astype(np.float32), float(v[np.ix_(si, sj)].mean())


def fetch_one(init, step):
    """All wanted fields of one (run, step), cached on disk. Returns dict or None."""
    f = CACHE / f"{init:%Y%m%d%H}_{step:03d}.npz"
    if f.exists():
        z = np.load(f); return {k: (z[k], float(z[k + "_sg"])) for k in WANT.values()}
    for src, res in [(s, "0p25") for s in SOURCES] + [(s, "0p4-beta") for s in SOURCES[:2]]:
        if res == "0p4-beta" and init >= pd.Timestamp("2024-03-01"): continue
        want = WANT if res == "0p25" else WANT_04
        p = _path(src, init, step, res)
        r = _get(p + ".index")
        if r is None: continue
        recs = {}
        for line in r.text.splitlines():
            x = json.loads(line); key = (x["levtype"], x["param"], x.get("levelist"))
            if key in want: recs[want[key]] = x
        if len(recs) < len(WANT): continue
        out = {}
        for name, x in recs.items():
            rr = _get(p + ".grib2", {"Range": f"bytes={x['_offset']}-{x['_offset'] + x['_length'] - 1}"})
            if rr is None: break
            out[name] = _decode(rr.content)
        if len(out) == len(WANT):
            np.savez_compressed(f, **{k: v[0] for k, v in out.items()}, **{k + "_sg": v[1] for k, v in out.items()})
            return out
    return None


def run_available(init):
    """True when the run has reached its last step we use (192 h) on one of the mirrors."""
    return any(_get(_path(src, init, FC_STEPS[-1]) + ".index", tries=2) is not None for src in SOURCES)


def latest_run(now_utc, max_back=4):
    t = pd.Timestamp(now_utc).floor("12h")
    for _ in range(max_back):
        if run_available(t): return t
        t -= pd.Timedelta(hours=12)
    raise RuntimeError("no complete IFS run found")


def series(t0, latest, workers=12):
    """3-hourly series (UTC) from t0 to latest + 192 h.
    Returns times t3, regional arrays u925/v925/u100/v100 [t, 33, 51], rain rate R3 [t, 33, 51] (mm/h, mean of the
    3 h that end at t), SG point frame (u10, v10, rain mm/h for the 3 h that end at t), and the run used for each time."""
    t0 = pd.Timestamp(t0).floor("12h")
    inits = pd.date_range(t0 - pd.Timedelta(hours=12), latest - pd.Timedelta(hours=12), freq="12h")
    jobs = [(i, s) for i in inits for s in (0, 3, 6, 9, 12)] + [(latest, s) for s in FC_STEPS]
    t_start = time.time()
    with ThreadPoolExecutor(workers) as ex:
        R = dict(zip(jobs, ex.map(lambda j: fetch_one(*j), jobs)))
    missing = [j for j, o in R.items() if o is None]
    print(f"IFS: {len(jobs)} steps, {len(missing)} missing, {time.time() - t_start:.0f} s", flush=True)
    t3 = pd.date_range(t0, latest + pd.Timedelta(hours=FC_STEPS[-1]), freq="3h")
    n = len(t3); nan = np.full((n, len(LAT), len(LON)), np.nan, np.float32)
    F = {k: nan.copy() for k in ["u925", "v925", "u100", "v100", "R3"]}
    sg = pd.DataFrame(index=t3, columns=["u10", "v10", "rain"], dtype=float)
    src_run = pd.Series(pd.NaT, index=t3)
    pos = {t: i for i, t in enumerate(t3)}

    def put_wind(t, o, run):
        i = pos.get(t)
        if i is None or o is None: return
        for k in ["u925", "v925", "u100", "v100"]: F[k][i] = o[k][0]
        sg.iloc[i, 0], sg.iloc[i, 1] = o["u10"][1], o["v10"][1]; src_run.iloc[i] = run

    def put_rain(t, o, prev, hours):
        """Rain that fell in the `hours` before t, split evenly into 3 h blocks that end at t, t-3h, ..."""
        if o is None or prev is None: return
        reg = np.clip(o["tp"][0] - prev["tp"][0], 0, None) * 1000.0 / hours
        pt = max(o["tp"][1] - prev["tp"][1], 0.0) * 1000.0 / hours
        for h in range(0, hours, 3):
            i = pos.get(t - pd.Timedelta(hours=h))
            if i is not None: F["R3"][i] = reg; sg.iloc[i, 2] = pt

    for a in inits:                                   # analysis series: winds at 0-9 h, rain from 0-3 ... 9-12 h
        for s in (0, 3, 6, 9): put_wind(a + pd.Timedelta(hours=s), R.get((a, s)), a)
        for s in (3, 6, 9, 12): put_rain(a + pd.Timedelta(hours=s), R.get((a, s)), R.get((a, s - 3)), 3)
    for k, s in enumerate(FC_STEPS):                  # newest run
        put_wind(latest + pd.Timedelta(hours=s), R.get((latest, s)), latest)
        if k > 0:
            sp = FC_STEPS[k - 1]
            put_rain(latest + pd.Timedelta(hours=s), R.get((latest, s)), R.get((latest, sp)), s - sp)
    # fill the 3 h gaps of the 6-hourly part (and any missing step) in time
    for k in ["u925", "v925", "u100", "v100", "R3"]:
        A = pd.DataFrame(F[k].reshape(n, -1), index=t3).interpolate(limit=4, limit_direction="both")
        F[k] = A.values.reshape(F[k].shape).astype(np.float32)
    sg = sg.astype(float)
    sg[["u10", "v10"]] = sg[["u10", "v10"]].interpolate(limit=4, limit_direction="both")
    sg["rain"] = sg.rain.fillna(0.0)
    F["R3"] = np.nan_to_num(F["R3"])
    return t3, F, sg, src_run, missing
