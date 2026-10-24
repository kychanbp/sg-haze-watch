"""One-time preparation of the fixed inputs in pipeline/static/ and the emission map layers in site/data/static/.
Run again only to refresh them (for example a new EDGAR year or a new bunker-fuel year).

usage: python -m pipeline.prep_static [lsm] [ship] [countries] [emis] [dryness] [blh FILE.csv]

- lsm05.npy, peat025.npz : ERA5 land-sea mask (0.5 deg cells as in the calibration) and peat soil (ERA5 soil type 6/7)
- ship_so2_flux.npz      : EDGAR v8.1 ship SO2 2022 (ug m-2 s-1, 5x5 cell mean) x Singapore bunker sulphur (last 12 months / 2022)
- country_mask.npz       : Indonesia / Malaysia from Natural Earth (10 m), + 0.05 deg, on a 0.02 deg raster
- dryness state          : CHIRPS from 1 January of this year (final + preliminary), bucket model -> STATE/dryness.npz
- blh_clim.csv           : ERA5 mixing height at the Singapore point, mean by month and hour (SGT), 2014-2025
- site/data/static/      : emission map layers (EDGAR 2022 PM2.5 by source group, PNG) + legend JSON
"""
import io, json, sys, zipfile
import numpy as np
import pandas as pd
import requests
from .config import LAT, LON, STATIC, SITE_DATA, STATE, WORK

EDGAR = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/EDGAR/datasets/v81_FT2022_AP_new/{sp}/{sec}/emi_nc/v8.1_FT2022_AP_{sp}_{y}_{sec}_emi_nc.zip"
NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson"


def edgar(sp, sec, y=2022):
    """Annual EDGAR grid (tonnes / year per 0.1 deg cell), region lat -10..10, lon 93..122."""
    import xarray as xr
    cache = WORK / "edgar"; cache.mkdir(parents=True, exist_ok=True)
    f = cache / f"{sp}_{sec}_{y}.npz"
    if not f.exists():
        r = requests.get(EDGAR.format(sp=sp, sec=sec, y=y), timeout=900); r.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(r.content)); nc = [n for n in z.namelist() if n.endswith(".nc")][0]
        tmp = cache / nc; tmp.write_bytes(z.read(nc))
        d = xr.open_dataset(tmp); x = d["emissions"].sel(lat=slice(-10, 10), lon=slice(93, 122))
        np.savez_compressed(f, e=x.values.astype(np.float32), lat=x.lat.values, lon=x.lon.values); d.close(); tmp.unlink()
    z = np.load(f); return z["e"].astype(np.float64), z["lat"], z["lon"]


def ship():
    from scipy.ndimage import uniform_filter
    e, lat, lon = edgar("SO2", "TNR_Ship")
    bk = pd.read_csv(STATIC / "bunker_so2_monthly.csv", index_col=0, parse_dates=True)
    last12 = bk.so2.iloc[-12:].mean(); sc = last12 / bk.loc["2022", "so2"].mean()
    area = (0.1 * 111.32e3) ** 2 * np.cos(np.radians(lat))[:, None] * np.ones((1, len(lon)))
    flux = uniform_filter(e * sc * 1e12 / (365.25 * 86400) / area, size=5, mode="constant")
    np.savez_compressed(STATIC / "ship_so2_flux.npz", flux=flux.astype(np.float32), lat=lat, lon=lon, scale=sc,
                        months=f"{bk.index[-12]:%Y-%m}..{bk.index[-1]:%Y-%m}")
    print("ship SO2 flux saved, bunker sulphur scale vs 2022:", round(sc, 3))


def lsm():
    import s3fs, h5py
    s3 = s3fs.S3FileSystem(anon=True); out = {}
    for name, code in dict(slt="128_043_slt", lsm="128_172_lsm").items():
        f = f"nsf-ncar-era5/e5.oper.invariant/197901/e5.oper.invariant.{code}.ll025sc.1979010100_1979010100.nc"
        with s3.open(f, "rb", block_size=2 ** 20) as fh:
            h = h5py.File(fh, "r"); v = h[[x for x in h.keys() if x.isupper()][0]]
            out[name] = v[0, 328:393, 380:481].astype(np.float32)          # 8 N .. 8 S, 95 E .. 120 E at 0.25 deg
    L = np.zeros((33, 51), np.float32)
    for i in range(33):
        for j in range(51):
            L[i, j] = out["lsm"][max(0, 2 * i - 1):2 * i + 1, max(0, 2 * j - 1):2 * j + 1].mean()
    np.save(STATIC / "lsm05.npy", L)
    np.savez_compressed(STATIC / "peat025.npz", peat=np.isin(np.rint(out["slt"]), [6, 7]), lsm=out["lsm"] > 0.5)
    print("land mask saved; land share", round(float(L.mean()), 3))


def countries():
    from shapely.geometry import shape
    from shapely import contains_xy
    gj = requests.get(NE, timeout=300).json()
    geo = {ft["properties"]["ADMIN"]: shape(ft["geometry"]).buffer(0.05) for ft in gj["features"] if ft["properties"]["ADMIN"] in ("Indonesia", "Malaysia")}
    step = 0.02; lat = np.arange(8.3, -8.3 - 1e-9, -step); lon = np.arange(94.7, 120.3 + 1e-9, step)
    X, Y = np.meshgrid(lon, lat)
    m = np.zeros(X.shape, np.uint8)
    m[contains_xy(geo["Indonesia"], X, Y)] = 1; m[contains_xy(geo["Malaysia"], X, Y) & (m == 0)] = 2
    np.savez_compressed(STATIC / "country_mask.npz", mask=m, lat0=lat[0], lon0=lon[0], step=step)
    print("country mask", m.shape, {int(k): int((m == k).sum()) for k in np.unique(m)})


