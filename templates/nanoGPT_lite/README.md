# NanoGPT Lite

Reference research template for the AI-Scientist pipeline. It trains small
character-level language models, so a full experiment finishes in minutes —
that makes it the default target for pipeline smoke tests.

## Files

- `prompt.json` — system persona and task description read by the pipeline
- `seed_ideas.json` — two hand-written seed ideas (the ideas stage expands them)
- `experiment.py` — baseline training run; the pipeline copies it into
  `run_<N>/` folders and applies one idea per run
- `plot.py` — renders result charts after the experiments stage
- `ideas.json` — generated idea records (`Name`, `Title`, `Experiment`, scores)
- `latex/` — ICLR writeup template used by the writeup stage

## Running

```bash
aiscientist run --template nanoGPT_lite
# or from the TUI: select the project (Shift+P) and press Shift+R
```

## Baseline

The unmodified `experiment.py` trains a ~1M-parameter transformer on a tiny
character corpus. `run_0/final_info.json` (written by the experiments stage)
holds the baseline metrics every idea run is compared against.
