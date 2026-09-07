"""Smoke tests for ai_scientist.console package.

Tests: imports, registry, jobs, events, config, REPL dispatch, CLI dispatch.
Run: python -m pytest tests/test_console_smoke.py -q
"""
import sys
from pathlib import Path

import pytest

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------
class TestConsoleImports:
    def test_import_package(self):
        from ai_scientist import console
        assert hasattr(console, "VERSION")

    def test_import_cli(self):
        from ai_scientist.console import cli
        assert callable(cli.main)

    def test_import_repl(self):
        from ai_scientist.console import repl
        assert hasattr(repl, "Console")
        assert hasattr(repl, "execute_job")

    def test_import_registry(self):
        from ai_scientist.console import registry
        assert hasattr(registry, "ModuleRegistry")
        assert hasattr(registry, "Module")

    def test_import_jobs(self):
        from ai_scientist.console import jobs
        assert hasattr(jobs, "JobRegistry")
        assert hasattr(jobs, "Job")

    def test_import_events(self):
        from ai_scientist.console import events
        assert callable(events.emit_factory)
        assert callable(events.read_events)

    def test_import_config(self):
        from ai_scientist.console import config
        assert callable(config.load_defaults)

    def test_import_home(self):
        from ai_scientist.console import home
        assert callable(home.render)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
class TestConsoleConfig:
    def test_load_defaults_returns_dict(self):
        from ai_scientist.console.config import load_defaults
        d = load_defaults()
        assert isinstance(d, dict)
        assert "default_module" in d
        assert "default_template" in d

    def test_config_file_created(self):
        from ai_scientist.console.config import ensure_config, config_path
        p = ensure_config()
        assert p.exists()
        assert p.suffix == ".toml"


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
class TestModuleRegistry:
    def test_scan_finds_modules(self):
        from ai_scientist.console.registry import ModuleRegistry
        reg = ModuleRegistry()
        assert len(reg) >= 3  # at least pipeline/run, auxiliary/env, auxiliary/ideas

    def test_get_pipeline_run(self):
        from ai_scientist.console.registry import ModuleRegistry
        reg = ModuleRegistry()
        m = reg.get("pipeline/run")
        assert m is not None
        assert m.name == "pipeline/run"
        assert m.type == "pipeline"

    def test_search(self):
        from ai_scientist.console.registry import ModuleRegistry
        reg = ModuleRegistry()
        hits = reg.search("env")
        assert any(m.name == "auxiliary/env" for m in hits)

    def test_list_returns_sorted(self):
        from ai_scientist.console.registry import ModuleRegistry
        reg = ModuleRegistry()
        names = [m.name for m in reg.list()]
        assert names == sorted(names)


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
class TestJobRegistry:
    def test_create_job(self, tmp_path, monkeypatch):
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        from ai_scientist.console.jobs import JobRegistry
        reg = JobRegistry()
        j = reg.create(module="test/mod", template="tpl", model="m", idea="i")
        assert j.id >= 1
        assert j.module == "test/mod"
        assert j.status == "queued"

    def test_update_job(self, tmp_path, monkeypatch):
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        from ai_scientist.console.jobs import JobRegistry
        reg = JobRegistry()
        j = reg.create()
        reg.update(j, status="running", pid=1234)
        assert j.status == "running"
        assert j.pid == 1234

    def test_running_filter(self, tmp_path, monkeypatch):
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        from ai_scientist.console.jobs import JobRegistry
        reg = JobRegistry()
        j1 = reg.create()
        j2 = reg.create()
        reg.update(j1, status="done")
        reg.update(j2, status="running")
        assert len(reg.running()) == 1
        assert reg.running()[0].id == j2.id

    def test_persistence(self, tmp_path, monkeypatch):
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        from ai_scientist.console.jobs import JobRegistry
        reg1 = JobRegistry()
        reg1.create(module="persist/test")
        # new instance reads from disk
        reg2 = JobRegistry()
        assert any(j.module == "persist/test" for j in reg2.list())


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------
class TestEvents:
    def test_make_event(self):
        from ai_scientist.console.events import make_event
        ev = make_event("run1", "mod", "stage1", "log", "hello")
        assert ev["run_id"] == "run1"
        assert ev["status"] == "log"
        assert ev["message"] == "hello"

    def test_append_and_read_events(self, tmp_path, monkeypatch):
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        from ai_scientist.console.events import append_event, read_events
        append_event(999, {"ts": "t", "stage": "s", "status": "log", "message": "m"})
        events = read_events(999)
        assert len(events) == 1
        assert events[0]["message"] == "m"

    def test_read_nonexistent_events(self, tmp_path, monkeypatch):
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        from ai_scientist.console.events import read_events
        assert read_events(99999) == []

    def test_emit_factory(self, tmp_path, monkeypatch):
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        from ai_scientist.console.events import emit_factory, read_events
        from ai_scientist.console.jobs import JobRegistry, Job
        reg = JobRegistry()
        j = reg.create(module="emit/test")
        emitted = []
        emit = emit_factory(j, lambda ev: emitted.append(ev))
        emit("stage1", "log", "test message")
        assert len(emitted) == 1
        assert emitted[0]["message"] == "test message"
        events = read_events(j.id)
        assert len(events) == 1


