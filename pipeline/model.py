"""v6 physics box model of PM2.5 over Singapore (operational copy, no fitting here).

Origin (air_quality_sg project): v3 box model and rain washout (boxmodel3.py, traj_smoke3.py), v4 peat dryness
(traj_smoke4.py, dryness.py), v5 ship exhaust (traj_emis5.py), v6 fire smoke on the 925 hPa back trajectory.
Constants: v6b "final" fit, April 2014 - 2025 (static/v6_final_v6b.json).

Box (one well-mixed layer of air over Singapore, from the ground up to the mixing height h):
    dC/dt = E/h - (U/L) (C - C_in) - (w_d/h) C - lam P C           (+ entrainment when h grows)
    C_in  = background(land on path) + ship exhaust + a * fire smoke + b * old regional smoke
Fire smoke at Singapore = sum over the 96 h back trajectory of
    fire power under the parcel * (1 + kdry * peat dryness / 100) * exp(-age / tau) * exp(-lam * rain met on the path)
"""
import numpy as np
from scipy.ndimage import uniform_filter

try:
    from numba import njit
except ImportError:                       # plain Python also works (slower, still a few seconds)
    def njit(*a, **k):
        return (lambda f: f) if not (len(a) == 1 and callable(a[0])) else a[0]

WD = 0.002      # dry deposition velocity, m/s
DIUR = 0.4      # day/night amplitude of local emissions
NBACK = 96      # hours of back trajectory
LAG = 5         # days between rain data and the dryness used (CHIRPS delay in the calibration)


@njit(cache=True)
def interp(F, k, w, la, lo):
    """Bilinear in space, linear in time. F[t, i, j]: i from lat 8 N southwards, j from lon 95 E eastwards (0.5 deg)."""
    fi = (8.0 - la) / 0.5; fj = (lo - 95.0) / 0.5
    i0 = int(np.floor(fi)); j0 = int(np.floor(fj))
    if i0 < 0 or j0 < 0 or i0 >= F.shape[1] - 1 or j0 >= F.shape[2] - 1:
        return np.nan
    di = fi - i0; dj = fj - j0
    a = (1 - di) * (1 - dj) * F[k, i0, j0] + (1 - di) * dj * F[k, i0, j0 + 1] + di * (1 - dj) * F[k, i0 + 1, j0] + di * dj * F[k, i0 + 1, j0 + 1]
    if k + 1 < F.shape[0] and w > 0:
        b = (1 - di) * (1 - dj) * F[k + 1, i0, j0] + (1 - di) * dj * F[k + 1, i0, j0 + 1] + di * (1 - dj) * F[k + 1, i0 + 1, j0] + di * dj * F[k + 1, i0 + 1, j0 + 1]
        a = (1 - w) * a + w * b
    return a


