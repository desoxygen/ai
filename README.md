<h1 align="center">
  <a href="https://github.com/SakanaAI/AI-Scientist/blob/main/docs/logo_2.png">
    <img src="docs/logo_2.png" width="220" alt="The AI Scientist" /></a><br>
  <b>The AI Scientist — Console Edition</b><br>
  <sub>Automated Scientific Discovery, from a terminal.</sub><br><br>
  <a href="https://github.com/desoxygen/ai/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/desoxygen/ai/ci.yml?label=CI&logo=github" alt="CI"></a>
  <a href="https://github.com/desoxygen/ai/releases/tag/v0.1-beta1"><img src="https://img.shields.io/github/v/tag/desoxygen/ai?label=version&color=orange" alt="v0.1-beta1"></a>
  <img src="https://img.shields.io/badge/python-3.11%2B-blue?logo=python&logoColor=yellow" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/tests-196%20passing-brightgreen" alt="tests">
  <a href="https://arxiv.org/abs/2408.06292"><img src="https://img.shields.io/badge/paper-arXiv%202408.06292-b31b1b?logo=arxiv&logoColor=white" alt="Paper"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AI%20Scientist%20Source%20Code-darkgray" alt="License"></a>
</h1>

<p align="center">
  <a href="#quickstart">Quickstart</a> •
  <a href="#what-you-get">What you get</a> •
  <a href="#the-console">Console</a> •
  <a href="#the-tui">TUI</a> •
  <a href="#cli-reference">CLI</a> •
  <a href="#beta-testing">Beta</a> •
  <a href="docs/BETA0.1.md">Docs</a>
</p>

---

**The AI Scientist** is a fully automated research pipeline: it generates
ideas, checks them against the literature, runs real experiments with an LLM
code agent, writes a LaTeX paper, reviews it like a conference referee — and
now, **revises the paper from its own review** until it clears the bar.

This fork turns the research loop into a **product you can actually run**:
a dark-mode terminal dashboard (TUI), an msfconsole-style REPL, and a
headless CLI for CI — with guard rails, event streams, reproducible run
metadata and a research journal written to Obsidian on the way.

```
 ideas ──▶ novelty ──▶ experiments ──▶ writeup ──▶ review ──┐
   ▲                                                        │ score < min
   │            ┌───────────────────────────────────────────┘
   └─ learnings ◀── improve (revise from feedback, re-review)
```

## What you get

| | |
|---|---|
| **Guarded pipeline** | Stage guards stop runaway loops, repeated outputs and time-budget breaches — headless or interactive |
| **`improve` loop** *(new)* | Weak review? The paper is rewritten from the reviewer's feedback, recompiled and re-reviewed: `/improve 6:2` |
| **AI project skeletons** *(new)* | Describe a research direction; the model writes `experiment.py` + `plot.py` and runs the baseline so `/run` works on day one |
| **Event contract** | Every stage emits `started/log/done/fail` JSON-lines — the dashboard, `/report` and `logs -f` all read the same stream |
| **Reproducibility** | `run_meta.json` per idea: model, seeds, package versions, code hash; Welch-z sanity checks flag "too good to be true" results |
| **Research journal** | Ideas, statuses and guard decisions sync to an Obsidian vault automatically |
| **Any model** | OpenRouter, OpenAI, Anthropic, DeepSeek, Gemini, local Ollama — one env var |
| **Multi-platform** | Linux, Windows, WSL and Docker; the test suite runs on all (196 tests, both OSes in CI) |

## Quickstart

```bash
git clone https://github.com/desoxygen/ai.git AI-Scientist
cd AI-Scientist

python -m venv .venv && .venv\Scripts\activate   # Windows (source .venv/bin/activate elsewhere)
pip install -e .                                 # Python 3.11+

cp .env.example .env                             # put your OPENROUTER_API_KEY inside
aiscientist                                      # 🖥  opens the TUI (REPL if bun is absent)
```

Prefer Docker (includes LaTeX, network-restricted):

```bash
docker compose build && docker compose run --rm scientist
```

> **LaTeX** is needed only for the paper stages (`writeup`, `review`,
> `improve`). Without it the pipeline still runs ideas → experiments and
> degrades gracefully. Headless: `sudo apt-get install texlive-full chktex`.

