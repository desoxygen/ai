"""Loop protection for the AI-Scientist pipeline.

Provides:
  * StageGuard  — per-stage limits: consecutive failures, repeated identical
                  outputs, interactive decision (continue / skip / abort).
  * RunAborted  — BaseException so plain ``except Exception`` handlers in the
                  legacy pipeline cannot swallow a user's abort.
  * StageSkip   — Exception raised when the user (or non-interactive policy)
                  decides to skip the current stage/idea.
  * llm gate    — global consecutive-failure tracking for LLM API calls.

Guard events are appended to results/guard_events.jsonl and broadcast to
observers (used to mirror events into the Obsidian journal).
"""
import datetime
import json
import os
import threading
import time

from ai_scientist import settings

# Rich/questionary are optional: everything must work headless too.
try:
    from rich.console import Console
    from rich.panel import Panel
    _console = Console()
except Exception:  # pragma: no cover
    _console = None

try:
    import questionary
except Exception:  # pragma: no cover
    questionary = None


class RunAborted(BaseException):
    """User (or policy) requested a full stop of the run."""


class StageSkip(Exception):
    """Skip the current stage / idea and move on."""


_OBSERVERS = []
_OBSERVER_LOCK = threading.Lock()


def add_observer(fn):
    """fn(event: dict) is called for every guard event."""
    with _OBSERVER_LOCK:
        _OBSERVERS.append(fn)


