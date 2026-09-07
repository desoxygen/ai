# AI-Scientist Beta 0.1 — Complete Documentation

> Single source of truth for the project. Generated 2026-09-06; updated 2026-09-07 for **v0.1-beta2**
> (TUI is now the **only** interface — the REPL was removed; improve loop, generate/skeleton,
> `AISC_RESULTS_DIR`, hermetic tests). Release notes: `docs/RELEASE-v0.1-beta2.md`; hidden runner: `docs/DEBUG.md`.
> Replaces: AGENTS.md, BETA1_AUDIT.md, BETA1_PLAN.md, BACKLOG.md, EVENTS.md, README-BETA1.md, TUI_REDESIGN.md, TUI_MODERNIZATION.md, docs/UI_IMPROVEMENTS.md

---

## 1. What Is This

**AI-Scientist** is a fully automated research pipeline that generates ideas, runs experiments, writes papers, and reviews them — all powered by LLMs.

**Pipeline stages:** `ideas` → `novelty` → `experiments` → `writeup` → `review` (+ optional `improve` loop: revise paper from reviewer feedback and re-review)

**The only interface: the TUI** (`opencode-tui/`) — a Bun/React terminal dashboard. This is the sole user-facing product; bare `aiscientist` launches it.

**Not an interface — backend plumbing:** a headless runner (`aiscientist -q run|skeleton|status|logs|search`) that the TUI spawns and CI/scripts reuse. The msfconsole-style REPL that shipped in beta 1 was removed in beta 2 (it duplicated the TUI and confused the product story). Runner details live in [DEBUG.md](DEBUG.md), not in user docs.

**Key design principle:** The runner wraps the existing science (`pipeline.py`, `generate_ideas.py`, `perform_*.py`) without modifying it. Science code is untouchable.

---

## 2. Project Structure

```
AI-Scientist/
├── ai_scientist/
│   ├── console/              # headless runner: entry, modules, events, jobs, i18n
│   │   ├── cli.py            # Entry point (aiscientist command → TUI; -q → headless)
│   │   ├── runner.py         # Shared execute_job/format_event (no interactive UI)
│   │   ├── registry.py       # ModuleRegistry auto-discovery
│   │   ├── jobs.py           # JobRegistry (results/jobs.jsonl)
│   │   ├── events.py         # Event contract (JSON-line)
│   │   ├── i18n.py           # Translations (EN/RU) for runner/module messages
│   │   └── modules/          # Plugin modules (auto-discovered)
│   │       ├── pipeline/run.py
│   │       ├── auxiliary/env.py
│   │       ├── auxiliary/ideas.py
│   │       ├── auxiliary/models.py
│   │       ├── generate/skeleton.py
│   │       └── report/last.py
│   ├── pipeline.py           # PipelineRunner (575 lines)
│   ├── generate_ideas.py     # Idea generation + novelty check
│   ├── perform_experiments.py # Experiment execution via Aider
│   ├── perform_writeup.py    # Paper writing via Aider + LaTeX
│   ├── perform_review.py     # LLM-based review
│   ├── llm.py                # Multi-provider LLM client
│   ├── openrouter.py         # OpenRouter model catalog
│   ├── settings.py           # .env, GuardLimits, vault resolution
│   ├── loop_guard.py         # StageGuard, RunAborted, LLM gate
│   ├── research_quality.py   # Sanity checks, learnings, run_meta
│   └── obsidian_notes.py     # Obsidian vault integration
├── opencode-tui/             # Bun/React TUI (57 source files)
├── templates/                # Research templates
│   └── nanoGPT_lite/         # Included template
├── results/                  # Run artifacts + job logs
├── tests/                    # Test suite (107 pytest + standalone smoke)
├── pyproject.toml            # Package config (aiscientist entry point)
├── requirements.txt          # Python dependencies
├── Dockerfile                # Docker support
├── .env.example              # Environment template
└── docs/                     # Additional documentation
```

---

## 3. Quick Start

### Install

```bash
git clone <repo-url>
cd AI-Scientist
pip install -e .
```

### Configure

```bash
cp .env.example .env
# Edit .env — set at least one API key:
# OPENROUTER_API_KEY=sk-or-...
# AISC_DEFAULT_MODEL=openrouter/z-ai/glm-5.2:free
```

### Run

```bash
# Open the TUI — the only interface there is
aiscientist
```

