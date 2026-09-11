"""Entry point for the `aiscientist` command.

The TUI (`opencode-tui/`) is the only interactive interface:

  * `aiscientist`                    -> TUI (the product);
  * `aiscientist tui`                -> same, explicit;
  * `aiscientist help`               -> short pointer to the TUI;
  * `aiscientist --version`          -> version.

Hidden debug plumbing (not a user-facing interface — used by the TUI and CI):
  `aiscientist -q run ... | skeleton ... | status | logs | search`

Stage failure -> non-zero exit code (1 = fail, 130 = aborted).
"""
import os
import shutil
import subprocess
import sys

from ai_scientist import settings
from ai_scientist.console import VERSION, ensure_utf8_stdio
from ai_scientist.console.i18n import get as _t, set_language
from ai_scientist.console.runner import format_event


# --------------------------------------------------------------------------- TUI
TUI_DIRNAME = "opencode-tui"


def tui_dir():
    return os.path.join(settings.PROJECT_ROOT, TUI_DIRNAME)


def tui_available():
    """(ok, reason) — can we start TUI: directory, deps, bun."""
    d = tui_dir()
    if not os.path.isdir(d):
        return False, f"directory {TUI_DIRNAME}/ not found"
    if not os.path.isdir(os.path.join(d, "node_modules")):
        return False, f"no dependencies — run `bun install` in {TUI_DIRNAME}/"
    if shutil.which("bun") is None:
        return False, "bun not found in PATH"
    return True, ""


def cli_tui(argv):
    ok, why = tui_available()
    if not ok:
        print(_t("cli_tui_unavailable", why), file=sys.stderr)
        print(f"the TUI is the only interface - see the README "
              f"(install Bun + `bun install` in {TUI_DIRNAME}/), then run: aiscientist",
              file=sys.stderr)
        return 1
    os.chdir(tui_dir())
    try:
        return subprocess.call(["bun", "run", "src/index.tsx"])
    except KeyboardInterrupt:
        return 130
    except OSError as e:
        print(_t("cli_tui_error", e), file=sys.stderr)
        return 1



# --------------------------------------------------------------------------- CLI
def cli_run(argv):
    import argparse
    from ai_scientist.console.jobs import JobRegistry
    from ai_scientist.console.registry import ModuleRegistry
    from ai_scientist.console.runner import execute_job

    p = argparse.ArgumentParser(prog="aiscientist run")
    p.add_argument("--template", required=True, help=_t("cli_template_help"))
    p.add_argument("--model", default="", help=_t("cli_model_help"))
    p.add_argument("--idea", default="", help=_t("cli_idea_help"))
    p.add_argument("--num-ideas", type=int, default=1)
    p.add_argument("--num-reflections", type=int, default=3)
    p.add_argument("--stages", default="ideas,novelty,experiments,writeup,review")
    p.add_argument("--engine", default="semanticscholar",
                   choices=["semanticscholar", "openalex"])
    p.add_argument("--improve", action="store_true",
                   help="revise the paper from reviewer feedback and re-review")
    p.add_argument("--min-score", type=float, default=6.0,
                   help="improve only when review score is below this (0-10)")
    p.add_argument("--rounds", type=int, default=1,
                   help="max improvement rounds")
    p.add_argument("--plan-model", default="",
                   help="model for ideas/novelty (empty = AISC_MODEL_PLAN/auto)")
    p.add_argument("--code-model", default="",
                   help="model for aider code edits (empty = AISC_MODEL_CODE/auto)")
    p.add_argument("--review-model", default="",
                   help="model for paper review (empty = AISC_REVIEW_MODEL/auto)")
    a = p.parse_args(argv)

    mod = ModuleRegistry().get("pipeline/run")
    if mod is None:
        print(_t("cli_module_not_found"), file=sys.stderr)
        return 1

    options = {
        "TEMPLATE": a.template, "MODEL": a.model, "IDEA": a.idea,
        "NUM_IDEAS": a.num_ideas, "NUM_REFLECTIONS": a.num_reflections,
        "STAGES": a.stages, "ENGINE": a.engine,
        "IMPROVE": "on" if a.improve else "off",
        "IMPROVE_MIN_SCORE": a.min_score, "IMPROVE_ROUNDS": a.rounds,
        "PLAN_MODEL": a.plan_model, "CODE_MODEL": a.code_model,
        "REVIEW_MODEL": a.review_model,
    }
    jobs = JobRegistry()
    return execute_job(mod, options, jobs, printer=_print_event)


