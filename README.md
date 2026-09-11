```text
╭─ ai-scientist · v0.2-beta3 · dark-mode research TUI ────────────────────────╮╮
│  ███  ███            █████  ████ ███  █████ █   █ █████ ███  █████ █████     │
│  ██ ██  █             ██    ██     █   ██    ██  █   █    █   ██      █      │
│  █████  █              ███  ██     █   ████  █ █ █   █    █    ███    █      │
│  ██ ██  █                ██ ██     █   ██    █  ██   █    █      ██   █      │
│  ██ ██ ███            █████  ████ ███  █████ █   █   █   ███  █████   █      │
│                                                                              │
│  Automated scientific discovery, from a terminal.                            │
│                                                                              │
│  ideas ─▶ novelty ─▶ experiments ─▶ writeup ─▶ review ─┐                     │
│    ▲                                                  │ score < min          │
│    └─ learnings ◀── improve (revise from feedback) ◀───┘                     │
╰──────────────────────────────────────────────────────────────────────────────╯
```

<p align="center">
  <a href="https://github.com/desoxygen/ai/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/desoxygen/ai/ci.yml?label=CI&logo=github" alt="CI"></a>
  <a href="https://github.com/desoxygen/ai/releases/tag/v0.2-beta3"><img src="https://img.shields.io/github/v/tag/desoxygen/ai?label=version&color=orange" alt="v0.2-beta3"></a>
  <img src="https://img.shields.io/badge/python-3.11%2B-blue?logo=python&logoColor=yellow" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/tests-248%20passing-brightgreen" alt="tests">
  <a href="https://arxiv.org/abs/2408.06292"><img src="https://img.shields.io/badge/paper-arXiv%202408.06292-b31b1b?logo=arxiv&logoColor=white" alt="Paper"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AI%20Scientist%20Source%20Code-darkgray" alt="License"></a>
</p>

**The AI Scientist** is a fully automated research pipeline — ideas, novelty
checks, real experiments by an LLM code agent, a LaTeX paper, a conference-style
review, and a **repair loop that revises the paper from its own review** until
it clears the bar. This fork turns that loop into a product: one dark-mode
terminal dashboard with guard rails, event streams, reproducible run metadata
and a research journal written to Obsidian along the way.

## The screen you actually see

`aiscientist` opens the dashboard. The doom-style start menu gives one-keystroke
access (prompt empty); `1`–`7` switch workspaces, `ctrl+p` is the palette:

```text
╭─ research menu · press shift+key, prompt empty ─────────────────────────────╮╮
│ C  continue project     nanoGPT_lite · run #3                                │
│ P  open project         3 research projects                                  │
│ N  new project          6-step wizard · writes prompt.json                   │
│ R  run pipeline         ideas → experiments → paper                          │
│ D  dashboard            stages · event rate · live log                       │
│ A  auto-improve         review → revise → re-review                          │
│ M  AI skeleton          LLM writes experiment.py + baseline                  │
│ I  /init project rules  ·  1-7 workspaces  ·  ctrl+p palette                 │
╰──────────────────────────────────────────────────────────────────────────────╯

╭─ dashboard · job #3 · grokking_toy/cosine_lr_schedule ──────────────────────╮╮
│   ideas        ✓  2m    novelty      ✓  4m                                   │
│   experiments  ✓ 31m    writeup      ✓  9m                                   │
│   review       ✓  3m    score 3.0/10  <6 improve ↻                           │
│                                                                              │
│   18:57:02 experiments.log   Applied edit to train.py                        │
│   18:57:44 experiments.done  run_2: val_acc 0.981 ▲                          │
│   18:58:10 writeup.section   Results · refine                                │
│   »  4.2 ev/s    49m wall   seeds 0,1   welch z 0.7 ✓                        │
╰──────────────────────────────────────────────────────────────────────────────╯
```

The Dashboard follows real jobs (stages, event-rate sparklines, live log), Chat
delegates background workers, Notes browses ideas/Obsidian, Article renders the
generated paper as ANSI text — and **Paper** (7) watches the article being
built live: section checklist from `detail.section` events
(draft → cite → refine → polish), review score, improve before→after, PDF status.

## Quickstart

```bash
git clone https://github.com/desoxygen/ai.git AI-Scientist
cd AI-Scientist

python -m venv .venv && .venv\Scripts\activate   # Windows (source .venv/bin/activate elsewhere)
pip install -e .                                 # Python 3.11+

cp .env.example .env                             # put your OPENROUTER_API_KEY inside
aiscientist                                      # that's the whole interface — the TUI
```

Prefer Docker (ships LaTeX + Bun; keeps LLM-generated code off your host —
see the network-isolation note in `docker-compose.yml`)?

```bash
docker compose build && docker compose run --rm scientist
```

> **LaTeX** is needed only for the paper stages (`writeup`, `review`,
> `improve`). Without it the pipeline still runs ideas → experiments and
> degrades gracefully. Headless: `sudo apt-get install texlive-full chktex`.

## What you get

