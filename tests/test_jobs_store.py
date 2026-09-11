"""Cycle-1 stress regressions: cross-process jobs journal integrity.

docs/STRESS-TESTS.md F1: two runner processes used to race on
max(id)+1 and one _save() rewrite clobbered the other's records
(real case: job #21 with two run_ids in one events file).
"""
import json
import os
import time

import pytest


@pytest.fixture()
def results(tmp_path, monkeypatch):
    from ai_scientist import settings
    d = tmp_path / "results"
    d.mkdir()
    monkeypatch.setattr(settings, "RESULTS_DIR", d)
    return d


def _lines(results):
    p = results / "jobs.jsonl"
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def test_create_ids_unique_across_registries(results):
    from ai_scientist.console.jobs import JobRegistry
    regs = [JobRegistry() for _ in range(4)]  # four "processes", one lock file
    jobs = [r.create(module="stress", template=f"t{i}") for i, r in enumerate(regs) for _ in range(3)]
    ids = [j.id for j in jobs]
    assert len(set(ids)) == 12 == max(ids)
    assert len({rec["id"] for rec in _lines(results)}) == 12


def test_fold_last_wins_and_tombstone(results):
    from ai_scientist.console.jobs import JobRegistry
    reg = JobRegistry()
    j = reg.create(template="a")
    reg.update(j, status="running")
    reg.update(j, status="done")
    # journal keeps the history, the view keeps the last record
    lines = _lines(results)
    assert len(lines) == 3
    assert reg.get(j.id).status == "done"
    # manual tombstone (as TUI's 'd' key writes it)
    with open(results / "jobs.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"id": j.id, "deleted": True}) + "\n")
    fresh = JobRegistry()
    assert fresh.get(j.id) is None
    # id must not be reused after tombstone (collision with events/<id>.jsonl)
    assert fresh.create(template="b").id == j.id + 1


def test_purge_keeps_running_and_watermarks_ids(results, monkeypatch):
    from ai_scientist.console.events import append_event, event_log_path
    from ai_scientist.console.jobs import JobRegistry
    reg = JobRegistry()
    done = [reg.create(template="t") for _ in range(3)]
    live = reg.create(template="t")
    reg.update(live, status="running", pid=os.getpid())
    for j in done:
        reg.update(j, status="done")
        append_event(j.id, {"ts": "x", "run_id": j.run_id, "idea_id": "", "module": "t",
                            "stage": "run", "status": "done", "message": "m", "job_id": j.id})
    for j in done:
        assert os.path.exists(event_log_path(j.id))
    removed = reg.purge()
    assert removed == [j.id for j in done]
    assert not any(os.path.exists(event_log_path(j.id)) for j in done)
    assert reg.get(live.id) is not None  # running survives
    nxt = JobRegistry()
    assert [j.id for j in nxt.list()] == [live.id]
    assert nxt.create(template="t").id > max(j.id for j in done)  # no id reuse


def test_proclock_serializes_and_steals_stale(results):
    from ai_scientist.console.jobs import _ProcLock
    p = results / "jobs.jsonl"
    with _ProcLock(p, timeout=2):
        assert (results / "jobs.jsonl.lock").exists()
        deadline = time.time() + 2
        busy = False
        # same lock path while held -> second acquirer times out (not crashes)
        try:
            with _ProcLock(p, timeout=0.3):
                pass
        except TimeoutError:
            busy = True
        assert busy
        assert time.time() < deadline + 1
    assert not (results / "jobs.jsonl.lock").exists()
    # stale lock older than `stale` is stolen
    lock = results / "jobs.jsonl.lock"
    lock.write_text("")
    old = time.time() - 60
    os.utime(lock, (old, old))
    with _ProcLock(p, timeout=2, stale=30):
        pass


def test_cli_jobs_purge_smoke(results, capsys):
    from ai_scientist.console import cli
    from ai_scientist.console.jobs import JobRegistry
    reg = JobRegistry()
    j = reg.create(template="smoke")
    reg.update(j, status="failed")
    assert cli.main(["jobs-purge"]) == 0
    out = capsys.readouterr().out
    assert "purged 1" in out
    assert JobRegistry().list() == []


def test_duplicate_guard_blocks_second_runner(results):
    import os

    from ai_scientist.console.jobs import JobRegistry
    from ai_scientist.console.runner import execute_job

    class Mod:
        name = "writeup/paper"

        def run(self, options, job, emit, stop_event=None):
            return {"ok": True}

    reg = JobRegistry()
    live = reg.create(module="writeup/paper", template="dup")
    reg.update(live, status="running", pid=os.getpid())  # "another" process that is alive

    code = execute_job(Mod(), {"TEMPLATE": "dup"}, reg, printer=None)
    assert code == 1
    blocked = [j for j in JobRegistry().list() if j.id == live.id + 1][0]
    assert blocked.status == "failed"
    import json

    events = [json.loads(l) for l in
              open(results / "events" / f"{blocked.id}.jsonl", encoding="utf-8")]
    assert any("duplicate" in e["message"].lower() for e in events if e["status"] == "fail")
    assert events[0]["detail"]["duplicate_of"] == live.id


def test_pipeline_results_dir_honours_env(results, monkeypatch):
    from ai_scientist import settings
    from ai_scientist.pipeline import PipelineRunner
    monkeypatch.setattr(settings, "RESULTS_DIR", results / "redirected")
    r = PipelineRunner("some_tpl", "some_model")
    assert str(r.results_dir).replace("\\", "/").endswith("redirected/some_tpl")


def test_purge_reaps_zombies_keeps_live(results):
    import os
    from ai_scientist.console.jobs import JobRegistry
    reg = JobRegistry()
    zombie = reg.create(template="t")
    reg.update(zombie, status="running", pid=999999)  # dead pid
    stale_queued = reg.create(template="t", run_id="20200101_000000")
    live = reg.create(template="t")
    reg.update(live, status="running", pid=os.getpid())
    removed = reg.purge()
    assert set(removed) == {zombie.id, stale_queued.id}
    again = JobRegistry()
    assert [j.id for j in again.list()] == [live.id]
    # the zombie was closed as aborted, not silently dropped-then-revived
    assert again.get(zombie.id) is None
    fresh_z = reg.create(template="t")
    reg.update(fresh_z, status="running", pid=999999)
    assert JobRegistry().get(fresh_z.id).status == "running"  # before purge it reconciles at read-time only in TUI
