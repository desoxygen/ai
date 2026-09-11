"""Grokking on modular addition — tiny deterministic CPU baseline.

Pipeline contract:
    python experiment.py --out_dir=run_i
writes:
    <out_dir>/final_info.json   {metric: {"means": x, "stderrs": y}}
    <out_dir>/all_results.npy   {"results": {seed: [ {iter, train_loss, train_acc, val_acc}, ... ]}}

Research domain: a small MLP trained on a 70% subset of the (a, b) -> (a+b) mod P
grid famously generalizes *long after* the training set is memorized (grokking).
Ideas modify the optimizer, schedule, architecture or data split and report
when/if validation accuracy takes off.
"""
import argparse
import json
import os
import time

import numpy as np
import torch
import torch.nn as nn

P = 11                    # modulus
TRAIN_FRACTION = 0.7
STEPS = 20000
EVAL_EVERY = 50
BATCH = 64
EMBED = 16
HIDDEN = 128
LR = 3e-3
WEIGHT_DECAY = 1.0
SEEDS = 2                 # internal seeds -> means/stderrs in final_info.json


def make_data(p=P):
    pairs = torch.tensor([(a, b) for a in range(p) for b in range(p)], dtype=torch.long)
    targets = (pairs[:, 0] + pairs[:, 1]) % p
    return pairs, targets


def split(pairs, targets, seed):
    g = torch.Generator().manual_seed(seed)
    perm = torch.randperm(len(pairs), generator=g)
    n_train = int(TRAIN_FRACTION * len(pairs))
    return perm[:n_train], perm[n_train:]


class GrokkingModel(nn.Module):
    def __init__(self, p=P):
        super().__init__()
        self.emb_a = nn.Embedding(p, EMBED)
        self.emb_b = nn.Embedding(p, EMBED)
        self.net = nn.Sequential(
            nn.Linear(2 * EMBED, HIDDEN), nn.ReLU(),
            nn.Linear(HIDDEN, HIDDEN), nn.ReLU(),
            nn.Linear(HIDDEN, p),
        )

    def forward(self, x):
        return self.net(torch.cat([self.emb_a(x[:, 0]), self.emb_b(x[:, 1])], dim=1))


def evaluate(model, pairs, targets, idx):
    model.eval()
    with torch.no_grad():
        logits = model(pairs[idx])
        loss = nn.functional.cross_entropy(logits, targets[idx]).item()
        acc = (logits.argmax(-1) == targets[idx]).float().mean().item()
    model.train()
    return loss, acc


def train_one(seed):
    torch.manual_seed(seed)
    device = "cpu"
    pairs, targets = make_data()
    train_idx, val_idx = split(pairs, targets, seed)
    model = GrokkingModel().to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    curve = []
    t0 = time.time()
    for step in range(STEPS + 1):
        if step % EVAL_EVERY == 0:
            train_loss, train_acc = evaluate(model, pairs, targets, train_idx)
            _, val_acc = evaluate(model, pairs, targets, val_idx)
            curve.append({"iter": step, "train_loss": train_loss,
                          "train_acc": train_acc, "val_acc": val_acc})
        idx = train_idx[torch.randint(len(train_idx), (BATCH,), generator=torch.Generator().manual_seed(seed * 100003 + step))]
        opt.zero_grad()
        loss = nn.functional.cross_entropy(model(pairs[idx]), targets[idx])
        loss.backward()
        opt.step()
    elapsed = time.time() - t0
    _, train_acc = evaluate(model, pairs, targets, train_idx)
    _, val_acc = evaluate(model, pairs, targets, val_idx)
    steps_to_90 = -1.0
    for row in curve:
        if row["val_acc"] >= 0.9:
            steps_to_90 = float(row["iter"])
            break
    return curve, {"val_acc": val_acc, "train_acc": train_acc,
                   "steps_to_val_90": steps_to_90,
                   "final_train_loss": curve[-1]["train_loss"],
                   "total_train_time": elapsed}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Grokking toy experiment")
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
