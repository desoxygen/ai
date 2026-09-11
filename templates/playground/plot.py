"""Bar chart of run_*/final_info.json metrics for the playground template."""
import argparse
import glob
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out_dir", default=None, help="optional: only this run dir")
    args = ap.parse_args()

    base = os.path.dirname(os.path.abspath(__file__))
    pattern = os.path.join(base, "run_0") if args.out_dir else os.path.join(base, "run_*")
    dirs = sorted(glob.glob(pattern))
    if not dirs:
        print("no run_* dirs found")
        return

    runs, metrics = [], set()
    for d in dirs:
        f = os.path.join(d, "final_info.json")
        if not os.path.exists(f):
            continue
        try:
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        runs.append((os.path.basename(d), data))
        metrics.update(data.keys())

    figs_dir = os.path.join(base, "figs")
    os.makedirs(figs_dir, exist_ok=True)
    written = []
    for m in sorted(metrics):
        names = [n for n, d in runs if m in d]
        means = [d[m]["means"] for _, d in runs if m in d]
        errs = [d[m].get("stderrs", 0.0) for _, d in runs if m in d]
        fig, ax = plt.subplots(figsize=(max(4, 1.5 * len(names)), 3))
        ax.bar(names, means, yerr=errs, capsize=4, color="#4c8bf5")
        ax.set_title(m)
        fig.tight_layout()
        out = os.path.join(figs_dir, f"{m}.png")
        fig.savefig(out)
        plt.close(fig)
        written.append(out)
    print("Wrote:", [os.path.basename(w) for w in written])


if __name__ == "__main__":
    main()
