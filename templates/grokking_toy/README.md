# grokking_toy

Groking on modular addition (a + b mod 11) with a tiny MLP — fully
deterministic, CPU-only, no external data. Each run takes ~1 minute.

- `experiment.py` — trains for 20k steps; validation accuracy takes off long
  after memorization (grokking) around step 7k–11k depending on seed.
- Key metrics (`run_i/final_info.json`, flat `{"metric": {"means", "stderrs"}}`):
  `val_acc`, `train_acc`, `steps_to_val_90` (the research target),
  `final_train_loss`, `total_train_time`.
- `run_0/` — committed baseline (grooks at ~9150 ± 1750 steps).
- Ideas: weight-decay sweeps, LR schedules, subset size — anything that
  makes grokking happen sooner.

Run directly: `python experiment.py --out_dir=run_0 && python plot.py`
