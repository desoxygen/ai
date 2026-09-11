"""playground — минимальный test-шаблон для локального прогона пайплайна.

Логистическая регрессия на синтетических "двух полумесяцах": сравнение
скорости обучения. CPU-only, numpy-only, детерминированно (<5 секунд).
Контракт: --out_dir, итог в <out_dir>/final_info.json как
{metric: {"means": float, "stderrs": float}}.
"""
import argparse
import json
import math
import os
import time

import numpy as np


def make_moons(rng, n=400):
    labels = rng.integers(0, 2, n)
    t = rng.uniform(0, math.pi, n)
    x = np.empty((n, 2))
    m0 = labels == 0
    x[m0, 0], x[m0, 1] = np.cos(t[m0]), np.sin(t[m0])
    x[~m0, 0], x[~m0, 1] = 1 - np.cos(t[~m0]), 0.5 - np.sin(t[~m0])
    return x + rng.normal(0, 0.2, (n, 2)), labels


def train(x, y, lr, steps=400, rng=None):
    w = rng.normal(0, 0.1, x.shape[1] + 1)
    xb = np.column_stack([x, np.ones(len(x))])
    for _ in range(steps):
        p = 1 / (1 + np.exp(-xb @ w))
        g = xb.T @ (p - y) / len(y)
        w -= lr * g
    return w


def evaluate(x, y, w):
    xb = np.column_stack([x, np.ones(len(x))])
    p = np.clip(1 / (1 + np.exp(-xb @ w)), 1e-9, 1 - 1e-9)
    loss = float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))
    acc = float(np.mean((p > 0.5) == y.astype(bool)))
    return loss, acc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out_dir", default="run_0")
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    seed = int(os.environ.get("EXP_SEED", "0"))
    lrs = [0.1, 0.3]
    per_lr = {lr: {"loss": [], "acc": []} for lr in lrs}
    t0 = time.time()
    for trial in range(3):
        rng = np.random.default_rng(1000 * seed + trial)
        x, y = make_moons(rng)
        mid = len(x) // 2
        xtr, ytr, xte, yte = x[:mid], y[:mid], x[mid:], y[mid:]
        for lr in lrs:
            w = train(xtr, ytr, lr, rng=rng)
            loss, acc = evaluate(xte, yte, w)
            tr_loss, _ = evaluate(xtr, ytr, w)
            per_lr[lr]["loss"].append(loss)
            per_lr[lr]["acc"].append(acc)
            print(f"seed={seed} trial={trial} lr={lr}: test_loss={loss:.4f} test_acc={acc:.3f}")
    elapsed = time.time() - t0

    best_lr = max(per_lr, key=lambda lr: float(np.mean(per_lr[lr]["acc"])))
    loss_arr = np.array([v for d in per_lr.values() for v in d["loss"]])
    acc_arr = np.array([v for d in per_lr.values() for v in d["acc"]])
    info = {
        "test_loss": {"means": float(loss_arr.mean()),
                      "stderrs": float(loss_arr.std(ddof=1) / math.sqrt(len(loss_arr)))},
        "test_acc": {"means": float(acc_arr.mean()),
                     "stderrs": float(acc_arr.std(ddof=1) / math.sqrt(len(acc_arr)))},
        "best_lr": {"means": float(best_lr), "stderrs": 0.0},
        "total_train_time": {"means": float(elapsed), "stderrs": 0.0},
    }
    with open(os.path.join(args.out_dir, "final_info.json"), "w") as f:
        json.dump(info, f, indent=2)
    print("wrote", os.path.join(args.out_dir, "final_info.json"), json.dumps(info))


if __name__ == "__main__":
    main()
