# parity_transformer

Parity (XOR of all bits) of length-8 binary sequences with a tiny transformer —
fully deterministic, CPU-only, no external data. Each run takes ~1 minute.

- `experiment.py` — 2-layer/2-head transformer, CLS readout, deliberately tight
  800-step budget (baseline reaches ~0.992 val_acc).
- Key metrics (`run_i/final_info.json`, flat `{"metric": {"means", "stderrs"}}`):
  `val_acc`, `best_val_acc`, `final_train_loss`, `total_train_time`.
- `run_0/` — committed baseline.
- Ideas: pooling variants, length curriculum, minimum depth/heads — anything
  that improves accuracy, speed or sample-efficiency.

Run directly: `python experiment.py --out_dir=run_0 && python plot.py`
