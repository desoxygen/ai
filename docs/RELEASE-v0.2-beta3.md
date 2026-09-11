# Release v0.2-beta3 — 2026-09-10

Post-audit hardening of the TUI fork. Everything user-facing from beta 2 still
works; this release closes the gaps found in the full-project audit
(`docs/ANALYSIS.md`) and takes the readiness score from ~80% toward release.

## New

- **Data-driven model roles (plan/code/review)** — nothing hardcoded:
  `model_router.py` ranks live OpenRouter catalog candidates by pricing,
  context, `supported_parameters` and recency with per-role value scores;
  context/price gates; free-only unless `AISC_ALLOW_PAID`. Optional Tavily web
  discovery (`TAVILY_API_KEY`) lifts consensus picks ×1.75 after validating
  every id against the catalog (cache 24h). CLI `--plan-model/--code-model/
  --review-model`, `AISC_MODEL_*` env, `/doctor` shows the resolved table.

- **Two ready-to-run CPU templates** — `grokking_toy` (grokking on modular
  addition) and `parity_transformer` (parity of bit sequences). Both
  deterministic, no external data, ~1 min per run, with a committed
  `run_0/` baseline that uses the flat `{metric: {"means","stderrs"}}`
  contract so the `sanity_check` gate compares directly. `nanoGPT_lite`
  remains (GPU only).
- **`/doctor` model-key cross-check** (Python `env` module + TUI) — the
  default model's provider must have its key, and `ollama/*` is probed for a
  live server, before you burn credits.
- **CI: lint, coverage gate, offline template canary** — `ruff` (E4/E7/E9/F,
  target py311), `pytest --cov-fail-under=55`, and a step that runs each CPU
  template's `experiment.py`/`plot.py` for real on both OSes and Python
  3.11 **and** 3.12.
- **Live canary workflow** (`.github/workflows/live-canary.yml`) — a manual
  `workflow_dispatch` that runs ideas → novelty against a real free OpenRouter
  model; auto-skips when the `OPENROUTER_API_KEY` secret is absent.
- **E2E runbook** (`docs/RUNBOOK-E2E.md`) — the release-gate checklist for a
  full live loop (CI cannot prove it without a paid key + LaTeX).

## Fixed

- **Loop-guard regression** (`perform_experiments`): the repeat signature was
  keyed per run number, so an identical crash repeated across runs never
  escalated. Key is now run-independent.
- **`perform_review` ensemble**: if every ensemble member returned unparsable
  JSON the code crashed on `parsed_reviews[0]` (IndexError). It now degrades to
  a single reviewer.
- **Python 3.11 syntax**: `auxiliary/ideas.py` used a backslash inside f-string
  expressions (3.12-only). Rewritten to a plain constant.
- **Plotting interpreter**: `run_plotting` launched bare `"python"` from PATH
  (a different install without deps on Windows); now uses `sys.executable`,
  matching `run_experiment`.
- **Ruff cleanup**: 25 unused imports/dead locals removed, no behaviour change.

## Deprecated (removal in v1.0)

- `AISC_REVIEW_MIN_SCORE` / `AISC_REVIEW_FIX_ITER`. Use the improve-loop options
  (`IMPROVE` / `IMPROVE_MIN_SCORE` / `IMPROVE_ROUNDS`, or `/improve` in the TUI).
  Setting them now emits a `DeprecationWarning`; behaviour is unchanged until
  1.0. See `docs/MIGRATION.md`.

## Dependencies

- Removed the declared-but-never-imported `google-generativeai` (Gemini already
  runs through its OpenAI-compatible endpoint in `llm.py`).

## QA state

- Live host E2E (Windows, Ollama coder + OpenRouter): ideas ✓, novelty via
  OpenAlex ✓ (429-throttled without S2 key), experiments ✓ (self-healing Aider
  edits, sanity ok, budget guard, plots, run_meta), graceful paper-skip
  without LaTeX ✓ — full numbers and four fixes it surfaced (missing `pyalex`,
  novelty crash on empty search, empty `pip_freeze` in pip-less venvs, stale
  free-model defaults) in `docs/E2E-MEASUREMENTS.md`.
- Python: **159 pytest** (+10 standalone smoke), coverage gate 55% (actual 61.5%), all green.
- TUI: **89 tests** + `tsc --noEmit`, all green.
- Lint: `ruff check` clean (both OS matrix).
- CI: GitHub Actions — Linux + Windows × Python 3.11 + 3.12, plus the offline
  template canary.
- Remaining for the paper loop (`writeup`/`review`/`improve`): verify once via
  Docker or MiKTeX per `docs/RUNBOOK-E2E.md` — host has no LaTeX.

## Upgrade

`git pull && pip install -e .` then run `/doctor` in the TUI. No data
migrations; the deprecated env vars still work for this release.