# ---------------------------------------------------------------------------
# REPL dispatch
# ---------------------------------------------------------------------------
class TestReplDispatch:
    def test_console_init(self):
        from ai_scientist.console.repl import Console
        c = Console()
        assert c.running is True
        assert c.current_module is None

    def test_handle_empty_line_shows_home(self, capsys):
        from ai_scientist.console.repl import Console
        c = Console()
        c.handle("")
        captured = capsys.readouterr()
        assert "aiscientist" in captured.out.lower() or "aiscientist" in captured.out

    def test_handle_unknown_command(self, capsys):
        from ai_scientist.console.repl import Console
        c = Console()
        c.handle("nonexistent")
        captured = capsys.readouterr()
        assert "неизвестная" in captured.out.lower() or "unknown" in captured.out.lower()

    def test_exploit_alias_runs(self, capsys):
        from ai_scientist.console.repl import Console
        c = Console()
        # exploit should work like run — starts a job with default module
        c.handle("exploit")
        captured = capsys.readouterr()
        # either starts a job or reports missing module — either way, no crash
        assert "job" in captured.out.lower() or "ошибка" in captured.out.lower() or "нет" in captured.out.lower()

    def test_commands_list(self):
        from ai_scientist.console.repl import Console
        c = Console()
        cmds = c._commands()
        assert "run" in cmds
        assert "exploit" in cmds
        assert "help" in cmds
        assert "exit" in cmds
        assert "lang" in cmds


# ---------------------------------------------------------------------------
# CLI dispatch
# ---------------------------------------------------------------------------
class TestCliDispatch:
    def test_main_version(self, capsys):
        from ai_scientist.console.cli import main
        code = main(["--version"])
        captured = capsys.readouterr()
        assert code == 0
        assert "aiscientist" in captured.out.lower()

    def test_main_help(self, capsys):
        from ai_scientist.console.cli import main
        code = main(["help"])
        captured = capsys.readouterr()
        assert code == 0
        assert "help" in captured.out.lower()

    def test_main_unknown_cmd(self, capsys):
        from ai_scientist.console.cli import main
        code = main(["bogus"])
        assert code == 2

    def test_cli_status(self, capsys, tmp_path, monkeypatch):
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        from ai_scientist.console.cli import main
        code = main(["status"])
        captured = capsys.readouterr()
        assert code == 0

    def test_cli_search(self, capsys):
        from ai_scientist.console.cli import main
        code = main(["search", "pipeline"])
        captured = capsys.readouterr()
        assert code == 0
        assert "pipeline/run" in captured.out

    def test_cli_logs_no_jobs(self, capsys, tmp_path, monkeypatch):
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        from ai_scientist.console.cli import main
        code = main(["logs"])
        captured = capsys.readouterr()
        assert code == 0


# ---------------------------------------------------------------------------
# UTF-8 handling
# ---------------------------------------------------------------------------
class TestUtf8:
    def test_ensure_utf8_stdio(self):
        from ai_scientist.console import ensure_utf8_stdio
        # should not raise
        ensure_utf8_stdio()


# ---------------------------------------------------------------------------
# i18n
# ---------------------------------------------------------------------------
class TestI18n:
    def test_default_language_is_en(self):
        from ai_scientist.console.i18n import current_language
        # default should be en (unless AISC_LANG is set)
        lang = current_language()
        assert lang in ("en", "ru")

    def test_set_language_en(self):
        from ai_scientist.console.i18n import set_language, current_language
        set_language("en")
        assert current_language() == "en"

    def test_set_language_ru(self):
        from ai_scientist.console.i18n import set_language, current_language
        set_language("ru")
        assert current_language() == "ru"
        # restore
        set_language("en")

    def test_set_language_invalid(self):
        from ai_scientist.console.i18n import set_language, current_language
        old = current_language()
        assert set_language("fr") is False
        assert current_language() == old

    def test_get_returns_string(self):
        from ai_scientist.console.i18n import get
        s = get("no_module")
        assert isinstance(s, str)
        assert len(s) > 0

    def test_lang_command_in_repl(self, capsys):
        from ai_scientist.console.repl import Console
        from ai_scientist.console.i18n import set_language
        set_language("en")
        c = Console()
        c.handle("lang")
        captured = capsys.readouterr()
        assert "language" in captured.out.lower() or "язык" in captured.out.lower()