CI and debugging can bypass the TUI through the hidden headless runner
(`aiscientist -q run|skeleton|status|logs`) — see [DEBUG.md](DEBUG.md).

### Docker

```bash
docker compose build
docker compose run --rm scientist
```

---

## 4. Modules & Runner

There is **no interactive console to learn** — the TUI is the only interface. This section documents the module system that both the TUI and the headless runner drive (runner details: [DEBUG.md](DEBUG.md)).

### Module System

Modules are auto-discovered from `ai_scientist/console/modules/`. Each module exports:

```python
MANIFEST = {
    "type": "pipeline",           # auxiliary|generate|pipeline|review|report
    "description": "...",
    "options": {
        "KEY": {"required": True, "type": "str", "default": ""},
    },
}

def run(options, job, emit, stop_event=None) -> dict:
    # Module logic here
    return {"ok": True}
```

**Available modules:**

| Module | Type | Purpose |
|--------|------|---------|
| `pipeline/run` | pipeline | Run full pipeline |
| `auxiliary/env` | auxiliary | Check environment |
| `auxiliary/ideas` | auxiliary | List template ideas |
| `auxiliary/models` | auxiliary | Browse LLM models |
| `generate/skeleton` | generate | AI-generated project skeleton (experiment.py + plot.py + baseline) |
| `report/last` | report | Show last run artifacts |

**`pipeline/run` options:** `TEMPLATE`, `MODEL`, `IDEA`, `NUM_IDEAS`, `NUM_REFLECTIONS`, `STAGES`, `ENGINE`, plus `IMPROVE` (`on`/`off`), `IMPROVE_MIN_SCORE`, `IMPROVE_ROUNDS` to enable the review-driven paper-repair loop.

### Language Support

Default language: English. Switch with:
- `--lang ru` flag (headless runner)
- `AISC_LANG=ru` environment variable

---

## 5. Headless Runner (debug / CI only)

The headless runner is **not a user interface** — it is the backend the TUI
spawns. Full command list, exit codes and internals are documented in
[DEBUG.md](DEBUG.md). Users only ever run `aiscientist` (the TUI).

---

## 6. TUI (Terminal Dashboard)

A rich terminal UI built with Bun + React:

```bash
cd opencode-tui
bun install
bun run start
```

### Workspaces (1-6)

| # | Workspace | Purpose |
|---|-----------|---------|
| 1 | Dashboard | Job status, progress, live log |
| 2 | Chat | LLM conversation, agent delegation |
| 3 | Explorer | File tree, code preview |
| 4 | Notes | Ideas browser, Obsidian notes |
| 5 | Agents | Background LLM workers |
| 6 | Article | Paper reader (LaTeX → ANSI) |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/run <template>` | Start pipeline run (honors `/improve`) |
| `/improve [off\|on\|min:rounds]` | Configure the review→repair→re-review loop |
| `/skeleton <project>` | Generate an AI skeleton (experiment.py + plot.py + baseline) |
| `/new-project` | Create new project |
| `/init` | Generate AGENTS.md |
| `/delegate <task>` | Spawn background worker |
| `/doctor` | Environment check |

### Keyboard

| Key | Action |
|-----|--------|
| `1`-`6` | Switch workspace |
| `ctrl+p` | Command palette |
| `ctrl+x` then key | Leader key shortcuts |
| `Shift+R` | Quick run |
| `Shift+N` | New project |
| `Shift+D` | Dashboard |

---

## 7. Pipeline Architecture

### PipelineRunner

**File:** `ai_scientist/pipeline.py` (575 lines)

```python
PipelineRunner(template, model, num_ideas=5, num_reflections=3,
               engine="semanticscholar", stages=None, run_id="",
               emit=None, stop_event=None, idea_filter="")
```

### Stage Flow

```
PipelineRunner.run()
  ├── stage_ideas()          → generate_ideas.py
  ├── stage_novelty(ideas)   → check_idea_novelty()
  └── for each idea:
        run_idea(idea)
          ├── copy template to results/
          ├── write_run_meta()
          ├── stage_experiments()  → perform_experiments.py (Aider)
          ├── stage_writeup()      → perform_writeup.py (Aider + LaTeX)
          ├── stage_review()       → perform_review.py (LLM ensemble)
          └── append_learning()
