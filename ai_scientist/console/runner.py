"""Shared job runner for the headless debug CLI (`aiscientist run|skeleton ...`).

This is plumbing for the TUI (which spawns `python -m ai_scientist.console.cli`)
and for CI scripts — not a user-facing interface. The only supported UI is the
TUI in `opencode-tui/`.
"""
import os

from ai_scientist.console.events import emit_factory
from ai_scientist.console.i18n import get as _t
from ai_scientist.loop_guard import RunAborted

_STATUS_ICON = {"started": "[*]", "log": "   ", "done": "[+]", "fail": "[-]"}


def format_event(ev) -> str:
    """Single-line event representation for CLI output."""
    icon = _STATUS_ICON.get(ev.get("status"), "   ")
    return f"{icon} [{ev.get('stage', '')}] {ev.get('message', '')}"


def _now() -> str:
    import datetime
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def execute_job(mod, options, jobs, printer, stop_event=None, job=None) -> int:
    """Synchronously executes a module and returns exit code (0/1/130)."""
    if job is None:
        job = jobs.create(
            module=mod.name,
            template=str(options.get("TEMPLATE", "") or ""),
            model=str(options.get("MODEL", "") or ""),
            idea=str(options.get("IDEA", "") or ""),
        )
    emit = emit_factory(job, printer)
    jobs.update(job, status="running", started_at=_now(), pid=os.getpid())
    emit("run", "started", f"job {job.id} started")
    code = 0
    try:
        result = mod.run(options, job, emit, stop_event)
        if isinstance(result, dict) and result.get("aborted"):
            jobs.update(job, status="aborted")
            emit("run", "fail", _t("pipeline_run_aborted"),
                 detail={"aborted": True, "exit_code": 130})
            code = 130
        elif isinstance(result, dict) and result.get("ok") is False:
            jobs.update(job, status="failed")
            emit("run", "fail", _t("pipeline_run_failed"),
                 detail={"exit_code": 1})
            code = 1
        else:
            jobs.update(job, status="done")
            emit("run", "done", f"job {job.id} completed",
                 detail={"summary": result} if isinstance(result, dict) else None)
    except RunAborted:
        jobs.update(job, status="aborted")
        emit("run", "fail", _t("pipeline_run_aborted"),
             detail={"aborted": True, "exit_code": 130})
        code = 130
    except Exception as e:
        jobs.update(job, status="failed")
        emit("run", "fail", str(e), detail={"error": str(e), "exit_code": 1})
        code = 1
    finally:
        jobs.update(job, finished_at=_now())
    return code
