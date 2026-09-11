"""Tests for the /doctor environment checks (auxiliary/env): the default
model's provider must have a key, and Ollama must actually be reachable."""
import pytest

from ai_scientist.console.modules.auxiliary.env import (
    ollama_reachable, provider_key_for, run,
)


@pytest.mark.parametrize("model,key", [
    ("openrouter/z-ai/glm-5.2:free", "OPENROUTER_API_KEY"),
    ("llama3.1-405b", "OPENROUTER_API_KEY"),
    ("ollama/qwen2.5-coder:7b-instruct-q4_K_M", ""),
    ("claude-3-5-sonnet-20241022", "ANTHROPIC_API_KEY"),
    ("bedrock/anthropic.claude-3-opus-20240229-v1:0", "ANTHROPIC_API_KEY"),
    ("vertex_ai/claude-3-haiku@20240307", "ANTHROPIC_API_KEY"),
    ("gemini-2.0-flash", "GEMINI_API_KEY"),
    ("deepseek-chat", "DEEPSEEK_API_KEY"),
    ("gpt-4o", "OPENAI_API_KEY"),
    ("o3-mini", "OPENAI_API_KEY"),
    ("", ""),
    ("some/other/model", ""),
])
def test_provider_key_for(model, key):
    assert provider_key_for(model) == key


def test_ollama_reachable_false_for_closed_port():
    assert ollama_reachable("http://127.0.0.1:9", timeout=0.5) is False


def test_env_run_warns_on_provider_key_mismatch(monkeypatch):
    monkeypatch.setenv("AISC_DEFAULT_MODEL", "openrouter/z-ai/glm-5.2:free")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    from ai_scientist import model_router
    monkeypatch.setattr(model_router, "_candidates", lambda: [])  # no network
    logs = []

    def emit(stage, status, msg, **kw):
        logs.append(msg)

    result = run({}, None, emit)

    assert result == {"ok": True}
    assert any("WARNING" in line and "OPENROUTER_API_KEY" in line for line in logs)


def test_env_run_ok_when_key_set(monkeypatch):
    monkeypatch.setenv("AISC_DEFAULT_MODEL", "openrouter/z-ai/glm-5.2:free")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    from ai_scientist import model_router
    monkeypatch.setattr(model_router, "_candidates", lambda: [])
    logs = []

    def emit(stage, status, msg, **kw):
        logs.append(msg)

    run({}, None, emit)

    assert not any("WARNING" in line and "OPENROUTER_API_KEY" in line for line in logs)
    assert any("OPENROUTER_API_KEY is set" in line for line in logs)