```

### Stage Details

| Stage | What It Does | Time |
|-------|--------------|------|
| `ideas` | LLM generates research ideas | 1-5 min |
| `novelty` | Check ideas against literature (Semantic Scholar) | 1-3 min |
| `experiments` | Aider modifies experiment.py, runs training | 10-60 min |
| `writeup` | Aider writes LaTeX paper | 5-15 min |
| `review` | LLM ensemble reviews paper | 2-5 min |

### Guard System

Every stage is wrapped with `StageGuard`:
- Tracks failures, repeats, time budgets
- Interactive mode: asks user on limit
- Headless mode: skip or abort (configurable)
- `RunAborted` (BaseException) propagates up cleanly

---

## 8. Event Contract

Events are JSON-line records in `results/events/<job_id>.jsonl`.

### Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ts` | string | yes | ISO-8601 timestamp |
| `run_id` | string | yes | Run identifier |
| `idea_id` | string | yes | Idea name (empty for pre-idea stages) |
| `module` | string | yes | Module name |
| `stage` | string | yes | Stage name |
| `status` | string | yes | `started` \| `log` \| `done` \| `fail` |
| `message` | string | yes | Human-readable message |
| `job_id` | int | no | Job ID |
| `template` | string | no | Template name |
| `model` | string | no | Model name |
| `detail` | object | no | Structured additional info |

### Stage Values

| Stage | Source |
|-------|--------|
| `run` | Wrapper around `PipelineRunner.run()` |
| `ideas` | `PipelineRunner.stage_ideas` |
| `novelty` | `PipelineRunner.stage_novelty` |
| `experiments` | `PipelineRunner.stage_experiments` |
| `writeup` | `PipelineRunner.stage_writeup` |
| `review` | `PipelineRunner.stage_review` |
| `improve` | review→revise→re-review loop inside `stage_review` (detail: `before`/`after` score) |
| `skeleton` | `generate/skeleton` module (AI project skeleton + baseline run) |
| `system` | Runner core (job created, stop, etc.) |

### Status Semantics

- `started` — stage began (guaranteed once before first `log`)
- `log` — intermediate output (any number, including zero)
- `done` — stage completed successfully (closes `started`)
- `fail` — stage failed (closes `started`; always → non-zero exit code in CLI)

Rules:
1. Each `started` is always followed by `done` or `fail` (pairing)
2. `fail` must include reason in `detail.error`
3. `message` — no secrets, truncated to 2000 chars
4. Each line is valid JSON

---

## 9. Configuration

### Environment Variables (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | — | API key for OpenRouter |
| `OPENAI_API_KEY` | — | API key for OpenAI |
| `ANTHROPIC_API_KEY` | — | API key for Anthropic |
| `AISC_DEFAULT_MODEL` | `openrouter/z-ai/glm-5.2:free` | Default LLM model |
| `AISC_DISCUSS_MODEL` | — | Model for discussions |
| `AISC_REVIEW_MODEL` | — | Model for reviews |
| `OBSIDIAN_VAULT_PATH` | — | Path to Obsidian vault |
| `AISC_SEED` | — | RNG seed for reproducibility |
| `AISC_EXP_SEEDS` | — | Comma-separated seeds for multi-seed runs |
| `AISC_LLM_MAX_TRIES` | `8` | Max LLM retries per stage |
| `AISC_STAGE_MAX_FAILURES` | `3` | Max consecutive failures before skip |
| `AISC_MAX_STAGE_MINUTES` | `0` | Time limit per stage (0 = unlimited) |
| `AISC_INTERACTIVE` | `auto` | Interactive mode: `auto`/`yes`/`no` |
| `AISC_ON_LIMIT` | `ask` | Action on limit: `ask`/`continue`/`skip`/`abort` |
| `AISC_LANG` | `en` | Runner/UI language: `en`/`ru` |
| `AISC_RESULTS_DIR` | `results/` | Redirect all artifacts (jobs/events/results) — tests + sandboxes |
| `AISC_REVIEW_MIN_SCORE` | `0` | Legacy: auto-repair papers below this score (0=off) |
| `AISC_REVIEW_FIX_ITER` | `0` | Legacy: max repair rounds (0=off) |
| `AISC_SKELETON_TIMEOUT_MIN` | `20` | generate/skeleton baseline run_0 timeout (minutes) |

### Guard Limits

The `StageGuard` system protects against runaway loops:

