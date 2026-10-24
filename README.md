# SG Haze Watch

A free website that forecasts the haze in Singapore: the PM2.5 and the PSI for the next 7 days, the chance that the
PSI goes above 100, a map of the pollution sources, and a lesson on how the forecast works.

**Site:** https://kychanbp.github.io/sg-haze-watch/

Not an official forecast. For official readings and health advice, use [haze.gov.sg](https://www.haze.gov.sg/) (NEA).

## How the forecast works

The model is a physics box model (no machine learning). The air over Singapore is one box, from the ground up to the
mixing height. Each hour the box gets PM2.5 from local emissions and from the air that the wind brings in, and loses
PM2.5 to the wind, rain and settling. The incoming air carries a background, ship exhaust (EDGAR emissions on a
100 m back trajectory), fresh fire smoke (VIIRS fire power under a 4-day back trajectory at 925 hPa, with decay, rain
washout and peat dryness) and old regional smoke. The 12 constants were fitted on NEA hourly data, April 2014 to 2025
(model version v6b).

Each night the job:

1. gets the NEA readings to 23:00 (data.gov.sg), the VIIRS fires of the last 28 days (NASA GIBS), the newest complete
   ECMWF IFS open-data run (8 days), and CHIRPS rain for the peat dryness;
2. runs the back trajectories and the box, hour by hour, for 7 days (future fires = mean of the last 3 days);
3. corrects with the model's mean error of the last 28 days and the error memory of the last day;
4. finds the forecast range and the chance of PSI > 100 from 400 runs with the error size of past tests
   (`pipeline/static/lead_errors.json`);
5. writes `forecast.json`, `map.json`, `history.json` and a link-preview picture `og.png`.

The "How it works" page (`site/learn.html`) explains it for students, with a box lab that runs the same equation.

## Layout

```
pipeline/            the daily job (Python)
  run.py             forecast and site data          python -m pipeline.run
  model.py           box model, trajectories, PSI
  ifs.py fires.py obs.py dryness.py                  data inputs
  hindcast.py        re-run past days with only the data known at the time
  evaluate.py        score a hindcast; writes site/data/static/skill.json (numbers on the about page)
  prep_static.py     one-time static inputs (land, peat, ships, emissions, mixing height)
  static/            model constants, error model, static grids
site/                the website (plain HTML, CSS and JavaScript; Leaflet for maps)
.github/workflows/forecast.yml                       nightly job and publishing
```

## The nightly job

`.github/workflows/forecast.yml` runs at 00:25 Singapore time (and again at 02:40 if the first run failed). It reads
the model state from the `gh-pages` branch (`state/`: NEA readings archive, fire grids, peat dryness, past
forecasts), runs the forecast, and replaces the `gh-pages` branch with one new commit: the site, the new data and the
new state. A push to `main` that changes the site or the pipeline publishes the new page code with the last
forecast, and then tests a full forecast run on the GitHub runner (its output is thrown away).

Set-up (once):

- **GitHub Pages:** Settings → Pages → Build and deployment → Source: *Deploy from a branch*, branch `gh-pages`,
  folder `/ (root)`.
- **Optional:** a free data.gov.sg API key as the repository secret `DATA_GOV_SG_API_KEY` (higher rate limit).
- GitHub stops scheduled jobs in a repository with no activity for 60 days. If that happens, open the Actions tab
  and enable the workflow again.

Run it by hand: Actions → *Forecast and publish* → *Run workflow*.

## Run it on your computer

```bash
pip install -r requirements.txt
export HAZE_STATE=_state HAZE_WORK=_work          # state and download cache
python -m pipeline.run                             # needs a seeded state: copy state/ from the gh-pages branch
python -m http.server -d site 8000                 # then open http://localhost:8000
```

Test past days (hindcast) and score them. The first 7 days only warm up the "recent error" term, so score from the
eighth day:

```bash
HAZE_STATE=_hindcast python -m pipeline.hindcast 2026-08-01 2026-10-23
HAZE_STATE=_hindcast python -m pipeline.evaluate --from 2026-08-08 --write
```

The 2026 test (8 August to 23 October, real weather forecasts and only the fires known at the time): for the next
day, warnings (chance of PSI > 100 at least 50%) caught 22 of the 27 days with PSI above 100 with no false warnings;
warnings and watches (chance at least 15%) caught 25 of 27, with 5 false flags on 49 clear days (PSI 86 to 96).

## Data and licences

| Data | Source |
|---|---|
| PM2.5 and PSI readings | NEA via data.gov.sg (Singapore Open Data Licence) |
| Fires | NASA FIRMS / LANCE VIIRS 375 m active fires, via NASA GIBS |
| Weather forecast | ECMWF open data, IFS (CC BY 4.0) |
| Rain | CHIRPS v2.0, Climate Hazards Center, UC Santa Barbara |
| Mixing height, soil type, land | ERA5, Copernicus Climate Change Service (via NSF NCAR) |
| Emissions | EDGAR v8.1, European Commission JRC (CC BY 4.0) |
| Borders | Natural Earth |
| Map tiles | Esri |

Contains modified Copernicus Climate Change Service information. Neither the European Commission nor ECMWF is
responsible for any use of this information.