def cli_ask(argv):
    """aiscientist -q ask "goal" — the model itself calls the pipeline tools."""
    import argparse
    from ai_scientist.console import assistant

    p = argparse.ArgumentParser(prog="aiscientist ask")
    p.add_argument("task", nargs="?", default="", help="research goal in plain language")
    p.add_argument("--task", dest="task_kw", default="", help=argparse.SUPPRESS)
    p.add_argument("--model", default="", help=_t("cli_model_help"))
    p.add_argument("--max-steps", type=int, default=8)
    a = p.parse_args(argv)
    task = (a.task or a.task_kw).strip()
    if not task:
        print(_t("cli_ask_no_task"), file=sys.stderr)
        return 2

    def printer(ev):
        print(format_event(ev))

    try:
        out = assistant.ask(task, model=a.model, max_steps=a.max_steps,
                            emit=lambda stage, status, msg, **kw: printer(
                                {"stage": stage, "status": status, "message": msg}),
                            printer=printer)
    except Exception as e:
        print(f"[-] [ask] {e}", file=sys.stderr)
        return 1
    if out.get("answer"):
        print()
        print(out["answer"])
    return 0 if out.get("ok") else 1


def cli_skeleton(argv):
    import argparse
    from ai_scientist.console.jobs import JobRegistry
    from ai_scientist.console.registry import ModuleRegistry
    from ai_scientist.console.runner import execute_job

    p = argparse.ArgumentParser(prog="aiscientist skeleton")
    p.add_argument("--name", required=True, help="new template name (lowercase, 2-48 chars)")
    p.add_argument("--description", required=True, help="research task description")
    p.add_argument("--model", default="", help=_t("cli_model_help"))
    p.add_argument("--no-baseline", action="store_true",
                   help="write the skeleton without running the baseline")
    a = p.parse_args(argv)

    mod = ModuleRegistry().get("generate/skeleton")
    if mod is None:
        print(_t("cli_module_not_found"), file=sys.stderr)
        return 1
    options = {
        "NAME": a.name, "DESCRIPTION": a.description, "MODEL": a.model,
        "RUN_BASELINE": "off" if a.no_baseline else "on",
    }
    jobs = JobRegistry()
    return execute_job(mod, options, jobs, printer=_print_event)


def cli_paper(argv):
    import argparse
    from ai_scientist.console.jobs import JobRegistry
    from ai_scientist.console.registry import ModuleRegistry
    from ai_scientist.console.runner import execute_job

    p = argparse.ArgumentParser(prog="aiscientist paper")
    p.add_argument("--template", required=True, help=_t("cli_template_help"))
    p.add_argument("--folder", default="",
                   help="run folder results/<template>/<ts>_<idea> (empty = newest)")
    p.add_argument("--stages", default="writeup,review")
    p.add_argument("--model", default="", help=_t("cli_model_help"))
    p.add_argument("--plan-model", default="", help="model for section planning/citations")
    p.add_argument("--code-model", default="", help="model for aider tex edits")
    p.add_argument("--review-model", default="", help="model for the review pass")
    p.add_argument("--engine", default="semanticscholar",
                   choices=["semanticscholar", "openalex"])
    p.add_argument("--improve", action="store_true",
                   help="revise the paper from reviewer feedback and re-review")
    p.add_argument("--min-score", type=float, default=6.0)
    p.add_argument("--rounds", type=int, default=1)
    a = p.parse_args(argv)

    mod = ModuleRegistry().get("writeup/paper")
    if mod is None:
        print(_t("cli_module_not_found"), file=sys.stderr)
        return 1
    options = {
        "TEMPLATE": a.template, "FOLDER": a.folder, "STAGES": a.stages,
        "MODEL": a.model, "PLAN_MODEL": a.plan_model, "CODE_MODEL": a.code_model,
        "REVIEW_MODEL": a.review_model, "ENGINE": a.engine,
        "IMPROVE": "on" if a.improve else "off",
        "IMPROVE_MIN_SCORE": a.min_score, "IMPROVE_ROUNDS": a.rounds,
    }
    jobs = JobRegistry()
    return execute_job(mod, options, jobs, printer=_print_event)


