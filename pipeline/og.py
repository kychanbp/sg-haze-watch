"""Link-preview picture (1200 x 630) for WhatsApp, Telegram and other apps: the next 7 days of PSI."""
import numpy as np
import pandas as pd

COL = {"good": "#2e9e5b", "moderate": "#d9a21b", "unhealthy": "#e8702a", "very-unhealthy": "#d23a3a", "hazardous": "#7d3cc8"}


def make(days, issued, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import FancyBboxPatch
    fig = plt.figure(figsize=(12, 6.3), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 1200); ax.set_ylim(0, 630); ax.axis("off")
    fig.patch.set_facecolor("#eef5fa")
    ax.text(48, 572, "SG Haze Watch", fontsize=34, fontweight="bold", color="#0f6fa8", va="center")
    ax.text(48, 528, f"Haze forecast for Singapore · made {issued:%a %d %b %Y}", fontsize=17, color="#4a5a68", va="center")
    # the first two days, big
    for k, d in enumerate(days[:2]):
        x0 = 48 + k * 560
        ax.add_patch(FancyBboxPatch((x0, 300), 530, 190, boxstyle="round,pad=0,rounding_size=22", fc="white", ec="#d9e3ea", lw=2))
        c = COL[d["band"]]
        t = pd.Timestamp(d["date"])
        ax.text(x0 + 28, 455, f"{t:%a %d %b}", fontsize=20, color="#15212b", fontweight="bold", va="center")
        ax.text(x0 + 28, 380, f"PSI {d['psi']}", fontsize=48, color=c, fontweight="bold", va="center")
        ax.text(x0 + 300, 400, d["band_name"], fontsize=21, color=c, fontweight="bold", va="center")
        ax.text(x0 + 300, 362, f"chance > 100: {round(d['p_psi100'] * 100)}%", fontsize=16, color="#4a5a68", va="center")
        ax.text(x0 + 28, 322, f"PM2.5 day mean about {d['pm25']:.0f} µg/m³", fontsize=15, color="#4a5a68", va="center")
    # 7-day bars
    psis = [d["psi"] for d in days]; top = max(160, max(psis) * 1.15)
    for k, d in enumerate(days):
        x = 70 + k * 155; h = 150 * d["psi"] / top
        ax.add_patch(FancyBboxPatch((x, 95), 90, h, boxstyle="round,pad=0,rounding_size=10", fc=COL[d["band"]], ec="none"))
        ax.text(x + 45, 95 + h + 16, str(d["psi"]), ha="center", fontsize=17, fontweight="bold", color="#15212b", zorder=3,
                bbox=dict(boxstyle="round,pad=0.15", fc="#eef5fa", ec="none"))
        ax.text(x + 45, 70, f"{pd.Timestamp(d['date']):%a %d}", ha="center", fontsize=14, color="#4a5a68")
    y100 = 95 + 150 * 100 / top
    ax.plot([55, 1150], [y100, y100], ls="--", lw=1.5, color="#e8702a", zorder=0)
    ax.text(1150, y100 + 8, "PSI 100", ha="right", fontsize=12, color="#e8702a")
    ax.text(48, 24, "kychanbp.github.io/sg-haze-watch · physics forecast · not an official forecast (see haze.gov.sg)", fontsize=13, color="#7b8b98")
    fig.savefig(path, dpi=100, facecolor=fig.get_facecolor())
    plt.close(fig)
