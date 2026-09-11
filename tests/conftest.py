"""Общие фикстуры pytest: временный vault Obsidian, headless-режим guard, fake LLM."""
import sys
from pathlib import Path

import pytest

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))


@pytest.fixture(autouse=True)
def tmp_vault(tmp_path, monkeypatch):
    """Redirect Obsidian vault and guard log into a temp dir for every test."""
    vault = tmp_path / "vault"
    vault.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("OBSIDIAN_VAULT_PATH", str(vault))
    monkeypatch.delenv("AISC_OBSIDIAN_ROOT", raising=False)
    from ai_scientist import settings
    monkeypatch.setattr(settings, "GUARD_LOG", tmp_path / "guard_events.jsonl")
    return vault


@pytest.fixture(autouse=True)
def no_template_writes(monkeypatch):
    """run_idea() writes learnings to the relative templates/<t>/learnings.md —
    in the real repo that leaked a test row on every pipeline test run."""
    from ai_scientist import pipeline as _pl
    monkeypatch.setattr(_pl, "append_learning", lambda *a, **k: "")


@pytest.fixture()
def headless(monkeypatch):
    """Headless guard policy: skip on limit without prompting."""
    monkeypatch.setenv("AISC_INTERACTIVE", "no")
    monkeypatch.setenv("AISC_HEADLESS_ON_LIMIT", "skip")


@pytest.fixture()
def fake_llm(monkeypatch):
    """Подменяет get_response_from_llm на заглушку.

    Использование: fake_llm("ai_scientist.discussion"); затем
    fake_llm.responses.append("ответ").
    """
    class Fake:
        def __init__(self):
            self.responses = []
            self.calls = []

        def __call__(self, module):
            import importlib
            mod = importlib.import_module(module)
            fake = self

            def fake_get(msg, client=None, model=None, system_message=None,
                         msg_history=None, **kw):
                fake.calls.append(msg)
                text = fake.responses.pop(0) if fake.responses else "ок"
                hist = list(msg_history or [])
                hist.append({"role": "user", "content": msg})
                hist.append({"role": "assistant", "content": text})
                return text, hist

            monkeypatch.setattr(mod, "get_response_from_llm", fake_get)
            # На случай если модуль импортирует create_client напрямую — гасим и его.
            if hasattr(mod, "create_client"):
                monkeypatch.setattr(mod, "create_client", lambda model: (None, "fake"))
    return Fake()
