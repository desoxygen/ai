"""Тесты openrouter-каталога (без сети) и llm-обвязки."""
import pytest

from ai_scientist import openrouter as orr


MODELS = [
    {"id": "z-ai/glm-5.2:free", "name": "GLM 5.2 (free)", "context_length": 128000,
     "pricing": {"prompt": "0", "completion": "0"}},
    {"id": "openai/gpt-4o-mini", "name": "GPT-4o mini", "context_length": 128000,
     "pricing": {"prompt": "0.00000015", "completion": "0.0000006"}},
    {"id": "deepseek/deepseek-chat", "name": "DeepSeek Chat", "context_length": 64000,
     "pricing": {"prompt": "0.00000014", "completion": "0.00000028"}},
]


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    monkeypatch.setattr(orr, "list_models", lambda force=False: list(MODELS))


def test_is_free():
    assert orr.is_free(MODELS[0])
    assert not orr.is_free(MODELS[1])
    assert orr.free_models() == [MODELS[0]]


def test_describe_contains_price_and_context():
    s = orr.describe(MODELS[0])
    assert "FREE" in s and "128k" in s
    s2 = orr.describe(MODELS[1])
    assert "$0.15" in s2  # 0.00000015 * 1e6


def test_search():
    assert orr.search("glm") == [MODELS[0]]
    assert orr.search("gpt-4o") == [MODELS[1]]
    assert orr.search("неттакого") == []


def test_default_model_prefers_free(tmp_vault, monkeypatch):
    monkeypatch.delenv("AISC_DEFAULT_MODEL", raising=False)
    assert orr.default_model() == "openrouter/z-ai/glm-5.2:free"
    monkeypatch.setenv("AISC_DEFAULT_MODEL", "openrouter/x/y")
    assert orr.default_model() == "openrouter/x/y"


# ------------------------------- llm.py -------------------------------------

def test_extract_json_between_markers_variants():
    from ai_scientist.llm import extract_json_between_markers as ex
    assert ex('```json\n{"a": 1}\n```') == {"a": 1}
    assert ex('преамбула {"a": {"b": 2}} хвост') == {"a": {"b": 2}}
    assert ex('{"a": 1, "b": "x\x01y"}') == {"a": 1, "b": "xy"}
    assert ex("совсем без json") is None


def test_create_client_routing(monkeypatch):
    import anthropic
    import openai as openai_mod
    from ai_scientist.llm import create_client
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    client, model = create_client("claude-3-5-sonnet-20240620")
    assert isinstance(client, anthropic.Anthropic) and model == "claude-3-5-sonnet-20240620"

    client, model = create_client("gpt-4o")
    assert isinstance(client, openai_mod.OpenAI) and model == "gpt-4o"

    client, model = create_client("openrouter/meta-llama/llama-3.3-70b-instruct")
    assert isinstance(client, openai_mod.OpenAI)
    assert model.startswith("openrouter/")
    assert "openrouter.ai" in str(client.base_url)


def test_available_llms_contains_openrouter_entries():
    from ai_scientist.llm import AVAILABLE_LLMS
    assert "openrouter/meta-llama/llama-3.3-70b-instruct" in AVAILABLE_LLMS
    assert "openrouter/deepseek/deepseek-chat" in AVAILABLE_LLMS
    # A free model id that vanished from the live catalog must not be pinned.
    assert "openrouter/z-ai/glm-5.2:free" not in AVAILABLE_LLMS


def test_llm_wrappers_exist():
    import ai_scientist.llm as llm
    assert callable(llm.get_response_from_llm)
    assert callable(llm.get_batch_responses_from_llm)
    assert callable(llm._get_response_from_llm_raw)
    assert callable(llm._get_batch_responses_from_llm_raw)
