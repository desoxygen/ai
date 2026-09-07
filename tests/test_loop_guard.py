"""Тесты loop_guard: лимиты, повторы, решения, события, LLM-gate."""
import json

import pytest

from ai_scientist import loop_guard, settings
from ai_scientist.loop_guard import (RunAborted, StageGuard, StageSkip,
                                     note_llm_failure, reset_llm_streak)


@pytest.fixture(autouse=True)
def _headless(headless):
    yield


def test_skip_after_max_failures():
    g = StageGuard("s", max_failures=2)
    g.failure("boom 1")
    with pytest.raises(StageSkip):
        g.failure("boom 2")


def test_abort_policy_headless(monkeypatch):
    monkeypatch.setenv("AISC_HEADLESS_ON_LIMIT", "abort")
    g = StageGuard("s", max_failures=1)
    with pytest.raises(RunAborted):
        g.failure("fatal")


def test_continue_extends_budget():
    g = StageGuard("s", max_failures=1, on_limit="continue")
    extend = settings.GUARD.extend_by
    g.failure("первый провал")          # лимит достигнут → continue (без raise)
    assert g.failures == 0
    assert g.max_failures == 1 + extend
    # после расширения нужно ещё extend+1 провалов (failures дойдёт до нового лимита)
    for i in range(extend):
        g.failure(f"догоняем {i}")
    g.failure("опять лимит")            # failures == max_failures → решение снова
    assert g.max_failures == 1 + 2 * extend
    assert g.failures == 0


def test_repeat_detection_and_reset():
    g = StageGuard("s", max_repeats=3)
    assert g.check_repeat("q", "a") is False
    assert g.check_repeat("q", "a") is False
    with pytest.raises(StageSkip):
        g.check_repeat("q", "a")
    # другая сигнатура сбрасывает счётчик
    g2 = StageGuard("s", max_repeats=3)
    g2.check_repeat("q", "a")
    g2.check_repeat("q", "b")
    assert g2._sig_count == 1


def test_success_resets_counters():
    g = StageGuard("s", max_failures=3)
    g.failure("x")
    g.success()
    assert g.failures == 0
    g.failure("y")   # 1 < 3 — решение не срабатывает
    assert g.failures == 1


def test_events_written_to_log():
    g = StageGuard("event-stage", max_failures=1)
    with pytest.raises(StageSkip):
        g.failure("запись события")
    assert settings.GUARD_LOG.exists()
    events = [json.loads(l) for l in settings.GUARD_LOG.read_text(encoding="utf-8").splitlines()]
    kinds = {e["type"] for e in events}
    assert "failure" in kinds and "guard_decision" in kinds


def test_observer_called(monkeypatch):
    seen = []
    loop_guard.add_observer(lambda e: seen.append(e["type"]))
    g = StageGuard("obs", max_failures=1)
    with pytest.raises(StageSkip):
        g.failure("через наблюдателя")
    assert "guard_decision" in seen


def test_llm_failure_gate_headless(monkeypatch):
    monkeypatch.setenv("AISC_HEADLESS_ON_LIMIT", "abort")
    reset_llm_streak()
    # до порога — молча
    for _ in range(max(2, settings.GUARD.stage_max_failures) - 1):
        note_llm_failure("test-model", RuntimeError("e"))
    with pytest.raises(RunAborted):
        note_llm_failure("test-model", RuntimeError("e"))
    reset_llm_streak()
    # skip-политика: ничего не бросает
    monkeypatch.setenv("AISC_HEADLESS_ON_LIMIT", "skip")
    reset_llm_streak()
    note_llm_failure("m", RuntimeError("e"))
    note_llm_failure("m", RuntimeError("e"))


def test_run_aborted_is_base_exception():
    """Прерывание не должно глотаться легаси-обработчиками except Exception."""
    assert issubclass(RunAborted, BaseException)
    assert not issubclass(RunAborted, Exception)
    swallowed = False
    try:
        try:
            raise RunAborted("stop")
        except Exception:
            swallowed = True   # сюда попасть НЕ должны
    except RunAborted:
        pass
    assert not swallowed, "RunAborted проглочен except Exception — так нельзя"


def test_time_budget(monkeypatch):
    monkeypatch.setenv("AISC_MAX_STAGE_MINUTES", "0")
    settings.reload_guard()
    g = StageGuard("t", max_failures=99)
    g.check_time_budget()  # лимит выключен — ок
    monkeypatch.setenv("AISC_MAX_STAGE_MINUTES", "1")
    settings.reload_guard()
    g2 = StageGuard("t", max_failures=99)
    g2._t0 -= 3600  # час назад
    with pytest.raises(StageSkip):
        g2.check_time_budget()
    monkeypatch.setenv("AISC_MAX_STAGE_MINUTES", "0")
    settings.reload_guard()
