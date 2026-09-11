"""OpenRouter model catalog for the AI-Scientist console.

Fetches https://openrouter.ai/api/v1/models, caches it for an hour, and
provides helpers to pick free/default models. Any returned model id is meant
to be used with the "openrouter/" prefix understood by ai_scientist.llm.
"""
import json
import os
import time

import requests

from ai_scientist import settings

MODELS_URL = "https://openrouter.ai/api/v1/models"
CACHE = settings.RESULTS_DIR / "openrouter_models.json"
CACHE_TTL = 3600

STATIC_FREE_FALLBACK = "openrouter/google/gemma-4-26b-a4b-it:free"
# NOTE: OpenRouter's free lineup changes often (e.g. z-ai/glm-5.2:free vanished
# from the live catalog during the 2026-09-10 E2E run). Only used when the
# catalog is unreachable; /models (TUI) always shows what is actually free now.


def list_models(force=False):
    """Return the raw model list (list of dicts), cached for CACHE_TTL."""
    if not force and CACHE.exists():
        try:
            data = json.loads(CACHE.read_text(encoding="utf-8"))
            if time.time() - data.get("fetched_at", 0) < CACHE_TTL and data.get("models"):
                return data["models"]
        except Exception:
            pass
    headers = {}
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        headers["Authorization"] = f"Bearer {key}"
    rsp = requests.get(MODELS_URL, headers=headers, timeout=30)
    rsp.raise_for_status()
    models = rsp.json()["data"]
    try:
        settings.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(
            {"fetched_at": time.time(), "models": models}, ensure_ascii=False),
            encoding="utf-8")
    except Exception:
        pass
    return models


def price_per_million(model: dict, kind="prompt"):
    try:
        return float(model["pricing"][kind]) * 1_000_000
    except Exception:
        return None


def is_free(model: dict) -> bool:
    if model.get("id", "").endswith(":free"):
        return True
    p, c = price_per_million(model, "prompt"), price_per_million(model, "completion")
    return p == 0.0 and c == 0.0


def describe(model: dict) -> str:
    """One-line human description for pickers."""
    ctx = model.get("context_length")
    ctx_s = f"{ctx // 1000}k" if isinstance(ctx, int) and ctx >= 1000 else str(ctx)
    p, c = price_per_million(model), price_per_million(model, "completion")
    if is_free(model):
        price_s = "FREE"
    elif p is not None:
        price_s = f"${p:.2f}/${c:.2f}/1M tok"
    else:
        price_s = "?"
    name = model.get("name") or model.get("id")
    return f"{model['id']}  ·  {name}  ·  ctx {ctx_s}  ·  {price_s}"


def free_models(models=None):
    models = models if models is not None else list_models()
    return [m for m in models if is_free(m)]


def search(query, models=None):
    q = (query or "").lower()
    models = models if models is not None else list_models()
    return [m for m in models
            if q in m.get("id", "").lower() or q in (m.get("name") or "").lower()]


def default_model() -> str:
    """Default (free for testing) model with the openrouter/ prefix."""
    env = os.environ.get("AISC_DEFAULT_MODEL")
    if env:
        return env
    try:
        free = free_models()
        if free:
            # Priority: proven families, then any free model.
            for fam in ("glm", "deepseek", "llama", "qwen", "mistral", "gemma"):
                for m in free:
                    if fam in m["id"].lower():
                        return "openrouter/" + m["id"]
            return "openrouter/" + free[0]["id"]
    except Exception:
        pass
    return STATIC_FREE_FALLBACK


def as_client_model(model: str = "") -> str:
    """Normalize a UI model id to what ai_scientist.llm.create_client expects.

    "" -> default model. "anthropic/claude-..." (bare OpenRouter id) gets the
    "openrouter/" prefix; native ids (claude-*, gpt-*) pass through untouched.
    """
    model = (model or "").strip()
    if not model:
        return default_model()
    if model.startswith(("openrouter/", "ollama/", "bedrock/", "vertex_ai/")):
        return model
    if "/" in model and not model.startswith(("bedrock", "vertex_ai")):
        return "openrouter/" + model
    return model
