"""Task-role model routing — data-driven, no hardcoded model names.

Three research roles need different strengths:

  plan    — idea generation, novelty judgements, paper planning:
            wants a reasoner with a big context.
  code    — Aider edits (experiment.py / plot.py / template.tex):
            wants a cheap capable workhorse (tools/structured output).
  review  — the conference-referee pass: wants careful reasoning again.

Candidate ranking uses ONLY live OpenRouter catalog signals — pricing,
context_length, supported_parameters (reasoning / tools / structured_outputs),
modality and recency — combined into a capability/price value score per role.
Model-name regexes are gone (a tiny semantic prior "coder" is the only
name signal, weight 0.5).

Discovery layers, in priority order:
  1. explicit per-run args / AISC_MODEL_* env overrides
  2. automatic pick from the live OpenRouter catalog, optionally boosted by
     Tavily web discovery (TAVILY_API_KEY): "best cheap smart model for <role>"
     queries, model ids extracted from results and validated against the live
     catalog before any boost — the web can only re-rank real models, never
     invent them
  3. AISC_DEFAULT_MODEL (or openrouter.default_model())

Free-only by default; AISC_ALLOW_PAID=1 enables paid with an optional
AISC_MODEL_PRICE_CAP ($ per 1M prompt+completion). AISC_MODEL_MIN_CTX gates
candidates by context window (default 16384; 32768 for plan/review).
AISC_AUTO_MODELS=off disables layers 2 entirely. Catalog is cached by
ai_scientist.openrouter, so resolution stays offline-safe.
"""
import os
import re
import time

ROLES = ("plan", "code", "review", "discuss")

OVERRIDE_ENV = {
    "plan": "AISC_MODEL_PLAN",
    "code": "AISC_MODEL_CODE",
    "review": "AISC_REVIEW_MODEL",
    "discuss": "AISC_DISCUSS_MODEL",
}

TAVILY_TTL = 24 * 3600
TAVILY_QUERIES = {
    "plan": "best budget reasoning model OpenRouter idea generation analysis",
    "code": "best cheap small coding model OpenRouter aider agent",
    "review": "best budget model code review critique analysis OpenRouter",
    "discuss": "best cheap chat model OpenRouter",
}
# author/slug-ish tokens inside web snippets: "qwen/qwen3-coder:free"
_MODEL_ID_RE = re.compile(
    r"\b([a-z0-9][\w.-]{1,40}/[a-z0-9][\w./:-]{1,60})\b", re.IGNORECASE)


def _params(m: dict) -> list:
    v = m.get("supported_parameters")
    return list(v) if isinstance(v, list) else []


def _ctx(m: dict) -> int:
    try:
        return int(m.get("context_length") or 0)
    except (TypeError, ValueError):
        return 0


def _price_total(m: dict) -> float:
    try:
        from ai_scientist.openrouter import price_per_million
        return price_per_million(m, "prompt") + price_per_million(m, "completion")
    except Exception:
        return 0.0


def _min_ctx(role: str) -> int:
    try:
        base = int(os.environ.get("AISC_MODEL_MIN_CTX", "16384"))
    except ValueError:
        base = 16384
    return max(base, 32768) if role in ("plan", "review") else base


def _capability(m: dict, role: str) -> float:
    """Pure-catalog capability score for a role (hardcoded names don't appear)."""
    p = {x.lower(): True for x in _params(m)}
    s = 0.0
    ctx = _ctx(m)
    if role in ("plan", "review"):
        s += 2.0 * ("reasoning" in p or bool(m.get("reasoning")))
        s += 1.0 * ("structured_outputs" in p)
        s += min(ctx / 131072, 3.0)
    else:  # code
        s += 2.0 * ("tools" in p)
        s += 1.0 * ("structured_outputs" in p)
        # reasoning correlates with precise SEARCH/REPLACE on big files
        # (measured: nex-n2.5-pro:free edited a 20KB file first-try, 58s)
        s += 1.0 * ("reasoning" in p or bool(m.get("reasoning")))
        s += min(ctx / 65536, 2.0)
    arch = str((m.get("architecture") or {}).get("modality") or "")
    if "-> text" in arch or arch.endswith(">text"):
        s += 0.5
    if "coder" in str(m.get("id", "")).lower():
        s += 1.0  # semantic family prior, not a model list
    try:  # freshness: strong recent releases dominate old cheap models
        age_days = max(0.0, (time.time() - float(m.get("created") or 0)) / 86400)
        s += max(0.0, 1.5 - age_days / 240.0)
    except (TypeError, ValueError):
        pass
    return s


def _value_score(m: dict, role: str, boost=None) -> float:
    """capability / price sensitivity, with the web-discovery boost."""
    price = _price_total(m)
    cost = max(price, 0.01) if price > 0 else 0.01
    # coder workhorses must stay cheap; reasoners may cost a bit more
    sensitivity = {"code": 1.0, "discuss": 0.8}.get(role, 0.15)
    s = _capability(m, role) / (cost ** sensitivity)
    if boost and m.get("id") in boost:
        s *= 1.75  # multiplicative lift: web consensus re-orders real models
    return s


