# E2E Runbook (release gate)

> The CI proves imports, units, integration and the offline template canary.
> It cannot prove a *full live* research loop (that needs a paid API + LaTeX).
> Before tagging a release, run this checklist **once** on a real machine
> (Docker recommended) and attach the outputs to the release PR.

## 0. Preflight

```bash
cp .env.example .env            # set OPENROUTER_API_KEY (>= 1 provider)
aiscientist                     # open the TUI
```

Type `/doctor`. Expected: no `MISSING`/`WARNING` rows, `pdflatex: OK`,
`aider: OK`, and `pipeline model` shows the key your default model needs.
`baseline: OK` for the template you pick below.

## 1. Fast CPU loop (recommended first pass) — grokking_toy

```
/run grokking_toy
```

Watch the Dashboard drive ideas → novelty → experiments → writeup → review.
Every stage should flip to done; `experiments` runs the committed baseline
plus up to 4 Aider runs (~minutes, CPU). Without LaTeX the `writeup/review`
stages skip with an explanatory log line.

## 2. The improve loop (the headline feature)

Press **A** (auto-improve preset) or type:

```
/improve 6:2
/run grokking_toy
```

A review below 6/10 triggers revise → recompile → re-review. On the Dashboard
you should see a distinct **improve** stage with a `before → after` score.
Verify it lands in the run's `review.txt` and, if you ask for a digest:

```
/report <jobId>
```

## 3. AI skeleton (new-domain path)

```
/new-project          # wizard → step 5/6: AI skeleton? y
```
or `/skeleton my_study`. This must produce `experiment.py` + `plot.py` and a
`run_0` baseline (with one self-heal round) so the new project is immediately
`/run`-able.

## 4. GPU loop (only if you have a GPU) — nanoGPT_lite

Same as step 1 but `/run nanoGPT_lite`. Expects `texlive-full` + `chktex` on
the host (or use the Docker image, which ships them).

## 5. Reproducibility spot-check

Open the finished run folder under `results/grokking_toy/<ts>_<idea>/`:

- `run_meta.json` — model, seeds, `experiment_sha256_16`, pip freeze present;
- `sanity.json` — a verdict (`ok`/`insignificant`/`suspect`), not an error;
- `notes.txt` — every run described.

## What "pass" looks like

Steps 1–3 complete without an unhandled traceback; any guard escalation is
logged with a reason (not silent); the run folder has the artifacts above.
Attach `/report` digest + the last ~40 Dashboard log lines to the release PR.
If anything fails, open a bug with those two dumps.
