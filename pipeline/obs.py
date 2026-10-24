"""NEA readings from data.gov.sg (real-time API v2, no key): hourly 1-h PM2.5 and 24-h PSI for the five regions.

Archive: STATE/obs_hourly.csv, one row per hour (Singapore time). Island value = mean of the five regions
(the same island value as in the calibration and in the warning test).
"""
import os, time
import numpy as np
import pandas as pd
import requests
from .config import STATE, REGIONS, USER_AGENT

API = "https://api-open.data.gov.sg/v2/real-time/api/{kind}"
ARCHIVE = STATE / "obs_hourly.csv"
COLS = [f"pm25_{r}" for r in REGIONS] + [f"psi_{r}" for r in REGIONS]
_ses = requests.Session(); _ses.headers["User-Agent"] = USER_AGENT
PAUSE = 3.0                                                 # seconds between calls (the API without a key is rate-limited)
if os.environ.get("DATA_GOV_SG_API_KEY"):                  # optional free key: higher rate limit
    _ses.headers["x-api-key"] = os.environ["DATA_GOV_SG_API_KEY"]; PAUSE = 0.5


def _get(kind, day):
    for k in range(6):
        try:
            r = _ses.get(API.format(kind=kind), params={"date": day}, timeout=60)
            if r.status_code == 200: return r.json()
            if r.status_code == 404: return None
            wait = float(r.headers.get("Retry-After", 0) or 0) or (5 * (k + 1) if r.status_code == 429 else 3 * (k + 1))
            print(f"obs: {kind} {day} HTTP {r.status_code}, retry in {wait:.0f} s", flush=True)
        except (requests.RequestException, ValueError) as e:
            wait = 3 * (k + 1); print(f"obs: {kind} {day} {type(e).__name__}, retry", flush=True)
        time.sleep(min(wait, 60))
    return None


def fetch_day(day):
    """One Singapore day (YYYY-MM-DD) -> DataFrame indexed by hour (SGT, naive) with COLS."""
    rows = {}
    for kind, var, pre in [("pm25", "pm25_one_hourly", "pm25_"), ("psi", "psi_twenty_four_hourly", "psi_")]:
        j = _get(kind, day)
        for it in ((j or {}).get("data") or {}).get("items", []):
            t = pd.Timestamp(it["timestamp"]).tz_convert("Asia/Singapore").tz_localize(None)
            for reg, v in (it.get("readings", {}).get(var) or {}).items():
                if reg in REGIONS and v is not None: rows.setdefault(t, {})[pre + reg] = float(v)
        time.sleep(PAUSE)
    if not rows: return pd.DataFrame(columns=COLS, index=pd.DatetimeIndex([]), dtype=float)
    df = pd.DataFrame.from_dict(rows, orient="index").reindex(columns=COLS).sort_index()
    return df[df.index.normalize() == pd.Timestamp(day)]


def load():
    if ARCHIVE.exists():
        return pd.read_csv(ARCHIVE, index_col=0, parse_dates=True)
    return pd.DataFrame(columns=COLS, dtype=float)


def update(last_day, days_back=45, refresh_days=3):
    """Fetch the days that are missing (or incomplete) in the archive, plus the last refresh_days days."""
    A = load()
    days = pd.date_range(pd.Timestamp(last_day) - pd.Timedelta(days=days_back), last_day)
    n = A.pm25_central.notna().groupby(A.index.normalize()).sum() if len(A) else pd.Series(dtype=float)
    todo = [d for d in days if d >= days[-refresh_days] or n.get(d, 0) < 20]
    todo = [d for d in todo if d <= pd.Timestamp.now("Asia/Singapore").tz_localize(None)]      # no future days
    for k, d in enumerate(todo):
        x = fetch_day(d.strftime("%Y-%m-%d"))
        if len(x): A = pd.concat([A[~A.index.isin(x.index)], x]).sort_index()
        if k % 5 == 4 or k == len(todo) - 1:                     # save as we go (a long fetch can stop half way)
            A = A[~A.index.duplicated(keep="last")]; A.to_csv(ARCHIVE, float_format="%.1f")
    A = A[~A.index.duplicated(keep="last")]
    A.to_csv(ARCHIVE, float_format="%.1f")
    print(f"obs: {len(todo)} days fetched, archive {A.index.min()} .. {A.index.max()}", flush=True)
    return A


def island(A):
    """Island-mean hourly PM2.5 and 24-h PSI (mean of 5 regions) and the highest region."""
    pm = A[[f"pm25_{r}" for r in REGIONS]]; ps = A[[f"psi_{r}" for r in REGIONS]]
    o = pd.DataFrame({"pm25": pm.mean(axis=1), "pm25_max": pm.max(axis=1), "psi": ps.mean(axis=1), "psi_max": ps.max(axis=1)})
    o.loc[o.pm25 <= 0, "pm25"] = np.nan
    return o.asfreq("h")
