<h1 align="center">
  <a href="https://github.com/SakanaAI/AI-Scientist/blob/main/docs/logo_2.png">
    <img src="docs/logo_2.png" width="215" /></a><br>
  <b>The AI Scientist</b><br>
  <b>Automated Scientific Discovery Console</b><br>
</h1>

<p align="center">
  <a href="https://arxiv.org/abs/2408.06292">Paper</a> |
  <a href="https://sakana.ai/ai-scientist/">Blog</a> |
  <a href="#quickstart">Quickstart</a> |
  <a href="#cli-reference">CLI Reference</a>
</p>

---

## What is this?

**The AI Scientist** is a fully automated research pipeline that generates ideas, runs experiments, writes papers, and reviews them — all powered by LLMs.

This fork adds a **console interface** (`aiscientist`) with an interactive REPL, a terminal UI (TUI), and a headless CLI for running the pipeline without manual supervision.

**Pipeline stages:** `ideas` → `novelty` → `experiments` → `writeup` → `review` — plus an optional **improve** loop (revise the paper from reviewer feedback and re-review) and an **AI skeleton** generator for new research projects.

---

## Quickstart

### 1. Install

```bash
git clone <repo-url>
cd AI-Scientist

# Python 3.11+ required
pip install -e .
```

This installs the `aiscientist` command and all dependencies.

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` — set at least one API key:

```
OPENROUTER_API_KEY=sk-or-...
AISC_DEFAULT_MODEL=openrouter/z-ai/glm-5.2:free
```

Optional: set `OBSIDIAN_VAULT_PATH` for research journal integration.

### 3. Run

```bash
# Interactive console — TUI (falls back to the REPL if bun is missing)
aiscientist

# Or headless
aiscientist run --template nanoGPT_lite --idea adaptive_block_size

# Check status
aiscientist status
```

That's it. The REPL will guide you through module selection, option tuning, and execution.

---

## Installation Options

### pip (recommended)

```bash
pip install -e .
```

Provides the `aiscientist` entry point.

### Docker

```bash
cp .env.example .env   # fill in keys
docker compose build
docker compose run --rm scientist
```

### Manual (without install)

```bash
python -m ai_scientist.console.cli
```

### LaTeX (optional, for paper generation)

```bash
# Ubuntu/Debian
sudo apt-get install texlive-full chktex

# macOS
brew install --cask mactex
```

Without LaTeX, experiments run but writeup/review stages are skipped.

---

## Console (REPL)

The interactive console is the primary interface:

```
aiscientist > _
```

### Core Commands

| Command | Description |
|---------|-------------|
| `help [topic]` | Show help (topics: start, modules, run, keys, cli, files) |
| `use <module>` | Select a module (e.g., `use pipeline/run`) |
| `set KEY VALUE` | Set module option (e.g., `set TEMPLATE nanoGPT_lite`) |
| `show options` | Display current options |
| `run` | Start execution |
| `stop` | Abort running job |
| `jobs` | List all jobs |
| `logs [-f]` | Show events (add `-f` to follow in real-time) |
| `loot` | Browse result artifacts |
| `edit` | Open idea.md in $EDITOR |
| `shell` | Drop to shell in workdir |
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

### Modules

| Module | Purpose |
|--------|---------|
| `pipeline/run` | Run full pipeline (ideas → experiments → writeup → review) |
| `generate/skeleton` | AI-generated project skeleton (experiment.py + plot.py + baseline) |
| `auxiliary/env` | Check environment (API keys, LaTeX, vault) |
| `auxiliary/ideas` | List generated ideas for a template |
| `auxiliary/models` | Browse LLM models |
| `report/last` | Show artifacts from the last run |

---

## CLI Reference

Headless mode for scripts and CI:

```bash
# Run pipeline
aiscientist run --template nanoGPT_lite --stages ideas,novelty,experiments \
  --num-ideas 2 --model openrouter/z-ai/glm-5.2:free

# Run with the review→repair→re-review improve loop
aiscientist run --template nanoGPT_lite --idea adaptive_block_size \
  --improve --min-score 6 --rounds 2

# Generate an AI skeleton for a brand-new research project
aiscientist skeleton --name my_study --description "Compare LR schedules on a tiny transformer"

# Check status
aiscientist status

# View events
aiscientist logs -j 5

# Search modules
aiscientist search pipeline
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Stage failed |
| `130` | Aborted by user |

---

## TUI (Terminal Dashboard)

A rich terminal UI built with Bun + React:

```bash
cd opencode-tui
bun install
bun run start
```

Features: Dashboard, Chat, Explorer, Notes, Agents, Article viewer. Slash commands include `/run`, `/improve`, `/skeleton`, `/new-project` (with a 6th step that generates a runnable AI skeleton), `/doctor`.

