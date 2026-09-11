"""auxiliary/env — check environment: API keys, model, LaTeX, vault.

Shows only presence/absence of keys — secrets are never printed.
"""
import os
import shutil

MANIFEST = {
    "type": "auxiliary",
    "description": "check environment: API keys, model, LaTeX, vault",
    "options": {},
}

_API_KEYS = (
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "GEMINI_API_KEY",
    "S2_API_KEY",
)


def provider_key_for(model: str) -> str:
    """Which API key a model id requires ('' = none needed / unknown)."""
    m = (model or "").strip()
    if not m:
        return ""
    if m.startswith("openrouter/") or m == "llama3.1-405b":
        return "OPENROUTER_API_KEY"
    if m.startswith("ollama/"):
        return ""  # no key, but the local server must be running
    if m.startswith(("claude-", "bedrock", "vertex_ai")):
        return "ANTHROPIC_API_KEY"
    if "gemini" in m:
        return "GEMINI_API_KEY"
    if m.startswith("deepseek-"):
        return "DEEPSEEK_API_KEY"
    if "gpt" in m or m.startswith(("o1", "o3")):
        return "OPENAI_API_KEY"
    return ""


def ollama_reachable(base_url: str, timeout: float = 1.0) -> bool:
    import urllib.request
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(base_url.rstrip("/") + "/api/tags", timeout=timeout):
            return True
    except Exception:
        return False


def run(options, job, emit, stop_event=None):
    from ai_scientist import settings
    from ai_scientist.console.i18n import get as _t

    emit("system", "log", _t("env_workdir", settings.PROJECT_ROOT))
    for key in _API_KEYS:
        state = _t("env_key_set", key) if os.environ.get(key) else _t("env_key_unset", key)
        emit("system", "log", state)

    default_model = os.environ.get("AISC_DEFAULT_MODEL", "")
    emit("system", "log", _t("env_model", default_model) if default_model else _t("env_model_unset"))

    # Cross-check: the default model's provider must actually have a key.
    need = provider_key_for(default_model)
    if need:
        if os.environ.get(need):
            emit("system", "log", _t("env_model_key_ok", need))
        else:
            emit("system", "log", _t("env_model_key_missing", default_model, need))
    if default_model.startswith("ollama/"):
        host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
        if ollama_reachable(host):
            emit("system", "log", _t("env_ollama_up", host))
        else:
            emit("system", "log", _t("env_ollama_down", host))

    # Task-role model routing (plan/code/review/discuss).
    try:
        from ai_scientist import model_router
        emit("system", "log", "model roles (plan/code/review/discuss):")
        for line in model_router.role_report_lines():
            emit("system", "log", "  " + line)
    except Exception as e:
        emit("system", "log", _t("env_roles_error", e))

    latex = {dep: shutil.which(dep) is not None for dep in ("pdflatex", "chktex")}
    pd_status = _t("env_latex_ok") if latex["pdflatex"] else _t("env_latex_no")
    ch_status = _t("env_latex_ok") if latex["chktex"] else _t("env_latex_no")
    emit("system", "log", f"LaTeX: pdflatex={pd_status}, chktex={ch_status}")

    try:
        emit("system", "log", _t("env_vault_found", settings.get_vault_path()))
    except Exception as e:
        emit("system", "log", _t("env_vault_missing", e))

    emit("system", "log",
         f"guard: AISC_STAGE_MAX_FAILURES={settings.GUARD.stage_max_failures}, "
         f"AISC_INTERACTIVE={settings.GUARD.interactive}")
    return {"ok": True}
