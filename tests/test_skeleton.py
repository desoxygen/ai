"""Тесты generate/skeleton: запись каркаса, само-починка baseline, отказ без кода."""
import json

import pytest

from ai_scientist import llm
from ai_scientist.console.modules.generate import skeleton as sk
from ai_scientist.console.registry import ModuleRegistry


def _fake_llm(monkeypatch, replies):
    seq = list(replies)

    def fake(msg, client=None, model=None, system_message=None, **kw):
        text = seq.pop(0) if seq else "```python\nprint('filler')\n```"
        return text, []

    monkeypatch.setattr(llm, "get_response_from_llm", fake)
    monkeypatch.setattr(llm, "create_client", lambda model: (None, model))


def _opts(tmp_path, **kw):
    o = {"NAME": "skel_proj", "DESCRIPTION": "Compare lr schedules on a tiny MLP for toy regression.",
         "MODEL": "fake-model", "RUN_BASELINE": "off"}
    o.update(kw)
    return o


@pytest.fixture()
def in_tmp(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_registry_discovers_skeleton():
    mods = {m.name for m in ModuleRegistry().list()}
    assert "generate/skeleton" in mods


def test_writes_files_without_baseline(in_tmp, monkeypatch):
    _fake_llm(monkeypatch, [
        "```python\nimport argparse\nprint('exp')\n```",
        "```python\nimport matplotlib\nmatplotlib.use('Agg')\nprint('plot')\n```",
    ])
    events = []
    res = sk.run(_opts(in_tmp), job=None,
                 emit=lambda s, st, m, **kw: events.append((s, st)))
    assert res["ok"] and res["baseline_ok"] is None
    base = in_tmp / "templates" / "skel_proj"
    for f in ("experiment.py", "plot.py", "prompt.json", "seed_ideas.json"):
        assert (base / f).exists(), f
    json.loads((base / "prompt.json").read_text(encoding="utf-8"))
    assert events[0] == ("skeleton", "started")
    assert events[-1] == ("skeleton", "done")


def test_baseline_success(in_tmp, monkeypatch):
    _fake_llm(monkeypatch, ["```python\npass\n```"] * 2)

    def fake_run(cmd, cwd=None, **kw):
        out = __import__("pathlib").Path(cwd) / "run_0"
        out.mkdir(exist_ok=True)
        (out / "final_info.json").write_text(
            json.dumps({"val_loss": {"means": 0.5, "stds": 0.1}}))
        return type("P", (), {"returncode": 0, "stdout": "ok", "stderr": ""})()

    monkeypatch.setattr(sk.subprocess, "run", fake_run)
    res = sk.run(_opts(in_tmp, RUN_BASELINE="on"), job=None,
                 emit=lambda s, st, m, **kw: None)
    assert res["ok"] and res["baseline_ok"] is True


def test_baseline_self_heals_once(in_tmp, monkeypatch):
    _fake_llm(monkeypatch, ["```python\nbad\n```", "```python\nplot\n```",
                            "```python\ngood\n```"])
    state = {"n": 0}

    def fake_run(cmd, cwd=None, **kw):
        state["n"] += 1
        if state["n"] == 1:
            return type("P", (), {"returncode": 1, "stdout": "", "stderr": "KeyError: boom"})()
        out = __import__("pathlib").Path(cwd) / "run_0"
        out.mkdir(exist_ok=True)
        (out / "final_info.json").write_text(json.dumps({"val_loss": {"means": 1.0, "stds": 0.0}}))
        return type("P", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(sk.subprocess, "run", fake_run)
    res = sk.run(_opts(in_tmp, RUN_BASELINE="on"), job=None,
                 emit=lambda s, st, m, **kw: None)
    assert res["ok"] and res["baseline_ok"] is True
    exp = (in_tmp / "templates" / "skel_proj" / "experiment.py").read_text(encoding="utf-8")
    assert "good" in exp


def test_no_code_fails_gracefully(in_tmp, monkeypatch):
    _fake_llm(monkeypatch, ["проза без кода", "снова проза",
                            "ещё проза", "и опять проза"])
    events = []
    res = sk.run(_opts(in_tmp), job=None,
                 emit=lambda s, st, m, **kw: events.append((s, st)))
    assert res["ok"] is False and "experiment.py" in res["error"]
    assert ("skeleton", "fail") in events
    assert not [e for e in events if e[1] == "done"] or events[-1][1] == "fail"


def test_invalid_names_rejected(in_tmp, monkeypatch):
    _fake_llm(monkeypatch, [])
    with pytest.raises(ValueError):
        sk.run(_opts(in_tmp, NAME="../escape"), job=None, emit=lambda *a, **k: None)
    with pytest.raises(ValueError):
        sk.run(_opts(in_tmp, DESCRIPTION=""), job=None, emit=lambda *a, **k: None)
