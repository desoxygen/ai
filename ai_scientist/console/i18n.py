"""i18n - translations for the hidden headless runner (`aiscientist -q ...`).

The only user-facing interface is the TUI in `opencode-tui/`; these strings
serve the debug CLI and module error messages. Default language: English -
set `AISC_LANG=ru` to switch.
"""
import os

_current = os.environ.get("AISC_LANG", "en").lower()

_translations = {
    "cli_template_help": {
        "en": 'template from templates/',
        "ru": 'шаблон из templates/',
    },
    "cli_model_help": {
        "en": 'model (empty = default)',
        "ru": 'модель (пусто = default)',
    },
    "cli_idea_help": {
        "en": 'run only this idea (by Name)',
        "ru": 'запустить только эту идею (по Name)',
    },
    "cli_job_help": {
        "en": 'job id',
        "ru": "id job'а",
    },
    "cli_status_empty": {
        "en": '[*] no runs yet',
        "ru": '[*] прогонов пока нет',
    },
    "cli_module_not_found": {
        "en": 'aiscientist: module pipeline/run not found',
        "ru": 'aiscientist: модуль pipeline/run не найден',
    },
    "cli_unknown_command": {
        "en": 'aiscientist: unknown command `%s`. Type `help`.',
        "ru": 'aiscientist: неизвестная команда `%s`. Наберите `help`.',
    },
    "cli_interrupted": {
        "en": '\nInterrupted.',
        "ru": '\nПрервано.',
    },
    "cli_tui_unavailable": {
        "en": 'aiscientist: TUI unavailable (%s).',
        "ru": 'aiscientist: TUI недоступна (%s).',
    },
    "cli_tui_error": {
        "en": 'aiscientist: cannot start TUI (%s).',
        "ru": 'aiscientist: не удалось запустить TUI (%s).',
    },
    "search_empty": {
        "en": 'no results for `%s`',
        "ru": 'по запросу `%s` ничего не найдено',
    },
    "no_logs": {
        "en": '[*] no jobs — no logs',
        "ru": '[*] нет jobs — логов нет',
    },
    "no_job_events": {
        "en": '[*] job %s has no events yet',
        "ru": '[*] у job %s пока нет событий',
    },
    "no_module": {
        "en": 'no module selected.',
        "ru": 'нет выбранного модуля.',
    },
    "template": {
        "en": 'Template:',
        "ru": 'Шаблон:',
    },
    "idea": {
        "en": 'Idea:',
        "ru": 'Идея:',
    },
    "pipeline_template_not_set": {
        "en": 'TEMPLATE not set (`set TEMPLATE <name>`)',
        "ru": 'TEMPLATE не задан (`set TEMPLATE <имя>`)',
    },
    "pipeline_template_not_found": {
        "en": 'template "%s" not found: %s',
        "ru": 'шаблон «%s» не найден: %s',
    },
    "pipeline_run_aborted": {
        "en": 'run aborted',
        "ru": 'прогон прерван',
    },
    "pipeline_run_failed": {
        "en": 'run failed',
        "ru": 'прогон завершился с ошибкой',
    },
    "ideas_not_found": {
        "en": 'ideas.json not found: %s',
        "ru": 'ideas.json не найден: %s',
    },
    "ideas_empty": {
        "en": 'no ideas',
        "ru": 'идей нет',
    },
    "ideas_empty_template": {
        "en": 'TEMPLATE not set (`set TEMPLATE <name>`)',
        "ru": 'TEMPLATE не задан (`set TEMPLATE <имя>`)',
    },
    "env_key_set": {
        "en": '%s: set',
        "ru": '%s: задан',
    },
    "env_key_unset": {
        "en": '%s: not set',
        "ru": '%s: не задан',
    },
    "env_model": {
        "en": 'AISC_DEFAULT_MODEL: %s',
        "ru": 'AISC_DEFAULT_MODEL: %s',
    },
    "env_model_unset": {
        "en": 'AISC_DEFAULT_MODEL: (not set)',
        "ru": 'AISC_DEFAULT_MODEL: (не задан)',
    },
    "env_latex_ok": {
        "en": 'ok',
        "ru": 'ok',
    },
    "env_latex_no": {
        "en": 'NO',
        "ru": 'НЕТ',
    },
    "env_vault_found": {
        "en": 'vault: %s',
        "ru": 'vault: %s',
    },
    "env_vault_missing": {
        "en": 'vault: not found (%s)',
        "ru": 'vault: не найден (%s)',
    },
    "env_workdir": {
        "en": 'workdir: %s',
        "ru": 'workdir: %s',
    },
    "report_no_results": {
        "en": 'no results',
        "ru": 'результатов нет',
    },
    "report_latest": {
        "en": 'latest run: %s',
        "ru": 'последний прогон: %s',
    },
}


def get(key, *args):
    """Get translated string. If args provided, format with % operator."""
    lang = _current
    table = _translations.get(key, {})
    text = table.get(lang) or table.get("en") or key
    if args:
        try:
            return text % args
        except (TypeError, KeyError):
            return text
    return text


def set_language(lang):
    """Set current language. Returns True if successful."""
    global _current
    lang = lang.lower().strip()
    if lang in ("en", "ru"):
        _current = lang
        os.environ["AISC_LANG"] = lang
        return True
    return False


def current_language():
    return _current


def t(key):
    """Shorthand for get(key) without args."""
    return get(key)
