"""Дефолты консоли `aiscientist` — файл `aiscientist.toml` в корне репо.

Это НЕ секреты: ключ и модель живут в `.env`. Здесь только то, что делает
старт «исследование уже настроено»: модуль по умолчанию, шаблон, идея.

Формат (создаётся автоматически, если отсутствует):

    default_module = "pipeline/run"
    default_template = ""        # пусто = первый шаблон из templates/
    default_idea = ""            # пусто = без фильтра по идее
"""
from ai_scientist import settings

CONFIG_NAME = "aiscientist.toml"

DEFAULTS = {
    "default_module": "pipeline/run",
    "default_template": "",
    "default_idea": "",
}


def config_path():
    return settings.PROJECT_ROOT / CONFIG_NAME


def _default_toml_text() -> str:
    return (
        "# Дефолты консоли aiscientist (Beta 1).\n"
        "# Ключ и модель — в .env (см. .env.example); это не секреты.\n"
        f'default_module = "{DEFAULTS["default_module"]}"\n'
        'default_template = ""        # пусто = первый шаблон из templates/\n'
        'default_idea = ""            # пусто = без фильтра по идее\n'
    )


def ensure_config():
    """Создаёт aiscientist.toml с дефолтами, если его нет."""
    p = config_path()
    if not p.exists():
        try:
            p.write_text(_default_toml_text(), encoding="utf-8")
        except Exception:
            pass
    return p


def load_defaults() -> dict:
    """Читает дефолты; при любой ошибке — безопасные значения."""
    ensure_config()
    out = dict(DEFAULTS)
    try:
        import tomllib  # Python 3.11+
        with open(config_path(), "rb") as f:
            data = tomllib.load(f)
        for k in DEFAULTS:
            if k in data:
                out[k] = str(data[k])
    except Exception:
        pass
    return out
