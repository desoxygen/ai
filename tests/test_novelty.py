"""Regression for the novelty loop: when the paper search finds nothing
(search_for_papers -> None), the round must end cleanly ("No papers found.")
instead of raising inside the try-block and logging a guard failure."""
import json
from pathlib import Path

from ai_scientist import generate_ideas as gi
from ai_scientist import settings


def test_novelty_search_none_does_not_fail_round(tmp_path, monkeypatch):
    monkeypatch.setenv("AISC_INTERACTIVE", "no")
    base = tmp_path / "tpl"
    base.mkdir()
    (base / "experiment.py").write_text("pass\n", encoding="utf-8")
    (base / "prompt.json").write_text(
        json.dumps({"system": "s", "task_description": "t"}), encoding="utf-8")

    replies = [
        'THOUGHT: need a search\nRESPONSE:\n```json\n{"Query": "grokking onset"}\n```',
        "THOUGHT: enough\nDecision made: not novel after round 1",
    ]

    def fake_llm(msg, **kw):
        return replies.pop(0), []

    monkeypatch.setattr(gi, "get_response_from_llm", fake_llm)
    monkeypatch.setattr(gi, "search_for_papers", lambda *a, **k: None)

    ideas = [{"Name": "e1", "Title": "T", "Experiment": "E"}]
    out = gi.check_idea_novelty(ideas, base_dir=str(base), client=None,
                                model="fake", max_num_iterations=3)

    assert out[0]["novel"] is False
    log = Path(settings.GUARD_LOG)
    if log.exists():
        events = [json.loads(line) for line in
                  log.read_text(encoding="utf-8").splitlines()]
        fails = [e for e in events
                 if e.get("type") == "failure" and "novelty:e1" in str(e.get("stage"))]
        assert not fails, fails
