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

    def test_import_runner(self):
        from ai_scientist.console import runner
        assert callable(runner.execute_job)
        assert callable(runner.format_event)

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
# Runner (shared headless execute_job used by the TUI + debug CLI)
# ---------------------------------------------------------------------------
class _FakeModule:
    def __init__(self, name, result):
        self.name = name
        self._result = result

    def run(self, options, job, emit, stop_event=None):
        emit("run", "log", "working")
        return self._result


class TestRunner:
    def test_execute_job_success(self, tmp_path, monkeypatch):
        from ai_scientist.console.runner import execute_job
        from ai_scientist.console.jobs import JobRegistry
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        jobs = JobRegistry()
        code = execute_job(_FakeModule("x/y", {"ok": True, "z": 1}),
                           {"TEMPLATE": "t"}, jobs, printer=lambda ev: None)
        assert code == 0
        assert jobs.last().status == "done"

    def test_execute_job_reports_failure(self, tmp_path, monkeypatch):
        from ai_scientist.console.runner import execute_job
        from ai_scientist.console.jobs import JobRegistry
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        jobs = JobRegistry()
        code = execute_job(_FakeModule("x/y", {"ok": False}),
                           {}, jobs, printer=lambda ev: None)
        assert code == 1
        assert jobs.last().status == "failed"

    def test_execute_job_aborted_exit_code(self, tmp_path, monkeypatch):
        from ai_scientist.console.runner import execute_job
        from ai_scientist.console.jobs import JobRegistry
        monkeypatch.setattr("ai_scientist.settings.RESULTS_DIR", tmp_path)
        jobs = JobRegistry()
        code = execute_job(_FakeModule("x/y", {"aborted": True}),
                           {}, jobs, printer=lambda ev: None)
        assert code == 130
        assert jobs.last().status == "aborted"

    def test_format_event_shape(self):
        from ai_scientist.console.runner import format_event
        assert "ideas" in format_event({"status": "done", "stage": "ideas", "message": "3 ideas"})
        assert format_event({"status": "fail", "stage": "run", "message": "boom"}).startswith("[-]")


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

