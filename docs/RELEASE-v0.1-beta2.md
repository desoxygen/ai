# Release v0.1-beta2 — 2026-09-07

First public beta of the **AI-Scientist TUI**: the automated research
pipeline (ideas → novelty → experiments → writeup → review → improve) behind
exactly **one interface** — the terminal dashboard (`opencode-tui/`).

## Breaking change from beta 1

- **The msfconsole-style REPL is gone.** It duplicated the TUI and split the
  product story. `aiscientist` now always means the TUI; without Bun it
  prints an install hint and exits (no silent fallback). Shared job-execution
  logic lives on in `ai_scientist/console/runner.py`; `config.py`/
  `aiscientist.toml` (REPL defaults) are removed. The headless runner
  (`aiscientist -q run|skeleton|status|logs|search`) remains as **hidden
  debug/CI plumbing** — see [DEBUG.md](DEBUG.md).
- Docker image now ships Bun and builds the TUI (`docker compose run --rm
  scientist` opens the dashboard).
- Fresh installs fixed: `pip install -e .` no longer backtracks into
  unbuildable pre-cp312 sdists (numpy/tiktoken/aiohttp floors).

### Review-driven paper repair (`improve`)
- `PipelineRunner(improvement=True, improve_min_score, improve_rounds)` —
  after a review below the score bar the paper is revised from the
  reviewer's feedback, recompiled and re-reviewed (bounded rounds).
- First-class event stage `improve` with `before`/`after` scores in
  `detail` — visible on the Dashboard and in `/report`.
- Runner options on `pipeline/run`: `IMPROVE`, `IMPROVE_MIN_SCORE`, `IMPROVE_ROUNDS`
  (headless: `aiscientist run --improve --min-score 6 --rounds 2`).
- TUI: `/improve` (picker or `/improve 6:2`), persisted in `state.json`;
  research-menu row **A**; `/run tpl --improve`.
- Legacy `AISC_REVIEW_MIN_SCORE` / `AISC_REVIEW_FIX_ITER` env still works.

### AI project skeleton (`generate/skeleton`)
- The LLM writes a CPU-tiny `experiment.py` (with the `--out_dir` +
  `final_info.json` contract) and `plot.py` from a task description, then
  runs the `run_0` baseline (with one self-heal round) so a brand-new
  project is immediately runnable.
- Headless runner: `aiscientist skeleton --name N --description D [--no-baseline]`.
- TUI: new-project wizard step 5/6 *AI skeleton? y/n*; `/skeleton <project>`
  fills a missing skeleton for existing projects; research-menu row **M**;
  the job is attached to the Agents board like any pipeline run.

## Fixed / hardened

- **Stale running jobs:** the TUI reconciles jobs marked `running` whose
  pid is dead → shown as `aborted` (they used to haunt the dashboard and
  project picker forever).
- **Hermetic tests:** smoke tests redirect `results/`, agent logs and chat
  sessions into throwaway temp dirs (`AISC_RESULTS_DIR` is honoured by both
  the TUI and `ai_scientist.settings`), so local leftovers can no longer
  flip CI. Fixed cross-test cache collisions in the agent event bus.
- **Project picker layout:** long project descriptions no longer wrap the
  project name into two lines (`FuzzyList` truncates at word boundaries).
- `templates/nanoGPT_lite/run_0` baseline is committed again — a fresh
  clone can run `experiments` out of the box (`.gitignore` no longer
  drops `run_0/`).
- `README`/`docs` links to the retired `BACKLOG.md` now point to
  `docs/BETA0.1.md`; version unified to `0.1-beta2`.
- `/doctor` additionally probes `aider`, reports the active auto-improve
  preset and the baseline status of the current project.

## Known limitations (beta)

- Executes LLM-generated code — run inside Docker or another sandbox.
- LaTeX (`pdflatex`, `chktex`) is required for writeup/review; without it
  those stages are skipped automatically.
- Only `nanoGPT_lite` ships ready; `2d_diffusion`/`grokking` need setup.
- `google.generativeai` emits a deprecation FutureWarning.

## QA state

- Python: 107 pytest (+10 standalone smoke), all green (`python -m pytest tests/ -q`).
- TUI: 83 tests + `tsc --noEmit`, all green (`bun test`, `bun run typecheck`).
- CI: GitHub Actions (Linux + Windows) for both suites.

## Install for testers

```bash
git clone <repo-url> && cd AI-Scientist
python -m venv .venv && .venv\Scripts\activate    # Python 3.11+
pip install -e .
cp .env.example .env                              # add OPENROUTER_API_KEY
aiscientist
```
