"""The research assistant: pipeline commands exposed as model tools.

docs/STRESS-TESTS era follow-up: /run /paper /skeleton should be model
decisions, not user incantations. These tests are hermetic — the LLM is a
scripted fake, and the only real tool executed is report/last (offline-safe).
"""
import json
import types

import pytest


@pytest.fixture()
def results(tmp_path, monkeypatch):
    from ai_scientist import settings
    d = tmp_path / "results"
    d.mkdir()
    monkeypatch.setattr(settings, "RESULTS_DIR", d)
    return d


def _resp(content=None, tool_calls=None):
    msg = types.SimpleNamespace(content=content, tool_calls=tool_calls)
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])


def _call(cid, name, args):
    return types.SimpleNamespace(
        id=cid,
        function=types.SimpleNamespace(name=name, arguments=json.dumps(args)),
        model_dump=lambda: {"id": cid, "type": "function",
                            "function": {"name": name, "arguments": json.dumps(args)}},
    )


class FakeClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

        class _Completions:
            def __init__(self, outer):
                self.outer = outer

            def create(self, **kw):
                self.outer.calls.append(kw)
                return self.outer._responses.pop(0)

        self.chat = types.SimpleNamespace(completions=_Completions(self))


def test_tool_specs_derive_from_manifests():
    from ai_scientist.console import assistant
    specs = assistant.tool_specs()
    names = {s["function"]["name"] for s in specs}
    assert {"run_pipeline", "write_paper", "skeleton_project", "doctor"} <= names
    run = next(s for s in specs if s["function"]["name"] == "run_pipeline")
    assert "TEMPLATE" in run["function"]["parameters"]["properties"]
    assert "TEMPLATE" in run["function"]["parameters"]["required"]
    paper = next(s for s in specs if s["function"]["name"] == "write_paper")
    assert "on" in paper["function"]["parameters"]["properties"]["IMPROVE"]["enum"]


def test_execute_tool_runs_a_real_job(results):
    from ai_scientist.console import assistant
    from ai_scientist.console.jobs import JobRegistry
    out = assistant.execute_tool("last_report", {}, jobs=JobRegistry())
    assert out["exit_code"] == 0
    assert out["job_status"] == "done"
    assert out["job_id"] == 1
    assert JobRegistry().get(1).module == "report/last"


def test_ask_loop_fires_tools_then_answers(results, monkeypatch):
    from ai_scientist.console import assistant

    fake = FakeClient([
        _resp(tool_calls=[_call("c1", "doctor", {})]),
        _resp(content="Готово: окружение проверено (job #1). Следующий шаг — запустить run_pipeline."),
    ])
    monkeypatch.setattr(assistant, "tool_specs", lambda: [
        {"type": "function", "function": {"name": "doctor", "description": "env",
                                          "parameters": {"type": "object", "properties": {}, "required": []}}},
        {"type": "function", "function": {"name": "last_report", "description": "rep",
                                          "parameters": {"type": "object", "properties": {}, "required": []}}},
    ])
    monkeypatch.setattr("ai_scientist.llm.create_client", lambda m: (fake, "openrouter/test/model"))
    events = []
    out = assistant.ask("проверь окружение и скажи что дальше",
                        model="openrouter/test/model",
                        emit=lambda s, st, msg, **kw: events.append((st, msg)))
    assert out["ok"] and "job #1" in out["answer"]
    assert fake.calls[0]["tools"], "tools must be passed to the API"
    assert out["tool_calls"][0]["result"]["job_status"] == "done"
    assert out["job_ids"] == [1]
    assert any(e[0] == "done" for e in events)
    # the tool result was fed back to the model as a tool message
    assert len(fake.calls) == 2
    fed = fake.calls[1]["messages"]
    assert any(m.get("role") == "tool" for m in fed)


def test_ask_tool_error_is_data_not_crash(results, monkeypatch):
    from ai_scientist.console import assistant

    fake = FakeClient([
        _resp(tool_calls=[_call("c1", "nonexistent_tool", {})]),
        _resp(content="ok"),
    ])
    monkeypatch.setattr("ai_scientist.llm.create_client", lambda m: (fake, "openrouter/test/model"))
    out = assistant.ask("x", model="openrouter/test/model")
    assert out["ok"]
    assert "unknown tool" in out["tool_calls"][0]["result"]["error"]


def test_ask_requires_openai_compatible_router(monkeypatch):
    from ai_scientist.console import assistant
    monkeypatch.setattr("ai_scientist.llm.create_client", lambda m: (object(), "claude-3"))
    with pytest.raises(ValueError, match="OpenAI-compatible"):
        assistant.ask("x", model="claude-3")


def test_cli_ask_dispatch():
    from ai_scientist.console import cli
    # no task -> usage error, exit 2 (never launches a model)
    assert cli.main(["-q", "--lang", "en", "ask"]) == 2


def test_parse_text_tool_calls_salvages_known_tools():
    from ai_scientist.console import assistant
    p = assistant.parse_text_tool_calls
    # bare JSON the Ollama shim returns in content
    got = p('Sure: {"name": "doctor", "arguments": {}}')
    assert [c["name"] for c in got] == ["doctor"]
    # hermes/qwen  wrapper
    hermes = '<tool_call>{"name": "last_report", "arguments": {}}</tool_call>'
    assert [c["name"] for c in p(hermes)] == ["last_report"]
    # unknown tool must NOT be hijacked (could be a real answer mentioning JSON)
    assert p('{"name": "rm", "arguments": {"rf": "/"}}') == []
    # a normal sentence stays empty
    assert p("the run finished, score 7/10") == []


def test_ask_loop_salvages_text_tool_call(results, monkeypatch):
    from ai_scientist.console import assistant

    # model emits the call as plain content, no native tool_calls
    fake = FakeClient([
        _resp(content='{"name": "last_report", "arguments": {}}'),
        _resp(content="last run had no artifacts"),
    ])
    monkeypatch.setattr("ai_scientist.llm.create_client", lambda m: (fake, "ollama/llama3"))
    out = assistant.ask("что дал последний прогон", model="ollama/llama3")
    assert out["ok"] and out["job_ids"] == [1]
    assert out["tool_calls"][0]["tool"] == "last_report"

