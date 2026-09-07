# Debug / headless runner — not a user interface

> Everything here is **plumbing**. The product has exactly one interface: the
> TUI (`opencode-tui/`, launched by bare `aiscientist`). This document exists
> for CI, debugging, and scripting. If you are a user, you do not need it.

The TUI spawns jobs as subprocesses:
`python -m ai_scientist.console.cli -q run|skeleton ...`
(`opencode-tui/src/lib/aiscientist.ts`). The same entry point can be used by
hand when the dashboard misbehaves.

## Commands

```bash
# full pipeline, headless
aiscientist run --template nanoGPT_lite --idea adaptive_block_size \
  --stages ideas,novelty,experiments,writeup,review \
  --improve --min-score 6 --rounds 2

# AI skeleton for a new project (experiment.py + plot.py + run_0 baseline)
aiscientist skeleton --name my_study \
  --description "Compare LR schedules on a tiny transformer" [--no-baseline]

# job board / event stream / module catalog
aiscientist status
aiscientist logs -j 5
aiscientist search pipeline
```

All module options are flat CLI flags on `run`; anything the TUI can launch,
the runner can launch. Options catalog: `aiscientist search <module>` and the
`MANIFEST` of each module in `ai_scientist/console/modules/`.

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | success |
| `1`  | stage failed |
| `130`| aborted (`stop` / ctrl-c) |

## Internals

- Entry point: `ai_scientist/console/cli.py` (`aiscientist` console script).
- Shared execution logic: `ai_scientist/console/runner.py::execute_job`
  (registers the job in `results/jobs.jsonl`, streams events to
  `results/events/<job_id>.jsonl`, maps outcomes to exit codes).
- Modules: auto-discovered under `ai_scientist/console/modules/<type>/<name>.py`,
  each exporting `MANIFEST` + `run(options, job, emit, stop_event)`.
- Event contract (schema, pairing rules, stage values): [BETA0.1.md §8](BETA0.1.md).
- `--lang ru|en` translates runner messages; `AISC_RESULTS_DIR` redirects all
  artifacts (used by tests and sandboxes).

## Why there is no REPL

Earlier betas shipped an msfconsole-style REPL. It duplicated the TUI,
doubled the documentation surface and confused users about which interface
was real. It has been removed in v0.1-beta2: one product, one interface, the
TUI. The headless runner above is not an interface — it is the TUI's backend.