@njit(cache=True)
def back_traj(U, V, nback):
    """Air parcels that arrive at Singapore (1.30 N, 103.82 E) every 3 h, traced back nback hours (1 h steps).
    U, V: wind (m/s) every 3 h on the 0.5 deg grid. Returns P[arrival, age_h, (lat, lon)]."""
    nt = U.shape[0]
    P = np.full((nt, nback + 1, 2), np.nan)
    for s in range(nt):
        la, lo = 1.30, 103.82
        P[s, 0, 0] = la; P[s, 0, 1] = lo
        for k in range(1, nback + 1):
            th = s * 3.0 - (k - 0.5)
            if th < 0: break
            kk = int(th // 3); w = (th - kk * 3) / 3.0
            u = interp(U, kk, w, la, lo); v = interp(V, kk, w, la, lo)
            if np.isnan(u): break
            la = la - v * 3600.0 / 111e3
            lo = lo - u * 3600.0 / (111e3 * np.cos(np.radians(la)))
            P[s, k, 0] = la; P[s, k, 1] = lo
    return P


def fire_eff(frp, mem_days):
    """3x3 cell smoothing (trajectory position error) and a smoulder / cloud-gap memory of mem_days."""
    G = uniform_filter(frp, size=(1, 3, 3), mode="constant")
    if mem_days > 0:
        a = np.exp(-1.0 / mem_days); out = np.empty_like(G); acc = np.zeros_like(G[0])
        for d in range(len(G)):
            acc = a * acc + (1 - a) * G[d]; out[d] = acc
        G = out
    return G


@njit(cache=True)
def along_path(P, th, off, G, LAND, R3, DRY, nback, lag):
    """What each parcel meets on its way: fire power S, rain (cumulative from arrival, mm) Ra, land fraction La,
    peat dryness Dr. th[s]: arrival time in hours from the first fire day (00:00 SGT); R3 starts at hour off, 3 h steps.
    Forecast rule: a parcel that arrives on day d sees fires up to day d - 1 only."""
    ns = P.shape[0]
    S = np.zeros((ns, nback + 1)); Ra = np.zeros((ns, nback + 1)); La = np.zeros((ns, nback + 1)); Dr = np.zeros((ns, nback + 1))
    for s in range(ns):
        t = th[s]
        dmax = int(np.floor(t / 24.0)) - 1
        rain_acc = 0.0
        for k in range(1, nback + 1):
            la = P[s, k, 0]; lo = P[s, k, 1]
            if np.isnan(la): break
            i = int(round((8.0 - la) / 0.5)); j = int(round((lo - 95.0) / 0.5))
            if i < 0 or j < 0 or i >= G.shape[1] or j >= G.shape[2]: break
            tk = t - k
            kk = int(np.floor((tk - off) / 3.0))
            if kk < 0: break
            if kk >= R3.shape[0]: kk = R3.shape[0] - 1
            rain_acc += R3[kk, i, j]
            d = int(np.floor(tk / 24.0))
            if d > dmax: d = dmax
            if d >= 0 and d < G.shape[0]:
                S[s, k] = G[d, i, j]
                dd = d - lag
                if dd < 0: dd = 0
                Dr[s, k] = DRY[dd, i, j]
            La[s, k] = LAND[i, j]; Ra[s, k] = rain_acc
    return S, Ra, La, Dr


@njit(cache=True)
def integrate(h, U, rain, sm, rp, bg, weekend, hour, cinit, Q, invL, a, b, eps, wd, diur, lam):
    """Hourly box model. cinit > 0 resets the box to a measured value (forecast mode, at 00:00)."""
    n = h.shape[0]
    C = np.empty(n)
    c = bg[0]
    for i in range(n):
        if cinit[i] > 0.0: c = cinit[i]
        day_on = 1.0 if (hour[i] >= 7 and hour[i] <= 21) else 0.0
        E = Q * (1.0 - eps * weekend[i]) * (1.0 - diur + 2.0 * diur * day_on * 12.0 / 15.0)
        cin = bg[i] + a * sm[i] + b * rp[i]
        if i > 0 and h[i] > h[i - 1]:
            c = c - (h[i] - h[i - 1]) / h[i] * (c - cin)
        k = U[i] * invL + wd / h[i] + lam * rain[i] / 3600.0
        src = E / h[i] / 3600.0 + U[i] * invL * cin
        ceq = src / k
        c = ceq + (c - ceq) * np.exp(-k * 3600.0)
        C[i] = c
    return C


def reservoir(x, tau_d):
    """Old regional smoke: exponential memory (tau_d days) of the daily fire power, known up to the day before."""
    a = np.exp(-1.0 / tau_d); r = np.zeros(len(x)); acc = 0.0
    for i in range(len(x)):
        r[i] = acc
        acc = a * acc + x[i]
    return r * (1 - a)


PSI_C = [0.0, 12.0, 55.0, 150.0, 250.0, 350.0, 500.0]     # 24-h PM2.5 (ug/m3) breakpoints of the NEA PSI
PSI_I = [0.0, 50.0, 100.0, 200.0, 300.0, 400.0, 500.0]


def pm25_to_psi(c):
    return np.interp(c, PSI_C, PSI_I)


def psi_to_pm25(p):
    return np.interp(p, PSI_I, PSI_C)