def _emit(event: dict):
    event = {"ts": datetime.datetime.now().isoformat(timespec="seconds"), **event}
    try:
        settings.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        with open(settings.GUARD_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception:
        pass
    with _OBSERVER_LOCK:
        observers = list(_OBSERVERS)
    for fn in observers:
        try:
            fn(event)
        except Exception:
            pass


def _warn(msg: str):
    if _console:
        _console.print(Panel(f"[bold yellow]{msg}", title="⚠️  Loop Guard", border_style="yellow"))
    else:
        print(f"\n⚠️  [Loop Guard] {msg}\n")


def _ask(question: str, choices) -> str:
    """Interactive prompt with questionary; falls back to numbered input()."""
    if questionary is not None and settings.is_interactive():
        try:
            return questionary.select(question, choices=choices).ask()
        except Exception:
            pass
    if not settings.is_interactive():
        return ""
    print(question)
    for i, c in enumerate(choices, 1):
        print(f"  {i}) {c}")
    try:
        raw = input("Выбор: ").strip()
        return choices[int(raw) - 1]
    except Exception:
        return ""


def _apply_decision(action: str, stage: str, reason: str, detail: str = ""):
    _emit({"type": "guard_decision", "stage": stage, "reason": reason, "action": action,
           "detail": detail})
    if action == "abort":
        _warn(f"Запуск прерван пользователем на этапе «{stage}» ({reason}).")
        raise RunAborted(f"aborted at {stage}: {reason}")
    if action == "skip":
        _warn(f"Этап «{stage}» пропущен ({reason}).")
        raise StageSkip(f"skipped {stage}: {reason}")
    # "continue" → просто сбрасываем счётчики и идём дальше


class StageGuard:
    """Tracks failures and repeated outputs of one pipeline stage."""

    def __init__(self, name: str, max_failures: int = None, max_repeats: int = None,
                 on_limit: str = None, metadata: dict = None):
        self.name = name
        self.max_failures = max_failures or settings.GUARD.stage_max_failures
        self.max_repeats = max_repeats or settings.GUARD.max_repeat_signatures
        self.on_limit = on_limit or settings.GUARD.on_limit
        self.metadata = metadata or {}
        self.failures = 0
        self.attempts = 0
        self._sig_key = None
        self._sig_value = None
        self._sig_count = 0
        self._t0 = time.time()

    # -- events -------------------------------------------------------------
    def info(self, message: str):
        _emit({"type": "info", "stage": self.name, "message": message})

    # -- failures -----------------------------------------------------------
    def success(self, message: str = ""):
        self.failures = 0
        self._sig_count = 0
        if message:
            self.info(message)

    def failure(self, detail: str = ""):
        """Record a stage failure; may interactively escalate to a decision."""
        self.failures += 1
        self.attempts += 1
        _emit({"type": "failure", "stage": self.name, "count": self.failures,
               "detail": detail[:500]})
        if self.failures >= self.max_failures:
            self._decide("failures", f"{self.failures} неудач подряд. {detail[:300]}")

    # -- repeated outputs ----------------------------------------------------
    def check_repeat(self, key, value=None) -> bool:
        """True (and possibly escalates) if the same signature repeats too often.

        `key` identifies the stream (e.g. idea name, search query, stderr),
        `value` the concrete signature; defaults to str(key).
        """
        value = str(value if value is not None else key)
        if key != self._sig_key or value != self._sig_value:
            self._sig_key, self._sig_value, self._sig_count = key, value, 1
            return False
        self._sig_count += 1
        if self._sig_count >= self.max_repeats:
            _emit({"type": "repeat_detected", "stage": self.name, "key": str(key)[:200],
                   "count": self._sig_count})
            self._decide("repeat", f"Повторяющийся результат «{value[:120]}» "
                                   f"({self._sig_count} раз подряд).")
            return True
        return False

    # -- decision ------------------------------------------------------------
    def _decide(self, reason: str, human_reason: str):
        action = self.on_limit
        choices = {
            "continue": f"↻  Продолжить (ещё {settings.GUARD.extend_by} попыток)",
            "skip": "⏭  Пропустить этот этап",
            "abort": "✖  Прервать весь запуск",
        }
        if action == "ask":
            if settings.is_interactive():
                _warn(f"Этап «{self.name}»: {human_reason}")
                answer = _ask("Что делать?", list(choices.values()))
                action = next(k for k, v in choices.items() if v == answer) if answer else "skip"
            else:
                # Headless: fall back to the configured non-interactive policy.
                action = os.environ.get("AISC_HEADLESS_ON_LIMIT", "skip")
        if action == "continue":
            self.failures = 0
            self._sig_count = 0
            self.max_failures += settings.GUARD.extend_by
        _apply_decision(action, self.name, reason, human_reason)

    # -- wall-clock budget ----------------------------------------------------
    def elapsed_minutes(self) -> float:
        return (time.time() - self._t0) / 60.0

    def check_time_budget(self):
        limit = settings.GUARD.max_stage_minutes
        if limit and self.elapsed_minutes() > limit:
            self._decide("time_budget", f"Этап «{self.name}» идёт дольше {limit} мин.")


# ---------------------------------------------------------------------------
# Global LLM failure gate (used by ai_scientist.llm)
# ---------------------------------------------------------------------------

_llm_lock = threading.Lock()
_llm_streak = 0
_llm_last_error = ""


def note_llm_failure(model: str, exc: Exception):
    """Called after a bounded LLM call has exhausted its retries.

    Non-interactive policy: 'skip' → re-raise original exception (callers'
    existing try/except handles it), 'abort' → raise RunAborted.
    Interactive: ask continue / abort when the streak gets too long.
    """
    global _llm_streak, _llm_last_error
    with _llm_lock:
        _llm_streak += 1
        _llm_last_error = f"{type(exc).__name__}: {exc}"
        streak = _llm_streak
    _emit({"type": "llm_failure", "model": model, "streak": streak,
           "error": _llm_last_error[:300]})
    threshold = max(2, settings.GUARD.stage_max_failures)
    if streak < threshold:
        return
    if settings.is_interactive():
        _warn(f"LLM {model} падает {streak} раз подряд: {_llm_last_error[:200]}")
        answer = _ask("Что делать?", [
            f"↻  Продолжить попытки",
            "✖  Прервать весь запуск",
        ])
        if answer.startswith("✖"):
            _apply_decision("abort", "llm-call", "llm_failures", _llm_last_error)
        reset_llm_streak()
        return
    # headless
    if os.environ.get("AISC_HEADLESS_ON_LIMIT", "skip") == "abort":
        _apply_decision("abort", "llm-call", "llm_failures", _llm_last_error)
    # 'skip' → return; caller will see the original exception re-raised by backoff


def reset_llm_streak():
    global _llm_streak
    with _llm_lock:
        _llm_streak = 0


# ---------------------------------------------------------------------------
# Convenience decorator for stage functions
# ---------------------------------------------------------------------------

def guard_stage(name: str, **guard_kwargs):
    """Decorator: converts StageSkip from a stage function into (False, 'skipped').

    Usage in pipeline code:
        ok, why = guard_stage("experiments")(perform_experiments)(...)
    """
    def deco(fn):
        def wrapper(*args, **kwargs):
            guard = StageGuard(name, **guard_kwargs)
            try:
                result = fn(*args, **kwargs)
                guard.success()
                return result
            except StageSkip:
                return False, "skipped"
        return wrapper
    return deco
