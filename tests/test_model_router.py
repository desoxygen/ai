"""Unit tests for task-role model routing — fully offline.

The mock catalog uses REAL OpenRouter fields (pricing / context_length /
supported_parameters / architecture / created): ranking must work off catalog
data, not hardcoded model names. Tavily is tested via a stubbed search blob —
never the network.
"""
import json
import time

import pytest

from ai_scientist import model_router as mr

_NOW = int(time.time())


def _m(id_, ctx=32768, free=True, params=(), modality="text->text", created=_NOW, reasoning=False):
    # OpenRouter pricing is per TOKEN: $10+$30 per 1M -> 0.00001 + 0.00003
    price = {"prompt": "0", "completion": "0"} if free else {"prompt": "0.00001", "completion": "0.00003"}
    return {"id": id_, "name": id_, "context_length": ctx, "pricing": price,
            "supported_parameters": list(params), "reasoning": reasoning,
            "architecture": {"modality": modality}, "created": created}


CATALOG = [
    # cheap coder workhorse: tools + structured, mid context
    _m("qwen/qwen3-coder-flash:free", ctx=32768,
       params=("tools", "structured_outputs", "temperature")),
    # big reasoner: no tools flag, huge context
    _m("nvidia/nemotron-3-ultra-550b:free", ctx=131072,
       params=("reasoning", "structured_outputs", "temperature")),
    # tiny model: below every context gate
    _m("liquid/lfm-2.5-2.6b:free", ctx=4096, params=("temperature",)),
    # old model: same signals as the reasoner but stale (recency penalty)
    _m("old/vendor-ancient:free", ctx=131072,
       params=("reasoning", "structured_outputs"), created=_NOW - 700 * 86400),
    # paid flagship (excluded while AISC_ALLOW_PAID is off)
    _m("top/vendor-max:paid", ctx=200000, free=False,
       params=("reasoning", "tools", "structured_outputs")),
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for key in ("AISC_MODEL_PLAN", "AISC_MODEL_CODE", "AISC_REVIEW_MODEL",
                "AISC_DISCUSS_MODEL", "AISC_DEFAULT_MODEL", "AISC_AUTO_MODELS",
                "AISC_ALLOW_PAID", "AISC_MODEL_PRICE_CAP", "AISC_MODEL_MIN_CTX",
                "AISC_MODEL_WEB_DISCOVERY", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    # stub the CATALOG source, not the pipeline: _candidates() filtering
    # (free-only / price cap) must run for real
    import ai_scientist.openrouter as orr
    monkeypatch.setattr(orr, "list_models", lambda force=False: list(CATALOG))
    # web discovery off unless a test explicitly enables it
    monkeypatch.setattr(mr, "_tavily_enabled", lambda: False)


def test_code_role_picks_capable_cheap_workhorse():
    m, src = mr.resolve("code")
    assert src == "auto" and m == "openrouter/qwen/qwen3-coder-flash:free"


def test_plan_role_picks_reasoner_with_big_context():
    m, src = mr.resolve("plan")
    assert src == "auto" and m == "openrouter/nvidia/nemotron-3-ultra-550b:free"


def test_recency_prefers_fresh_equivalent():
    # nemotron beats the stale same-signals 'ancient' model via recency bonus
    assert mr._value_score(CATALOG[1], "plan") > mr._value_score(CATALOG[3], "plan")


def test_context_gate_excludes_tiny_and_gates_role():
    assert mr._min_ctx("code") == 16384
    assert mr._min_ctx("plan") == 32768
    m, _ = mr.resolve("plan")
    assert "lfm-2.5-2.6b" not in m


def test_paid_models_need_allow_paid(monkeypatch):
    # off: paid models are not even candidates
    m, _ = mr.resolve("plan")
    assert "top/vendor-max" not in m
    monkeypatch.setenv("AISC_ALLOW_PAID", "1")
    # on, but cheap-first: a paid model must BEAT the free value score,
    # a merely-better-but-much-pricier one still loses (by design)
    m2, _ = mr.resolve("plan")
    assert m2 == "openrouter/nvidia/nemotron-3-ultra-550b:free"
    # on + context gate that only the paid flagship passes -> it is picked
    monkeypatch.setenv("AISC_MODEL_PRICE_CAP", "100")
    monkeypatch.setenv("AISC_MODEL_MIN_CTX", "150000")
    m3, _ = mr.resolve("plan")
    assert m3 == "openrouter/top/vendor-max:paid"
    # price cap can veto it even then
    monkeypatch.setenv("AISC_MODEL_PRICE_CAP", "1")
    m4, _ = mr.resolve("plan")
    assert m4 != "openrouter/top/vendor-max:paid"


def test_explicit_override_beats_everything(monkeypatch):
    monkeypatch.setenv("AISC_MODEL_CODE", "ollama/qwen2.5-coder")
    assert mr.resolve("code") == ("ollama/qwen2.5-coder", "env")


def test_auto_disabled_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("AISC_AUTO_MODELS", "off")
    assert mr.resolve("code", default="m-base") == ("m-base", "default")


def test_no_openrouter_key_blocks_auto_pick(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY")
    assert mr.resolve("code", default="ollama/local") == ("ollama/local", "default")


def test_empty_catalog_falls_back(monkeypatch):
    import ai_scientist.openrouter as orr
    monkeypatch.setattr(orr, "list_models", lambda force=False: [])
    monkeypatch.setenv("AISC_DEFAULT_MODEL", "m")
    assert mr.resolve("plan", default="m") == ("m", "default")


# ------------------------------------------------------------------ tavily


def test_tavily_boosts_only_catalog_validated_ids(tmp_path, monkeypatch):
    monkeypatch.setattr(mr, "_tavily_enabled", lambda: True)
    from ai_scientist import settings
    monkeypatch.setattr(settings, "RESULTS_DIR", tmp_path)
    blob = ("Best budget coder: qwen/qwen3-coder-flash:free is great. "
            "Also see ghost/vendor-not-in-catalog and nvidia/nemotron-3-ultra-550b:free.")
    calls = []

    def fake_search(query, max_results=5):
        calls.append(query)
        return blob

    monkeypatch.setattr(mr, "_tavily_search", fake_search)
    ids = {m["id"] for m in CATALOG}
    boost = mr._tavily_boost("code", ids)
    # the invented id must be dropped; catalog ids kept
    assert boost == {"qwen/qwen3-coder-flash:free", "nvidia/nemotron-3-ultra-550b:free"}
    assert any("coder" in q.lower() or "coding" in q.lower() for q in calls)
    cache = tmp_path / "openrouter_tavily_code.json"
    assert cache.exists()
    assert json.loads(cache.read_text(encoding="utf-8"))["ids"] == sorted(boost)
    # second call served from cache (no extra search)
    mr._tavily_boost("code", ids)
    assert len(calls) == 1


def test_tavily_failure_degrades_to_catalog_only(tmp_path, monkeypatch):
    monkeypatch.setattr(mr, "_tavily_enabled", lambda: True)
    from ai_scientist import settings
    monkeypatch.setattr(settings, "RESULTS_DIR", tmp_path)
    monkeypatch.setattr(mr, "_tavily_search", lambda *a, **k: "")
    assert mr._tavily_boost("plan", {"a/b"}) == set()
    m, src = mr.resolve("plan")
    assert src == "auto" and m.endswith("nemotron-3-ultra-550b:free")


def test_tavily_can_lift_a_second_place_model(tmp_path, monkeypatch):
    """With a web boost the ranking may change — but only among real models."""
    monkeypatch.setattr(mr, "_tavily_enabled", lambda: True)
    from ai_scientist import settings
    monkeypatch.setattr(settings, "RESULTS_DIR", tmp_path)
    monkeypatch.setattr(mr, "_tavily_search",
                        lambda *a, **k: "use nvidia/nemotron-3-ultra-550b:free for coding")
    m, src = mr.resolve("code")
    assert src == "auto" and m == "openrouter/nvidia/nemotron-3-ultra-550b:free"


# ---------------------------------------------------------- wiring/report


def test_resolved_roles_shape():
    rr = mr.resolved_roles()
    assert set(rr) == {"plan", "code", "review", "discuss"}
    assert all("model" in v and "source" in v for v in rr.values())


def test_role_report_lines_never_raise(monkeypatch):
    monkeypatch.setattr(mr, "resolved_roles",
                        lambda default="": (_ for _ in ()).throw(RuntimeError("boom")))
    assert len(mr.role_report_lines()) == 4


def test_pipeline_uses_role_models(tmp_path, monkeypatch):
    """PipelineRunner: models dict > env; coder resolves code role lazily."""
    from ai_scientist.pipeline import PipelineRunner
    r = PipelineRunner("tpl", "base-model", models={"code": "coder-x"})
    assert r.code_model == "coder-x"
    assert r.plan_model == "base-model"
    monkeypatch.setenv("AISC_MODEL_PLAN", "openrouter/some-plan")
    r2 = PipelineRunner("tpl", "base-model")
    assert r2.plan_model == "openrouter/some-plan"
