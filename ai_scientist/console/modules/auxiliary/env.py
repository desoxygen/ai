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


def run(options, job, emit, stop_event=None):
    from ai_scientist import settings
    from ai_scientist.console.i18n import get as _t

    emit("system", "log", _t("env_workdir", settings.PROJECT_ROOT))
    for key in _API_KEYS:
        state = _t("env_key_set", key) if os.environ.get(key) else _t("env_key_unset", key)
        emit("system", "log", state)

    default_model = os.environ.get("AISC_DEFAULT_MODEL", "")
    emit("system", "log", _t("env_model", default_model) if default_model else _t("env_model_unset"))

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