## The console

`aiscientist` (no args) launches the **TUI**; `aiscientist repl` the
msfconsole-style REPL. In the REPL:

```
aiscientist > use pipeline/run
aiscientist > set TEMPLATE nanoGPT_lite
aiscientist > set IMPROVE on
aiscientist > set IMPROVE_MIN_SCORE 6
aiscientist > run                     # watch guarded stages live
aiscientist > logs -f                 # event stream
aiscientist > loot                    # paper PDF, review, metrics
```

The doom-style start menu gives you one-keystroke access:

| Shift+key | Action | Shift+key | Action |
|---|---|---|---|
| `C` | continue project | `R` | run pipeline |
| `P` | open project | `D` | dashboard |
| `N` | new-project wizard | `A` | auto-improve preset |
| `M` | **AI skeleton** (new) | `I` | `/init` project rules |

## The TUI

Six workspaces (`1`–`6`), a command palette (`ctrl+p`), leader keys
(`ctrl+x`) and slash commands:

```
/run nanoGPT_lite            # pipeline — every stage lands on the Dashboard
/improve 6:2                 # repair loop: min score 6, up to 2 rounds
/skeleton lr_schedules       # AI writes experiment.py + plot.py + run_0 baseline
/new-project                 # 6-step wizard, optional AI skeleton at step 5/6
/report 3                    # markdown digest of a finished job → results/reports/
/doctor                      # API key, LaTeX, aider, baseline — before burning credits
```

The Dashboard follows real jobs (stages, event rate sparklines, live log),
Chat delegates background workers, Notes browses ideas/Obsidian, Article
renders the generated paper as ANSI text.

## CLI reference

```bash
aiscientist run --template nanoGPT_lite --idea adaptive_block_size \
  --stages ideas,novelty,experiments,writeup,review \
  --improve --min-score 6 --rounds 2

aiscientist skeleton --name my_study \
  --description "Compare LR schedules on a tiny transformer"   # + run_0 baseline

aiscientist status          # job board
aiscientist logs -j 5       # event stream of a job
aiscientist search pipeline # module catalog
```

| Exit code | Meaning | | Env (`.env`) | |
|---|---|---|---|---|
| `0` | success | | `OPENROUTER_API_KEY` | model access |
| `1` | stage failed | | `AISC_DEFAULT_MODEL` | default model |
| `130` | aborted (`stop` / ctrl-c) | | `AISC_RESULTS_DIR` | redirect artifacts |
| | | | `AISC_SEED` / `AISC_EXP_SEEDS` | reproducibility |
| | | | `AISC_MAX_STAGE_MINUTES` | time budgets |

Full table: [docs/BETA0.1.md §9](docs/BETA0.1.md).

## Project layout

```
ai_scientist/
├── console/           # entry point, REPL, module registry, jobs, events, i18n (EN/RU)
│   └── modules/       # pipeline/run · generate/skeleton · auxiliary/* · report/last
├── pipeline.py        # PipelineRunner: guarded stages + improve loop
├── perform_*.py       # experiments (Aider), writeup (LaTeX), review
└── ...
opencode-tui/          # Bun + React terminal dashboard
templates/nanoGPT_lite # ships ready-to-run (baseline included)
docs/                  # BETA0.1.md (single source of truth) + release notes
```

## Safety

> **Warning.** The pipeline executes LLM-generated code. Run it in Docker or
> another sandbox, not on a machine you love. Stage guards cap iterations,
> repeated outputs and wall-clock per stage; interactive mode asks before
> continuing past a limit.

## Beta testing — v0.1-beta1

1. `aiscientist` → Shift+R on `nanoGPT_lite` → watch the full loop, enable **A** for the improve pass.
2. Shift+N → wizard → step 5/6 **AI skeleton: y** → a new domain becomes runnable end-to-end.
3. Broken? `/report <jobId>` + `/export` and [open an issue](https://github.com/desoxygen/ai/issues) with the digest.

Release notes: [docs/RELEASE-v0.1-beta1.md](docs/RELEASE-v0.1-beta1.md).

## Contributing & docs

The living spec is [`docs/BETA0.1.md`](docs/BETA0.1.md) (architecture, event
contract, backlog). Welcome: new research templates, console modules, model
providers, docs and tests.

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
