"""Parity (XOR of all bits) with a tiny transformer — deterministic CPU baseline.

Pipeline contract:
    python experiment.py --out_dir=run_i
writes:
    <out_dir>/final_info.json   {metric: {"means": x, "stderrs": y}}
    <out_dir>/all_results.npy   {"curves": {seed: [ {iter, train_loss, val_acc}, ... ]}}

Research domain: parity of length-L bit sequences is the canonical test of whether
a transformer actually uses attention (MLPs cannot scale). Ideas modify depth,
heads, pooling, curriculum or the training budget and report validation accuracy
of the fixed 4096-example holdout.
"""
import argparse
import json
import os
import time

import numpy as np
import torch
import torch.nn as nn

SEQ_LEN = 8
D_MODEL = 64
N_HEADS = 2
N_LAYERS = 2
STEPS = 800
EVAL_EVERY = 50
BATCH = 256
VAL_SIZE = 4096
LR = 1e-3
SEEDS = 2


class ParityTransformer(nn.Module):
    def __init__(self):
        super().__init__()
        self.token = nn.Embedding(2, D_MODEL)
        self.pos = nn.Embedding(SEQ_LEN, D_MODEL)
        block = nn.TransformerEncoderLayer(
            d_model=D_MODEL, nhead=N_HEADS, dim_feedforward=2 * D_MODEL,
            batch_first=True, activation="relu")
        self.encoder = nn.TransformerEncoder(block, N_LAYERS)
        self.cls = nn.Parameter(torch.zeros(1, 1, D_MODEL))
        self.head = nn.Linear(D_MODEL, 2)

    def forward(self, x):
        b, t = x.shape
        h = self.token(x) + self.pos(torch.arange(t, device=x.device))
        h = torch.cat([self.cls.expand(b, -1, -1), h], dim=1)
        h = self.encoder(h)
        return self.head(h[:, 0])


def sample(n, gen, device="cpu"):
    x = torch.randint(0, 2, (n, SEQ_LEN), generator=gen).to(device)
    y = x.sum(dim=1) % 2
    return x, y


def train_one(seed):
    torch.manual_seed(seed)
    gen = torch.Generator().manual_seed(seed)
    model = ParityTransformer()
    opt = torch.optim.AdamW(model.parameters(), lr=LR)
    val_x, val_y = sample(VAL_SIZE, gen)
    curve = []
    t0 = time.time()
    for step in range(STEPS + 1):
        if step % EVAL_EVERY == 0:
            model.eval()
            with torch.no_grad():
                acc = (model(val_x).argmax(-1) == val_y).float().mean().item()
            model.train()
            curve.append({"iter": step, "train_loss": float("nan"), "val_acc": acc})
        bx, by = sample(BATCH, gen)
        opt.zero_grad()
        loss = nn.functional.cross_entropy(model(bx), by)
        loss.backward()
        opt.step()
        curve[-1]["train_loss"] = loss.item()
    elapsed = time.time() - t0
    final_val = curve[-1]["val_acc"]
    return curve, {"val_acc": final_val,
                   "best_val_acc": max(c["val_acc"] for c in curve),
                   "final_train_loss": curve[-1]["train_loss"],
                   "total_train_time": elapsed}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Parity transformer experiment")
    parser.add_argument("--out_dir", type=str, default="run_0")
    args = parser.parse_args()
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    base_seed = int(os.environ.get("AISC_SEED", "0"))
    results, curves = {}, {}
    for i in range(SEEDS):
        seed = base_seed * 1000 + i
        curve, final = train_one(seed)
        curves[f"seed_{seed}"] = curve
        results[f"seed_{seed}"] = final
        print(f"seed {seed}: {final}")

    keys = list(next(iter(results.values())).keys())
    final_info = {}
    for k in keys:
        vals = [r[k] for r in results.values()]
        final_info[k] = {
            "means": float(np.mean(vals)),
            "stderrs": float(np.std(vals, ddof=1) / np.sqrt(len(vals))) if len(vals) > 1 else 0.0,
        }
    with open(os.path.join(out_dir, "final_info.json"), "w") as f:
        json.dump(final_info, f, indent=4)
    with open(os.path.join(out_dir, "all_results.npy"), "wb") as f:
        np.save(f, {"curves": curves, "final": results}, allow_pickle=True)
    print(json.dumps(final_info, indent=4))