def _price_cap() -> float:
    try:
        return float(os.environ.get("AISC_MODEL_PRICE_CAP", "10"))
    except ValueError:
        return 10.0


def _candidates():
    from ai_scientist import openrouter
    try:
        models = openrouter.list_models()
    except Exception:
        return []
    if os.environ.get("AISC_ALLOW_PAID", "").lower() in ("1", "yes", "true"):
        cap = _price_cap()
        pool = [m for m in models if _price_total(m) <= cap]
    else:
        pool = openrouter.free_models(models=models)
    return pool


def _tavily_enabled() -> bool:
    return bool(os.environ.get("TAVILY_API_KEY")) and \
        os.environ.get("AISC_MODEL_WEB_DISCOVERY", "on").lower() not in ("off", "0", "no", "false")


def _tavily_search(query: str, max_results: int = 5) -> str:
    """One Tavily 'search' call -> raw content blob ('' on any failure)."""
    try:
        import requests
        r = requests.post("https://api.tavily.com/search",
                          json={"query": query, "max_results": max_results,
                                "search_depth": "basic",
                                "api_key": os.environ["TAVILY_API_KEY"]},
                          headers={"Authorization": f"Bearer {os.environ['TAVILY_API_KEY']}"},
                          timeout=15)
        if r.status_code != 200:
            return ""
        data = r.json()
        parts = [str(data.get("answer") or "")]
        parts += [str(x.get("content") or "") for x in data.get("results", [])]
        return "\n".join(parts)
    except Exception:
        return ""


def _tavily_boost(role: str, catalog_ids: set) -> set:
    """Web-discovered model ids that EXIST in the live catalog (validated).

    Cache: results/openrouter_tavily_<role>.json, TTL 24h. The web can only
    re-rank real catalog models — an invented or delisted id is dropped here.
    """
    if not _tavily_enabled() or not catalog_ids:
        return set()
    from ai_scientist import settings
    cache = settings.RESULTS_DIR / f"openrouter_tavily_{role}.json"
    try:
        import json
        if cache.exists():
            data = json.loads(cache.read_text(encoding="utf-8"))
            if time.time() - float(data.get("fetched_at", 0)) < TAVILY_TTL:
                return {x for x in data.get("ids", []) if x in catalog_ids}
    except Exception:
        pass
    blob = _tavily_search(TAVILY_QUERIES.get(role, TAVILY_QUERIES["discuss"]))
    found = []
    for tok in _MODEL_ID_RE.findall(blob):
        t = tok.lower().rstrip(".,:;)")
        t = t[len("openrouter/"):] if t.startswith("openrouter/") else t
        # articles omit the ':free' tier suffix — try it before discarding
        if t not in catalog_ids and t + ":free" in catalog_ids:
            t += ":free"
        if t in catalog_ids and t not in found:
            found.append(t)
    try:
        import json
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"fetched_at": time.time(), "ids": sorted(found)}),
                         encoding="utf-8")
    except Exception:
        pass
    return set(found)


def explicit(role: str) -> str:
    """The env override for a role ('' when unset)."""
    return (os.environ.get(OVERRIDE_ENV.get(role, ""), "") or "").strip()


def auto_enabled() -> bool:
    """AISC_AUTO_MODELS=off disables catalog auto-pick (explicit overrides
    still work)."""
    return os.environ.get("AISC_AUTO_MODELS", "on").lower() not in ("off", "0", "no", "false")


def resolve(role: str, default: str = "", pool=None) -> tuple:
    """(model, source) — source in 'env' | 'auto' | 'default' | 'none'."""
    over = explicit(role)
    if over:
        return over, "env"
    default = default or os.environ.get("AISC_DEFAULT_MODEL", "")
    if auto_enabled():
        if pool is None:
            pool = _candidates()
        gate = _min_ctx(role)
        eligible = [m for m in pool if _ctx(m) >= gate]
        if eligible:
            boost = _tavily_boost(role, {m.get("id") for m in eligible})
            ranked = sorted(eligible, key=lambda m: (-_value_score(m, role, boost), m.get("id", "")))
            best = ranked[0]
            picked = "openrouter/" + best["id"]
            # never auto-pick a provider the user has no key for
            if not picked.startswith("openrouter/") or os.environ.get("OPENROUTER_API_KEY"):
                return picked, "auto"
    if default:
        return default, "default"
    try:
        from ai_scientist import openrouter
        return openrouter.default_model(), "default"
    except Exception:
        return "", "none"


def resolved_roles(default: str = "") -> dict:
    """{role: {"model": id, "source": env|auto|default|none}} for all roles."""
    pool = _candidates() if auto_enabled() else []
    return {r: dict(zip(("model", "source"), resolve(r, default, pool=pool)))
            for r in ROLES}


def role_report_lines() -> list:
    """Human-readable /doctor lines; never raises (degrades to defaults)."""
    lines = []
    try:
        rr = resolved_roles()
    except Exception:
        rr = {r: {"model": explicit(r) or "(default)", "source": "default"}
              for r in ROLES}
    for r in ROLES:
        src = rr[r]["source"]
        if src == "auto" and _tavily_enabled():
            src = "auto (catalog+web)"
        lines.append(f"{r:<8}= {rr[r]['model']} ({src})")
    return lines