- `llm_max_tries` — LLM retry limit per call
- `stage_max_failures` — consecutive failures before skip
- `max_repeat_signatures` — identical output detection
- `interactive` — ask user vs auto-decide
- `on_limit` — what to do when limit hit
- `extend_by` — extra budget when user says "continue"

---

## 10. Models

Supported via `AISC_DEFAULT_MODEL`:

| Provider | Examples |
|----------|----------|
| OpenRouter | `openrouter/z-ai/glm-5.2:free` |
| OpenAI | `openai/gpt-4o` |
| Anthropic | `anthropic/claude-sonnet-4-20250514` |
| DeepSeek | `deepseek/deepseek-chat` |
| Google | `google/gemini-2.0-flash-001` |
| Local | `ollama/qwen2.5-coder:7b-instruct-q4_K_M` |

### Model Routing

`llm.py:create_client(model)` dispatches by prefix:
- `openrouter/` → OpenAI client with OpenRouter base URL
- `ollama/` → OpenAI client with localhost:11434
- `claude-*` → Anthropic client
- `gpt-*`, `o1-*`, `o3-*` → OpenAI client
- `deepseek-*` → DeepSeek API
- `gemini-*` → Google via OpenAI-compat

### OpenRouter Catalog

`openrouter.py` provides:
- `list_models()` — fetch and cache model list
- `free_models()` — filter free models
- `search(query)` — search by name/id
- `default_model()` — auto-select best free model

---

## 11. Templates

Each template defines a research domain.

### Template Structure

```
templates/<name>/
├── experiment.py          # Experiment code (LLM modifies this)
├── plot.py                # Visualization script
├── prompt.json            # System + task description for LLM
├── seed_ideas.json        # Example ideas for bootstrapping
├── ideas.json             # Generated ideas (created by pipeline)
├── learnings.md           # Knowledge base (appended after each run)
└── latex/
    ├── template.tex       # Paper template
    └── references.bib     # Bibliography
```

### Included Template

**nanoGPT_lite** — transformer training on text data.

### Template File Purposes

| File | Purpose |
|------|---------|
| `experiment.py` | Code that LLM modifies. Must accept `--out_dir` and save `final_info.json` |
| `prompt.json` | `{"system": "...", "task_description": "..."}` — tells LLM what to research |
| `seed_ideas.json` | `[{"Name": "...", "Title": "...", "Experiment": "...", "Interestingness": N, "Feasibility": N, "Novelty": N}]` |
| `latex/template.tex` | NeurIPS-style paper template |

### Creating Custom Templates

1. Create `templates/<name>/` directory
2. Add `experiment.py` that accepts `--out_dir` and saves `final_info.json`
3. Add `prompt.json` with system prompt and task description
4. Add `seed_ideas.json` with 3-5 example ideas
5. Add `latex/template.tex` for paper generation

---

## 12. Testing

### Run Tests

```bash
# All tests
python -m pytest tests/ -q

# With coverage
python -m pytest tests/ --cov=ai_scientist

# Runner tests only
python -m pytest tests/test_console_smoke.py -v

# Smoke test
python tests/test_smoke.py
```

### Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `test_console_smoke.py` | 34 | Runner imports/execute_job, registry, jobs, events, CLI dispatch, i18n |
| `test_pipeline.py` | 16 | PipelineRunner stages, resume, abort, improve loop, option wiring |
| `test_loop_guard.py` | 10 | StageGuard failures, repeats, time budget |
| `test_obsidian_notes.py` | 8 | Note writing, status updates, journal |
| `test_research_quality.py` | 15 | Welch z, sanity check, seed aggregation |
| `test_settings.py` | 7 | .env parsing, mask_secret, vault path |
| `test_llm_and_openrouter.py` | 8 | OpenRouter catalog, JSON extraction |
| `test_skeleton.py` | 6 | generate/skeleton: files, baseline, self-heal, validation |
| `test_control_and_discussion.py` | 3 | Discussion session |
| `test_smoke.py` | 10 | Imports, guard logic, Obsidian notes (standalone) |

### CI

GitHub Actions runs on push/PR:
- **Python job:** `pip install -r requirements.txt pytest` → `pytest tests/`
- **TUI job:** `bun install` → `bun run typecheck` → `bun test`

---

## 13. Docker

```bash
# Build
docker compose build

# Run interactive
docker compose run --rm scientist

# Run headless
docker compose run --rm scientist run --template nanoGPT_lite --stages ideas

# Run tests
docker compose run --rm --entrypoint python scientist -m pytest tests/
```