Requires [Bun](https://bun.sh) installed on your system.

---

## Configuration

### Environment Variables (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | — | API key for OpenRouter models |
| `AISC_DEFAULT_MODEL` | `openrouter/z-ai/glm-5.2:free` | Default LLM model |
| `AISC_DISCUSS_MODEL` | — | Model for discussions (falls back to default) |
| `AISC_REVIEW_MODEL` | — | Model for reviews (falls back to default) |
| `OBSIDIAN_VAULT_PATH` | — | Path to Obsidian vault for journal |
| `AISC_SEED` | — | RNG seed for reproducibility |
| `AISC_EXP_SEEDS` | — | Comma-separated seeds for multi-seed runs |
| `AISC_LLM_MAX_TRIES` | `8` | Max LLM retries per stage |
| `AISC_STAGE_MAX_FAILURES` | `3` | Max consecutive failures before skip |
| `AISC_MAX_STAGE_MINUTES` | `0` | Time limit per stage (0 = unlimited) |
| `AISC_INTERACTIVE` | `auto` | Interactive mode: `auto`/`yes`/`no` |

### Console Config (`aiscientist.toml`)

```toml
default_module = "pipeline/run"
default_template = "nanoGPT_lite"
default_idea = ""
```

---

## Templates

The pipeline works with research templates in `templates/`:

| Template | Domain |
|----------|--------|
| `nanoGPT_lite` | Transformer training (included) |
| `2d_diffusion` | Diffusion models (setup required) |
| `grokking` | Neural network generalization (setup required) |

### Setting Up Additional Templates

```bash
# 2D Diffusion
git clone https://github.com/gregversteeg/NPEET.git
cd NPEET && pip install . && cd ..
cd templates/2d_diffusion
python experiment.py --out_dir run_0
python plot.py

# Grokking
pip install einops
cd templates/grokking
python experiment.py --out_dir run_0
python plot.py
```

### Creating Custom Templates

Create a directory under `templates/` with:

- `experiment.py` — Main experiment script (takes `--out_dir`)
- `plot.py` — Plotting script
- `prompt.json` — System + task description for the LLM
- `seed_ideas.json` — Example ideas
- `latex/template.tex` — Paper template

---

## Safety

> **Warning:** This codebase executes LLM-generated code. Use in a sandboxed environment.

```bash
# Run in Docker with restricted network
docker compose run --rm scientist
```

- Loop guard prevents runaway executions
- Stage failures auto-skip with configurable thresholds
- Interactive mode asks before continuing on errors

---

## Models

Supported via `AISC_DEFAULT_MODEL`:

| Provider | Examples |
|----------|----------|
| OpenRouter | `openrouter/z-ai/glm-5.2:free` |
| OpenAI | `openai/gpt-4o` |
| Anthropic | `anthropic/claude-sonnet-4-20250514` |
| DeepSeek | `deepseek/deepseek-chat` |
| Google | `google/gemini-2.0-flash-001` |
| Local | `ollama/qwen2.5-coder:7b-instruct-q4_K_M` |

See `ai_scientist/llm.py` for the full list.

---

## Project Structure

```
AI-Scientist/
├── ai_scientist/
│   ├── console/          # REPL, CLI, modules, events, jobs
│   │   ├── cli.py        # Entry point
│   │   ├── repl.py       # Interactive console
│   │   ├── modules/      # Plugin modules
│   │   └── ...
│   ├── pipeline.py       # Core pipeline runner
│   ├── generate_ideas.py # Idea generation
│   ├── perform_experiments.py
│   ├── perform_writeup.py
│   ├── perform_review.py
│   └── settings.py       # Configuration
├── opencode-tui/         # Bun/React TUI
├── templates/            # Research templates
├── results/              # Run artifacts + job logs
├── tests/                # Test suite
├── pyproject.toml
├── requirements.txt
├── Dockerfile
└── .env.example
```

---

## Testing

```bash
# Run all tests
python -m pytest tests/ -q

# With coverage
python -m pytest tests/ --cov=ai_scientist

# Smoke test
python tests/test_smoke.py
```

---

## Docker

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

Edit `docker-compose.yml` to mount your Obsidian vault (see comments in file).

---

## Beta Testing

This is **v0.1-beta1**. What to try:

1. **Full loop on a shipped template:** `aiscientist` → Shift+R (or `/run nanoGPT_lite`) → follow stages on the Dashboard; enable `A` (auto-improve) for the review→repair→re-review loop.
2. **New research direction:** Shift+N → wizard → step 5/6 **AI skeleton: y** → the model writes `experiment.py` + `plot.py` and runs the `run_0` baseline, then `/run <name>` works end to end.
3. **Environment:** `/doctor` checks the LLM key, LaTeX, aider, vault, and the baseline before you burn credits.

What to report: stage failures (`/report <jobId>` writes a markdown digest into `results/reports/`), guard decisions, anything that hangs, and Windows/WSL-specific issues.

---

## Contributing

See the Backlog section in [`docs/BETA0.1.md`](docs/BETA0.1.md) for planned features. Areas welcome:

- New research templates
- Console module plugins
- Additional model integrations
- Documentation improvements

---

## License

**The AI Scientist Source Code License** (derivative of Responsible AI License).

**Mandatory:** Clearly disclose AI use in any resulting publications:

> "This manuscript was autonomously generated using [The AI Scientist](https://github.com/SakanaAI/AI-Scientist)."

---

## Citing

```bibtex
@article{lu2024aiscientist,
  title={The {AI} {S}cientist: Towards Fully Automated Open-Ended Scientific Discovery},
  author={Lu, Chris and Lu, Cong and Lange, Robert Tjarko and Foerster, Jakob and Clune, Jeff and Ha, David},
  journal={arXiv preprint arXiv:2408.06292},
  year={2024}
}
```

---

<p align="center">
  <a href="https://star-history.com/#SakanaAI/AI-Scientist&Date">
    <img src="https://api.star-history.com/svg?repos=SakanaAI/AI-Scientist&type=Date" width="600" />
  </a>
</p>