def cli_status(argv):
    from ai_scientist.console.jobs import JobRegistry
    jobs = JobRegistry()
    if not jobs.jobs:
        print(f"[*] {_t('cli_status_empty')}")
        return 0
    for j in jobs.jobs:
        extra = []
        if j.idea:
            extra.append(f"idea={j.idea}")
        if j.template:
            extra.append(f"template={j.template}")
        suffix = f"  ({' '.join(extra)})" if extra else ""
        print(f"  {j.id:<4} {j.status:<8} {j.module or '-'}{suffix}")
    return 0


def cli_logs(argv):
    import argparse
    from ai_scientist.console.events import read_events
    from ai_scientist.console.jobs import JobRegistry

    p = argparse.ArgumentParser(prog="aiscientist logs")
    p.add_argument("--job", "-j", type=int, default=None, help=_t("cli_job_help"))
    a = p.parse_args(argv)

    jobs = JobRegistry()
    job = jobs.get(a.job) if a.job is not None else jobs.last()
    if job is None:
        print(f"[*] {_t('no_logs')}")
        return 0
    events = read_events(job.id)
    if not events:
        print(f"[*] {_t('no_job_events', job.id)}")
        return 0
    for ev in events:
        print(format_event(ev))
    return 0


def cli_jobs_purge(argv):
    """Compact the job journal: drop finished records + their event files."""
    import argparse
    from ai_scientist.console.jobs import JobRegistry

    p = argparse.ArgumentParser(prog="aiscientist jobs-purge")
    p.add_argument("--template", default=None, help="only this template's jobs")
    a = p.parse_args(argv)

    jobs = JobRegistry()
    removed = jobs.purge(template=a.template)
    print(f"[*] purged {len(removed)} job record(s)"
          + (f" (template={a.template})" if a.template else "")
          + (f": #{'#'.join(map(str, removed))}" if removed else ""))
    return 0


def cli_search(argv):
    from ai_scientist.console.registry import ModuleRegistry
    query = argv[0] if argv else ""
    hits = ModuleRegistry().search(query)
    if not hits:
        print(f"[*] {_t('search_empty', query)}")
        return 0
    for m in hits:
        print(f"  {m.name:<20} {m.description}")
    return 0


def _print_event(ev):
    print(format_event(ev))


# --------------------------------------------------------------------------- main
def main(argv=None) -> int:
    ensure_utf8_stdio()
    argv = list(sys.argv[1:] if argv is None else argv)

    # -q / --quiet — non-interactive mode (no banner), like `msf -q`.
    if argv and argv[0] in ("-q", "--quiet"):
        argv = argv[1:]

    # --lang <code> — set language before anything else
    if argv and argv[0] == "--lang" and len(argv) > 1:
        set_language(argv[1])
        argv = argv[2:]

    if not argv:
        # TUI — the only interface.
        return cli_tui([])

    cmd = argv[0]
    rest = argv[1:]

    if cmd in ("-h", "--help", "help"):
        print(f"aiscientist {VERSION} — the TUI is the only interface.")
        print()
        print("  aiscientist            open the terminal dashboard (opencode-tui/)")
        print("  aiscientist help       this message")
        print("  aiscientist --version  print version")
        print()
        print("Headless/debug (used by the TUI and CI, not an interactive UI):")
        print('  aiscientist -q ask "<research goal>"   # the model calls the pipeline tools itself')
        print("  aiscientist -q run --template T [--stages ...] [--improve ...]")
        print("  aiscientist -q skeleton --name N --description D")
        print("  aiscientist -q paper --template T [--folder F] [--improve ...]")
        print("  aiscientist status | logs [-j ID] | jobs-purge [--template T] | search QUERY")
        return 0

    if cmd in ("-v", "--version", "version"):
        print(f"aiscientist {VERSION}")
        return 0

    if cmd in ("tui", "ui", "dashboard"):
        return cli_tui(rest)

    # CLI aliases work with relative templates/results — fix cwd.
    os.chdir(settings.PROJECT_ROOT)

    if cmd == "run":
        return cli_run(rest)
    if cmd == "ask":
        return cli_ask(rest)
    if cmd in ("skeleton", "generate-skeleton"):
        return cli_skeleton(rest)
    if cmd == "paper":
        return cli_paper(rest)
    if cmd == "status":
        return cli_status(rest)
    if cmd == "logs":
        return cli_logs(rest)
    if cmd in ("jobs-purge", "purge"):
        return cli_jobs_purge(rest)
    if cmd == "search":
        return cli_search(rest)

    print(_t("cli_unknown_command", cmd), file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(_t("cli_interrupted"), file=sys.stderr)
        sys.exit(130)