| | |
|---|---|
| **Guarded pipeline** | Stage guards stop runaway loops, repeated outputs and time-budget breaches — headless or interactive |
| **`improve` loop** | Weak review? The paper is rewritten from the reviewer's feedback, recompiled and re-reviewed: `/improve 6:2` |
| **AI project skeletons** | Describe a research direction; the model writes `experiment.py` + `plot.py` and runs the baseline so `/run` works on day one |
| **Event contract** | Every stage emits `started/log/done/fail` JSON-lines — the dashboard, `/report` and `logs -f` all read the same stream |
| **Reproducibility** | `run_meta.json` per idea: model, seeds, package versions, code hash; Welch-z sanity checks flag "too good to be true" results |
| **Research journal** | Ideas, statuses and guard decisions sync to an Obsidian vault automatically |
| **Any model** | OpenRouter, OpenAI, Anthropic, DeepSeek, Gemini, local Ollama — one env var |
| **Model router** | The pipeline routes **different models per task** — nothing hardcoded: candidates ranked from live OpenRouter catalog data (pricing, context, `supported_parameters`, recency; optionally lifted by live web discovery when `TAVILY_API_KEY` is set) |
| **Multi-platform** | Linux, Windows, WSL and Docker; 248 tests on both OSes + Python 3.11/3.12 in CI |

## Commands worth knowing

```text
/run nanoGPT_lite            # pipeline — every stage lands on the Dashboard
/paper                       # build the article: writeup → review (workspace 7)
/improve 6:2                 # repair loop: min score 6, up to 2 rounds
/skeleton lr_schedules       # AI writes experiment.py + plot.py + run_0 baseline
/new-project                 # 6-step wizard, optional AI skeleton at step 5/6
/report 3                    # markdown digest of a finished job → results/reports/
/doctor                      # API key, LaTeX, aider, model roles — before burning credits
```

## Configuration

Key settings in `.env` (full table: [docs/BETA0.1.md §9](docs/BETA0.1.md)):

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | model access (also `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) |
| `AISC_DEFAULT_MODEL` | which model drives the pipeline |
| `AISC_MODEL_PLAN/CODE/REVIEW` | per-task model routing (auto-picked from the live catalog when unset) |
| `AISC_RESULTS_DIR` | redirect all artifacts (tests / sandboxes) |
| `AISC_SEED` / `AISC_EXP_SEEDS` | reproducibility |
| `AISC_MAX_STAGE_MINUTES` | per-stage time budget |

> There is no interactive command line to learn. A **headless runner** powers
> the TUI under the hood; it exists for CI and debugging only, and is
> documented — deliberately out of sight — in [`docs/DEBUG.md`](docs/DEBUG.md).

## Project layout

```text
ai_scientist/
├── console/           # entry point, headless runner, module registry, jobs, events, i18n
│   └── modules/       # pipeline/run · generate/skeleton · auxiliary/* · writeup · report/last
├── pipeline.py        # PipelineRunner: guarded stages + improve loop
├── model_router.py    # per-task model picks from the live OpenRouter catalog
├── perform_*.py       # experiments (Aider), writeup (LaTeX), review
└── ...
opencode-tui/          # the TUI — Bun + React terminal dashboard (the only UI)
templates/             # 3 ready-to-run domains: nanoGPT_lite (GPU),
                       # grokking_toy + parity_transformer (~1 min CPU, baselines included)
docs/                  # BETA0.1.md (source of truth) · DEBUG.md · RUNBOOK-E2E.md · release notes
```

## Safety

```text
╭─ warning ────────────────────────────────────────────────────────────────────╮
│  The pipeline executes LLM-generated code. Run it in Docker or               │
│  another sandbox, not on a machine you love. Stage guards cap                │
│  iterations, repeated outputs and per-stage wall-clock time.                 │
╰──────────────────────────────────────────────────────────────────────────────╯
```

## Beta testing — v0.2-beta3

1. `aiscientist` → Shift+R on `nanoGPT_lite` → watch the full loop, press **A** to enable the improve pass. No GPU? `grokking_toy` runs the same loop on CPU in ~1 minute.
2. Shift+N → wizard → step 5/6 **AI skeleton: y** → a new domain becomes runnable end-to-end.
3. Broken? `/report <jobId>` + `/export` and [open an issue](https://github.com/desoxygen/ai/issues) with the digest.

Release notes: [docs/RELEASE-v0.2-beta3.md](docs/RELEASE-v0.2-beta3.md) · upgrade guide: [docs/MIGRATION.md](docs/MIGRATION.md) · release gate: [docs/RUNBOOK-E2E.md](docs/RUNBOOK-E2E.md).

## Contributing & docs

The living spec is [`docs/BETA0.1.md`](docs/BETA0.1.md) (architecture, event
contract, backlog); the hidden headless runner is documented in
[`docs/DEBUG.md`](docs/DEBUG.md), the release plan in [`docs/ROADMAP-1.0.md`](docs/ROADMAP-1.0.md)
and the upgrade path in [`docs/MIGRATION.md`](docs/MIGRATION.md). Welcome: new
research templates, runner modules, model providers, docs and tests.

## License & citation

**The AI Scientist Source Code License** (derivative of Responsible AI
License). Mandatory disclosure in any resulting publication:

> "This manuscript was autonomously generated using
> [The AI Scientist](https://github.com/SakanaAI/AI-Scientist)."

Built on [SakanaAI/AI-Scientist](https://github.com/SakanaAI/AI-Scientist) —
please cite the original work:

```bibtex
@article{lu2024aiscientist,
  title={The {AI} {S}cientist: Towards Fully Automated Open-Ended Scientific Discovery},
  author={Lu, Chris and Lu, Cong and Lange, Robert Tjarko and Foerster, Jakob and Clune, Jeff and Ha, David},
  journal={arXiv preprint arXiv:2408.06292},
  year={2024}
}
```
