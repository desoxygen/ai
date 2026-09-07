# AI-Scientist Beta 0.1 — Complete Documentation

> Single source of truth for the project. Generated 2026-09-06.
> Replaces: AGENTS.md, BETA1_AUDIT.md, BETA1_PLAN.md, BACKLOG.md, EVENTS.md, README-BETA1.md, TUI_REDESIGN.md, TUI_MODERNIZATION.md, docs/UI_IMPROVEMENTS.md

---

## 1. What Is This

**AI-Scientist** is a fully automated research pipeline that generates ideas, runs experiments, writes papers, and reviews them — all powered by LLMs.

**Pipeline stages:** `ideas` → `novelty` → `experiments` → `writeup` → `review`

**Primary interface: TUI** (`opencode-tui/`) — Bun/React terminal dashboard. This is the main user-facing product.

**Supporting interfaces:**
- **REPL** (`aiscientist repl`) — msfconsole-style interactive console (wraps the pipeline, not a standalone product)
- **CLI** (`aiscientist run/status/logs`) — headless mode for scripts and CI

**Key design principle:** The console wraps the existing science (`pipeline.py`, `generate_ideas.py`, `perform_*.py`) without modifying it. Science code is untouchable.

---

## 2. Project Structure

```
AI-Scientist/
├── ai_scientist/
│   ├── console/              # REPL, CLI, modules, events, jobs, i18n
│   │   ├── cli.py            # Entry point (aiscientist command)
│   │   ├── repl.py           # Interactive console (932 lines)
│   │   ├── registry.py       # ModuleRegistry auto-discovery
│   │   ├── jobs.py           # JobRegistry (results/jobs.jsonl)
│   │   ├── events.py         # Event contract (JSON-line)
│   │   ├── config.py         # aiscientist.toml defaults
│   │   ├── i18n.py           # Translations (EN/RU)
│   │   ├── home.py           # Neofetch-style home screen
│   │   └── modules/          # Plugin modules (auto-discovered)
│   │       ├── pipeline/run.py
│   │       ├── auxiliary/env.py
│   │       ├── auxiliary/ideas.py
│   │       ├── auxiliary/models.py
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
├── tests/                    # Test suite (102 tests)
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
# Interactive REPL (recommended)
aiscientist

# Headless CLI
aiscientist run --template nanoGPT_lite --idea adaptive_block_size

# Check status
aiscientist status
```

### Docker

```bash
docker compose build
docker compose run --rm scientist
```

---

## 4. Console (REPL)

The interactive console is the primary interface for researchers.

### Commands

| Command | Description |
|---------|-------------|
| `help [topic]` | Show help (topics: start, modules, run, keys, cli, files) |
| `use <module>` | Select a module (e.g., `use pipeline/run`) |
| `set KEY VALUE` | Set module option |
| `show options` | Display current options |
| `show modules` | List all available modules |
| `run` | Start execution |
| `stop` | Abort running job |
| `jobs` | List all jobs |
| `logs [-f]` | Show events (add `-f` to follow in real-time) |
| `loot` | Browse result artifacts |
| `edit` | Open idea.md in $EDITOR |
| `shell` | Drop to shell in workdir |
| `lang [en\|ru]` | Set or show language |
| `exit` | Quit |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `r` | Run |
| `e` | Edit idea.md |
| `j` | Jobs |
| `!` | Shell |
| `?` | Help |
| `1`-`6` | Open .md files (idea, have, hypothesis, papers, Journal, README) |
| `Tab` | Autocomplete |
| `↑`/`↓` | Command history |

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
| `report/last` | report | Show last run artifacts |

### Language Support

Default language: English. Switch with:
- `lang ru` in REPL
- `--lang ru` CLI flag
- `AISC_LANG=ru` environment variable

---

## 5. CLI Reference

Headless mode for scripts and CI:

```bash
# Run pipeline
aiscientist run --template nanoGPT_lite --stages ideas,novelty,experiments \
  --num-ideas 2 --model openrouter/z-ai/glm-5.2:free

# Check status
aiscientist status

# View events
aiscientist logs -j 5

# Search modules
aiscientist search pipeline

# Set language
aiscientist --lang ru status
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Stage failed |
| `130` | Aborted by user |

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
| `/run <template>` | Start pipeline run |
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
| `system` | Console core (job created, stop, etc.) |

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
| `AISC_LANG` | `en` | Console language: `en`/`ru` |

### Console Config (`aiscientist.toml`)

```toml
default_module = "pipeline/run"
default_template = ""
default_idea = ""
```

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

# Console tests only
python -m pytest tests/test_console_smoke.py -v

# Smoke test
python tests/test_smoke.py
```

### Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `test_console_smoke.py` | 40 | Console imports, registry, jobs, events, config, REPL, CLI, i18n |
| `test_pipeline.py` | 11 | PipelineRunner stages, resume, abort |
| `test_loop_guard.py` | 10 | StageGuard failures, repeats, time budget |
| `test_obsidian_notes.py` | 7 | Note writing, status updates, journal |
| `test_research_quality.py` | 12 | Welch z, sanity check, seed aggregation |
| `test_settings.py` | 7 | .env parsing, mask_secret, vault path |
| `test_llm_and_openrouter.py` | 8 | OpenRouter catalog, JSON extraction |
| `test_control_and_discussion.py` | 3 | Discussion session |
| `test_smoke.py` | 10 | Imports, guard logic, Obsidian notes |

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
- PDF preview in console
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
- Obsidian panels in console

### Future Ideas (Not Commitments)

- Bidirectional sync of jobs.jsonl with Obsidian journal
- Autocomplete for idea/template names in `set`
- Export report to PDF/markdown folder
- Subscribe to guard events as console event stream

---

## 16. Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| `google.generativeai` deprecated | MEDIUM | FutureWarning, will break eventually |
| LaTeX required for writeup/review | LOW | Graceful degradation without it |
| Only 1 template shipped (nanoGPT_lite) | LOW | Others require manual setup |
| No integration tests for perform_* | MEDIUM | Only pipeline-level tests |
| `logs -f` only works in REPL | LOW | Not available in headless CLI |

---

## 17. Architecture Decisions

### Why Not Textual for Console?

1. Current UI doesn't need replacement (REPL is sufficient)
2. MSF metaphor = REPL, not dashboard
3. Textual in repo is disconnected and contains forbidden subsystems (StateManager, EventBus)
4. `prompt_toolkit` + `rich` already in dependencies

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
- Console module plugins
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
