import os
import os.path as osp

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

# LOAD FINAL RESULTS: one all_results.npy per run folder.
labels = {
    "run_0": "Baseline",
}

runs = {}
for folder in sorted(os.listdir("./")):
    if folder.startswith("run") and osp.isdir(folder) and folder in labels:
        path = osp.join(folder, "all_results.npy")
        if osp.exists(path):
            runs[folder] = np.load(path, allow_pickle=True).item()["curves"]


def stack(run_name, key):
    curves = list(runs[run_name].values())
    iters = [row["iter"] for row in curves[0]]
    mat = np.array([[row[key] for row in curve] for curve in curves])
    mean = mat.mean(axis=0)
    if mat.shape[0] > 1:
        stderr = mat.std(axis=0, ddof=1) / np.sqrt(mat.shape[0])
    else:
        stderr = np.zeros_like(mean)
    return iters, mean, stderr


for key, title, out in [
    ("val_acc", "Validation Accuracy Across Runs", "val_acc.png"),
    ("train_acc", "Training Accuracy Across Runs", "train_acc.png"),
    ("train_loss", "Training Loss Across Runs", "train_loss.png"),
]:
    plt.figure(figsize=(10, 6))
    for run_name in labels:
        if run_name not in runs:
            continue
        iters, mean, stderr = stack(run_name, key)
        plt.plot(iters, mean, label=labels[run_name])
        plt.fill_between(iters, mean - stderr, mean + stderr, alpha=0.2)
    plt.title(f"{title} (grokking: modular addition mod 11)")
    plt.xlabel("Step")
    plt.ylabel(key)
    plt.legend()
    plt.grid(True, alpha=0.2)
    plt.tight_layout()
    plt.savefig(out)
    plt.close()

print("Wrote:", [s for s in os.listdir(".") if s.endswith(".png")])
