"""Paths, grids and fixed settings of the daily forecast."""
import os
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "pipeline" / "static"                                     # fixed inputs (committed)
WORK = Path(os.environ.get("HAZE_WORK", ROOT / "_work"))                  # download cache (not committed)
STATE = Path(os.environ.get("HAZE_STATE", ROOT / "_state"))               # archives kept between runs (branch "data")
SITE_DATA = Path(os.environ.get("HAZE_SITE_DATA", ROOT / "site" / "data"))  # JSON read by the web page

LAT = 8.0 - 0.5 * np.arange(33)          # 0.5 deg grid for fires, wind and rain: 8 N .. 8 S
LON = 95.0 + 0.5 * np.arange(51)         # 95 E .. 120 E
SGT = pd.Timedelta(hours=8)              # Singapore time = UTC + 8 h
LAND_MEAN = 0.33                         # mean land fraction of the 48 h path in the calibration (2013-2025)
REGIONS = ["north", "south", "east", "west", "central"]
OUTLOOK_DAYS = 7
FIRE_WINDOW_DAYS = 28                    # fire history used in a run (memory + old-smoke reservoir)
WEATHER_BACK_DAYS = 6                    # IFS analysis days before the issue day (96 h back trajectories)
USER_AGENT = "sg-haze-watch (https://github.com/kychanbp/sg-haze-watch)"

for p in (WORK, STATE, SITE_DATA):
    p.mkdir(parents=True, exist_ok=True)