### Dockerfile

- Based on `python:3.11-slim`
- Includes: git, nano, LaTeX suite (texlive), chktex
- CPU-only PyTorch by default (GPU via build arg)
- ENTRYPOINT: `python -m ai_scientist.console.cli`

---

## 14. File Layout

```
results/
├── jobs.jsonl                          # Job records
├── events/<job_id>.jsonl               # Per-job event logs
├── guard_events.jsonl                  # Guard system events
├── openrouter_models.json              # Cached model catalog
├── agents/task-<id>.jsonl              # Delegate worker logs
└── <template>/<ts>_<idea_name>/        # Run artifacts
    ├── run_meta.json                   # Reproducibility snapshot
    ├── sanity.json                     # Baseline sanity verdict
    ├── notes.txt                       # Research notes
    ├── review.txt                      # Review scores
    ├── <idea_name>.pdf                 # Generated paper
    ├── experiment.py                   # Modified experiment code
    ├── plot.py                         # Modified plotting code
    ├── run_0/                          # Baseline
    │   └── final_info.json             # Baseline metrics
    ├── run_1/                          # First experiment
    │   ├── final_info.json
    │   └── run_1.py
    └── latex/                          # Paper source
        ├── template.tex
        └── references.bib
```

---

## 15. Backlog (Post-Beta)

### Explicitly Deferred

- Textual dashboards
- Daemon / background service
- Multi-GPU parallelism
- Citation graph / visualization
- PDF preview in TUI
- Literature-agent (autonomous)
- "Auto-discovery" (promising new results)
- Built-in IDE
- Hermes integration
- OpenCode / MCP runtime integration

### From Beta Plan (Consciously Deferred)

- Review pipeline as separate stage with new controls
- Full interactive model/template picker (questionary menus)
- Resume run as separate module
- Parallel jobs in one process
- Obsidian panels in TUI

### Future Ideas (Not Commitments)

- Bidirectional sync of jobs.jsonl with Obsidian journal
- Autocomplete for idea/template names in `set`
- Export report to PDF/markdown folder
- Subscribe to guard events as a TUI event stream

---

## 16. Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| `google.generativeai` deprecated | MEDIUM | FutureWarning, will break eventually |
| LaTeX required for writeup/review | LOW | Graceful degradation without it |
| Only 1 template shipped (nanoGPT_lite) | LOW | Others require manual setup |
| No integration tests for perform_* | MEDIUM | Only pipeline-level tests |
| Live log follow is TUI-only | LOW | The headless runner prints a flat event dump (no `-f`) |

---

## 17. Architecture Decisions

### Why one interface (the TUI), and no REPL/Textual layer?

1. Two terminal UIs (REPL + dashboard) confused users about what the product *is*; the REPL was removed in beta 2.
2. The TUI dashboard already covers jobs, logs, follow, explorer, notes and article in one place.
3. Textual in the tree is disconnected and carries forbidden subsystems (StateManager, EventBus).
4. The Python layer stays pure plumbing (runner + modules) so CI and the TUI share one execution path.

### Why Templates?

Templates define scientific domains. Without them:
- LLM has no context for idea generation
- No experiment code to modify
- No baseline to compare against
- No paper template to write in

### Why Aider for Experiments?

Aider generates SEARCH/REPLACE diffs, not full file writes. This is better for:
- Modifying existing code (experiment.py)
- Preserving structure while changing logic
- Handling merge conflicts with original code

---

## 18. Contributing

See the Backlog section above for planned features. Areas welcome:
- New research templates
- Runner module plugins
- Additional model integrations
- Documentation improvements
- Test coverage improvements

---

## 19. License

**The AI Scientist Source Code License** (derivative of Responsible AI License).

**Mandatory:** Clearly disclose AI use in any resulting publications:
> "This manuscript was autonomously generated using [The AI Scientist](https://github.com/SakanaAI/AI-Scientist)."

---

## 20. Citing

```bibtex
@article{lu2024aiscientist,
  title={The {AI} {S}cientist: Towards Fully Automated Open-Ended Scientific Discovery},
  author={Lu, Chris and Lu, Cong and Lange, Robert Tjarko and Foerster, Jakob and Clune, Jeff and Ha, David},
  journal={arXiv preprint arXiv:2408.06292},
  year={2024}
}
```
