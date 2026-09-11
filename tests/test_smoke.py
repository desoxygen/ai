#!/usr/bin/env python3
"""Smoke tests: guard logic, Obsidian notes, imports, LLM wrappers.

Run:  python tests/test_smoke.py
"""
import json
import os
import sys
import traceback
from pathlib import Path

# На Windows консоль по умолчанию cp1252 — глифы ✔/✖ и кириллица падают.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))
os.chdir(PROJECT)

PASS, FAIL = [], []


def check(name, fn):
    try:
        fn()
        PASS.append(name)
        print(f"  ✔ {name}")
    except Exception as e:
        FAIL.append((name, repr(e)))
        print(f"  ✖ {name}: {e!r}")
        traceback.print_exc()


def t_imports():
    from ai_scientist import settings
    assert settings.GUARD.llm_max_tries >= 1


def t_settings_env():
    from ai_scientist import settings
    assert os.environ.get("OPENROUTER_API_KEY"), "OPENROUTER_API_KEY not set"
    assert settings.GUARD.stage_max_failures == int(os.environ["AISC_STAGE_MAX_FAILURES"])
    v = settings.get_vault_path()
    assert v.exists(), f"vault не найден: {v}"


def t_guard_noninteractive_skip():
    """Headless: after max failures the guard must raise StageSkip."""
    os.environ["AISC_INTERACTIVE"] = "no"
    os.environ["AISC_HEADLESS_ON_LIMIT"] = "skip"
    from ai_scientist.loop_guard import StageGuard, StageSkip
    g = StageGuard("test-stage", max_failures=2)
    g.failure("boom 1")
    try:
        g.failure("boom 2")
    except StageSkip:
        pass
    else:
        raise AssertionError("ожидали StageSkip после 2 неудач")
    os.environ["AISC_INTERACTIVE"] = "auto"


def t_guard_repeat():
    os.environ["AISC_INTERACTIVE"] = "no"
    os.environ["AISC_HEADLESS_ON_LIMIT"] = "skip"
    from ai_scientist.loop_guard import StageGuard, StageSkip
    g = StageGuard("test-repeat", max_repeats=3)
    for _ in range(2):
        assert g.check_repeat("q", "same query") is False
    try:
        g.check_repeat("q", "same query")
    except StageSkip:
        pass
    else:
        raise AssertionError("ожидали StageSkip при 3-м повторе")
    # смена сигнатуры сбрасывает счётчик
    g2 = StageGuard("test-repeat2", max_repeats=3)
    g2.check_repeat("q", "a")
    g2.check_repeat("q", "b")
    assert g2._sig_count == 1
    os.environ["AISC_INTERACTIVE"] = "auto"


def t_guard_abort_policy():
    os.environ["AISC_INTERACTIVE"] = "no"
    os.environ["AISC_HEADLESS_ON_LIMIT"] = "abort"
    from ai_scientist.loop_guard import StageGuard, RunAborted
    g = StageGuard("test-abort", max_failures=1)
    try:
        g.failure("fatal")
    except RunAborted:
        pass
    else:
        raise AssertionError("ожидали RunAborted")
    os.environ["AISC_HEADLESS_ON_LIMIT"] = "skip"
    os.environ["AISC_INTERACTIVE"] = "auto"


def t_guard_events_logged():
    from ai_scientist import settings
    from ai_scientist.loop_guard import StageGuard
    os.environ["AISC_INTERACTIVE"] = "no"
    g = StageGuard("test-events", max_failures=1)
    try:
        g.failure("event test")
    except Exception:
        pass
    os.environ["AISC_INTERACTIVE"] = "auto"
    assert settings.GUARD_LOG.exists(), "guard_events.jsonl не создан"
    last = settings.GUARD_LOG.read_text(encoding="utf-8").strip().splitlines()[-1]
    assert "test-events" in json.loads(last)["stage"] or "guard_decision" in last


def t_obsidian_notes():
    from ai_scientist import obsidian_notes
    import os as _os
    idea = {"Name": "test_idea_xyz", "Title": "Тестовая идея", "Experiment": "run tests",
            "Interestingness": 7, "Feasibility": 8, "Novelty": 6, "novel": True}
    p = obsidian_notes.write_idea_note("testtpl", idea, run_id="TEST", status="new")
    assert p.exists(), p
    txt = p.read_text(encoding="utf-8")
    assert "Тестовая идея" in txt and "ai-scientist" in txt
    obsidian_notes.update_idea_status("testtpl", "test_idea_xyz", "reviewed",
                                      checklist={"Эксперименты": True, "Статья": True,
                                                 "Рецензия": True},
                                      review={"Overall": 6, "Decision": "Accept"})
    txt = p.read_text(encoding="utf-8")
    assert 'status: "reviewed"' in txt and "[x] Эксперименты" in txt
    # уникальное имя — чтобы не столкнуться с Windows delete-pending на vault
    d = obsidian_notes.write_discussion_note(
        f"Тестовая дискуссия {_os.getpid()}", "test-model",
        [("user", "привет [[ссылка]]"), ("assistant", "ответ")])
    assert d.exists()
    ov = obsidian_notes.write_run_overview("testtpl", "TEST", "test-model",
                                           [idea], {"test_idea_xyz": {"status": "reviewed"}})
    assert ov.exists()
    obsidian_notes.append_journal("Тестовое событие journal")


def t_cleanup_test_notes():
    from ai_scientist import obsidian_notes, settings
    root = settings.obsidian_root()
    # Точечная очистка ТОЛЬКО тестовых файлов (никогда не трогаем чужие заметки).
    targets = list((root / "Ideas").glob("testtpl__*.md"))
    targets += list((root / "Discussions").glob("*Тестовая_дискуссия*.md"))
    targets.append(root / "Projects" / "testtpl")
    for p in targets:
        try:
            if p.is_file():
                p.unlink()
            elif p.is_dir():
                import shutil
                shutil.rmtree(p)
        except OSError as e:
            print(f"  (cleanup пропустил {p.name}: {e})")
    # журнал остаётся — это история; пометим окончание тестов
    obsidian_notes.append_journal("Смоук-тесты завершены успешно ✔")


def t_generate_ideas_guard_import():
    # проверяем, что правки не сломали синтаксис/сигнатуры
    import inspect
    from ai_scientist import generate_ideas
    sig = inspect.signature(generate_ideas.generate_ideas)
    assert "max_num_generations" in sig.parameters


def t_llm_wrappers():
    from ai_scientist import llm
    import inspect
    assert inspect.isfunction(llm.get_response_from_llm)
    assert inspect.isfunction(llm.get_batch_responses_from_llm)
    # raw функции существуют
    assert hasattr(llm, "_get_response_from_llm_raw")
    assert llm.settings.GUARD.llm_max_tries == int(os.environ["AISC_LLM_MAX_TRIES"])


if __name__ == "__main__":
    print("\n=== AI-Scientist smoke tests ===")
    for name, fn in [(n, f) for n, f in sorted(globals().items()) if n.startswith("t_")]:
        check(name, fn)
    print(f"\nПройдено: {len(PASS)} · Провалено: {len(FAIL)}")
    for name, err in FAIL:
        print(f"  FAIL {name}: {err}")
    sys.exit(1 if FAIL else 0)