def dryness_state():
    from . import dryness as dz
    y = pd.Timestamp.utcnow().year
    ds = dz._open(dz.FINAL.format(y=y)); t1, A = dz.regrid(ds)
    T, Ps = [t1], [A]
    for m in pd.period_range(t1[-1] + pd.Timedelta(days=1), pd.Timestamp.utcnow().tz_localize(None), freq="M"):
        ds = dz._open(dz.PRELIM.format(y=m.year, m=m.month))
        if ds is None: continue
        t, G = dz.regrid(ds); ok = np.isfinite(G).any(axis=(1, 2)) & (t > T[-1][-1])
        T.append(t[ok]); Ps.append(G[ok])
    t = T[0].append(T[1:]); P = np.concatenate(Ps)
    assert len(pd.date_range(t[0], t[-1])) == len(t), "gap in CHIRPS days"
    D = dz.bucket(P, np.zeros(P.shape[1:]))
    keep = slice(-dz.KEEP, None)
    np.savez_compressed(dz.FILE, days=t[keep].values.astype("datetime64[D]").astype(str), dry=D[keep].astype(np.float32))
    print("dryness state", t[0].date(), "..", t[-1].date())


def blh(csv):
    s = pd.read_csv(csv, index_col=0, parse_dates=True).blh
    s.index = s.index + pd.Timedelta(hours=8)
    c = s.groupby([s.index.month, s.index.hour]).mean().unstack()
    c.index.name = "month"; c.columns.name = "hour_sgt"
    c.round(1).to_csv(STATIC / "blh_clim.csv"); print(c.round(0).iloc[[0, 5, 9]].to_string())


GROUPS = {"ships": ["TNR_Ship"], "traffic": ["TRO"], "power_industry": None, "homes_farms": ["RCO", "AWB", "AGS"]}


def emis():
    """PM2.5 emission map layers (tonnes per km2 per year), EDGAR v8.1, 2022, as transparent PNG + legend JSON."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LogNorm
    tot, lat, lon = edgar("PM2.5", "TOTALS")
    secs = {s: edgar("PM2.5", s)[0] for s in ["TNR_Ship", "TRO", "RCO", "AWB", "AGS"]}
    G = {"ships": secs["TNR_Ship"], "traffic": secs["TRO"], "homes_farms": secs["RCO"] + secs["AWB"] + secs["AGS"]}
    G["power_industry"] = np.clip(tot - sum(G.values()), 0, None)
    G["all"] = tot
    area = (0.1 * 111.32) ** 2 * np.cos(np.radians(lat))[:, None]                     # km2
    m_la = (lat >= -8.0) & (lat <= 8.0); m_lo = (lon >= 95.0) & (lon <= 120.0)
    out = SITE_DATA / "static"; out.mkdir(parents=True, exist_ok=True)
    legend = {"source": "EDGAR v8.1 (European Commission JRC), year 2022, primary PM2.5", "unit": "tonnes per km2 per year",
              "bounds": [[float(lat[m_la][0] - 0.05), float(lon[m_lo][0] - 0.05)], [float(lat[m_la][-1] + 0.05), float(lon[m_lo][-1] + 0.05)]],
              "layers": {}}
    cmaps = {"ships": "Blues", "traffic": "Reds", "power_industry": "Purples", "homes_farms": "Greens", "all": "magma_r"}
    vmin, vmax = 0.05, 50.0
    sg = (abs(lat[:, None] - 1.35) < 0.25) & (abs(lon[None, :] - 103.82) < 0.3)
    for k, g in G.items():
        d = (g / area)[np.ix_(m_la, m_lo)][::-1]                                         # north up
        rgba = plt.get_cmap(cmaps[k])(LogNorm(vmin, vmax, clip=True)(np.where(d > 0, d, vmin)))
        rgba[..., 3] = np.clip((np.log10(np.maximum(d, 1e-9)) - np.log10(vmin)) / (np.log10(vmax) - np.log10(vmin)), 0, 1) ** 0.6 * 0.9
        plt.imsave(out / f"emis_{k}.png", rgba)
        legend["layers"][k] = {"file": f"static/emis_{k}.png", "total_t_per_year_region": round(float(g[np.ix_(m_la, m_lo)].sum())),
                               "singapore_t_per_year": round(float(g[sg].sum())), "cmap": cmaps[k]}
    legend["vmin"], legend["vmax"] = vmin, vmax
    pz = np.load(STATIC / "peat025.npz")
    pe = pz["peat"].astype(float)
    rgba = np.zeros(pe.shape + (4,)); rgba[..., 0], rgba[..., 1], rgba[..., 2] = 0.45, 0.30, 0.12; rgba[..., 3] = pe * 0.55
    plt.imsave(out / "peat.png", rgba)
    legend["peat"] = {"file": "static/peat.png", "bounds": [[-8.125, 94.875], [8.125, 120.125]],
                      "source": "ERA5 soil type (tropical organic soil = peat), 0.25 deg"}
    json.dump(legend, open(out / "emissions.json", "w"), indent=1)
    print(json.dumps(legend["layers"], indent=1))


if __name__ == "__main__":
    a = sys.argv[1:] or ["lsm", "ship", "countries", "emis", "dryness"]
    if "lsm" in a: lsm()
    if "ship" in a: ship()
    if "countries" in a: countries()
    if "emis" in a: emis()
    if "dryness" in a: dryness_state()
    if "blh" in a: blh(a[a.index("blh") + 1])
