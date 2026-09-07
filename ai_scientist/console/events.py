"""Контракт событий pipeline (см. EVENTS.md).

Без шины: события передаются через callback (`emit`) или `yield`. Этот модуль
даёт только схему события и запись/чтение JSON-line журнала. Никакого pub/sub.
"""
import datetime
import json
import os

from ai_scientist import settings


def now_iso() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def make_event(run_id, module, stage, status, message, *, idea_id="", job_id=None,
               template="", model="", detail=None) -> dict:
    """Собирает событие по контракту из EVENTS.md."""
    ev = {
        "ts": now_iso(),
        "run_id": run_id or "",
        "idea_id": idea_id or "",
        "module": module or "",
        "stage": stage or "",
        "status": status or "log",
        "message": (message or "")[:2000],
    }
    if job_id is not None:
        ev["job_id"] = job_id
    if template:
        ev["template"] = template
    if model:
        ev["model"] = model
    if detail is not None:
        ev["detail"] = detail
    return ev


def event_log_path(job_id) -> str:
    return str(settings.RESULTS_DIR / "events" / f"{job_id}.jsonl")


def append_event(job_id, event: dict) -> None:
    """Дописывает одно событие как JSON-line."""
    path = event_log_path(job_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def read_events(job_id, limit=None) -> list:
    """Читает журнал событий job'а (с конца, если задан limit)."""
    path = event_log_path(job_id)
    if not os.path.exists(path):
        return []
    lines = []
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    if limit:
        lines = lines[-limit:]
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except Exception:
            continue
    return out


def emit_factory(job, printer=None):
    """Создаёт emit(stage, status, message, **kw) для одного job'а.

    Пишет событие в журнал (results/events/<job_id>.jsonl) и, если задан
    printer(ev), печатает его. Общий для REPL и CLI.
    """
    def emit(stage, status, message, **kw):
        ev = make_event(
            job.run_id, job.module, stage, status, message,
            idea_id=kw.get("idea_id", ""), job_id=job.id,
            template=job.template, model=job.model, detail=kw.get("detail"),
        )
        append_event(job.id, ev)
        if printer is not None:
            printer(ev)

    return emit
