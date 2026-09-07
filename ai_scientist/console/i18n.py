"""i18n — translations for the aiscientist console.

Default language: English. Set AISC_LANG=ru or use `lang ru` in REPL.
"""
import os

_current = os.environ.get("AISC_LANG", "en").lower()

_translations = {
    # ---- REPL core ----
    "banner": {
        "en": "aiscientist v%s — research console (Beta 1)",
        "ru": "aiscientist v%s — консоль-лаборатория (Beta 1)",
    },
    "help_quickstart": {
        "en": """\
Quick start:
  1. Set API key and model in .env (OPENROUTER_API_KEY, AISC_DEFAULT_MODEL)
  2. aiscientist           — launch TUI (Dashboard, Chat, Explorer, Notes, Agents)
     aiscientist repl      — this console (REPL), if TUI is not needed
  3. On the banner: `r` or `run` — start with defaults (from aiscientist.toml)
  4. While running: `logs` to watch, `stop` to abort
  5. `e` to edit, `!` for shell, `loot` for results

Topics:  help start | modules | run | keys | cli | files
Commands: help banner search use back show set unset run jobs logs stop
          loot edit shell exit lang
Keys: r=run  e=edit idea.md  !=shell  j=jobs  ?=help  1..6=open .md
      Tab=autocomplete  ↑/↓=history  Ctrl+C=cancel input
""",
        "ru": """\
Быстрый старт:
  1. Ключ и модель — в .env (OPENROUTER_API_KEY, AISC_DEFAULT_MODEL)
  2. aiscientist           — основной интерфейс: TUI (Dashboard, Chat, Explorer,
                            Notes, Agents, Article на весь экран)
     aiscientist repl      — эта консоль (REPL), если TUI не нужна
  3. На баннере: `r` или `run` — старт по дефолту (из aiscientist.toml)
  4. Пока идёт: `logs` смотреть, `stop` остановить
  5. `e` правки, `!` шелл, `loot` результаты

Темы:  help start | modules | run | keys | cli | files
Команды: help banner search use back show set unset run jobs logs stop
         loot edit shell exit lang
Клавиши: r=run  e=edit idea.md  !=shell  j=jobs  ?=help  1..6=открыть .md
         Tab=дополнение  ↑/↓=история  Ctrl+C=отмена ввода
""",
    },
    "help_start": {
        "en": """\
Quick start:
  1. API key and model in .env: copy .env.example to .env,
     set OPENROUTER_API_KEY (or other) and AISC_DEFAULT_MODEL.
     Key is never printed; `auxiliary/env` shows set/unset.
  2. Launch:  aiscientist   (or `aiscientist` after pip install -e .)
  3. On banner press `r` or type `run` — run with defaults.
     Defaults in aiscientist.toml (default_module/template/idea).
  4. While running: `logs` — events, `stop` — abort, `jobs` — status.
  5. Edit/shell/results: `e`, `!`, `loot`.
""",
        "ru": """\
Быстрый старт:
  1. Ключ и модель — в .env: скопируйте .env.example в .env,
     заполните OPENROUTER_API_KEY (или другой) и AISC_DEFAULT_MODEL.
     Ключ никогда не печатается; `auxiliary/env` скажет «задан/не задан».
  2. Запуск:  aiscientist   (или `aiscientist` после pip install -e .)
  3. На баннере нажмите `r` или введите `run` — прогон по дефолту.
     Дефолты — в aiscientist.toml (default_module/template/idea).
  4. Пока идёт прогон: `logs` — события, `stop` — остановить, `jobs` — статус.
  5. Правки/шелл/результаты: `e`, `!`, `loot`.
""",
    },
    "help_modules": {
        "en": """\
Modules (catalog):  pipeline/run  auxiliary/env  auxiliary/ideas  report/last
  use <name>      select module; short names resolve automatically:
                  `use env` -> auxiliary/env, `use ideas` -> auxiliary/ideas,
                  `use run` -> pipeline/run. ambiguous -> selection menu.
  use             (no argument) — arrow menu of all modules.
  show modules    list all modules.   show info — module description.
  search <query>  search modules.
""",
        "ru": """\
Модули (каталог):  pipeline/run  auxiliary/env  auxiliary/ideas  report/last
  use <имя>        выбрать модуль; короткие имена резолвятся сами:
                   `use env` -> auxiliary/env, `use ideas` -> auxiliary/ideas,
                   `use run` -> pipeline/run. неоднозначно -> меню выбора.
  use              (без аргумента) — стрелочное меню всех модулей.
  show modules     список всех модулей.   show info — описание модуля.
  search <тег>     поиск по модулям.
""",
    },
    "help_run": {
        "en": """\
Run:
  run | exploit    run current module. If no module selected — uses
                   default_module from aiscientist.toml (usually pipeline/run).
  If TEMPLATE empty — template menu first, then start.
  If IDEA empty and template has ideas.json — idea selection offered.
Options:  set KEY VALUE, unset KEY, show options.
Status:   jobs — status,  logs — events,  stop — abort.
""",
        "ru": """\
Запуск:
  run | exploit    запустить текущий модуль. Если модуль не выбран — берётся
                   default_module из aiscientist.toml (обычно pipeline/run).
  Если TEMPLATE пуст — сначала меню шаблонов, затем старт.
  Если IDEA пуста и у шаблона есть ideas.json — предложим выбрать идею.
Опции:  set KEY VALUE, unset KEY, show options.
Прогон:  jobs — статусы,  logs — события,  stop — остановить.
""",
    },
    "help_keys": {
        "en": """\
Keys:
  r        run current module (like `run`)
  e        $EDITOR on idea.md (or current experiment file)
  !        $SHELL in experiment folder (return — `exit` in shell)
  j        jobs (runs)
  ?        help
  1..6     open corresponding .md (idea/have/hypothesis/papers/Journal/README)
  ↑ / ↓    session command history (persists in ~/.local/share/aiscientist/history)
  Tab      autocomplete commands/modules/options/paths
  Ctrl+C   cancel current input line (not exit); exit — `exit` or Ctrl+D
""",
        "ru": """\
Клавиши:
  r        запустить текущий модуль (как `run`)
  e        $EDITOR на idea.md (или текущем файле опыта)
  !        $SHELL в папке опыта (вернуться — `exit` в шелле)
  j        jobs (прогоны)
  ?        help
  1..6     открыть соответствующий .md (idea/have/hypothesis/papers/Journal/README)
  ↑ / ↓    история команд сессии (персистится в ~/.local/share/aiscientist/history)
  Tab      дополнение команд/модулей/опций/путей
  Ctrl+C   отмена текущей строки ввода (не выход); выход — `exit` или Ctrl+D
""",
    },
    "help_cli": {
        "en": """\
Headless CLI:
  aiscientist -q run --template <t> [--stages ...] [--num-ideas N] [--idea <i>]
  aiscientist status        show run statuses
  aiscientist logs [-j N]   events of last (or N-th) job
  aiscientist search <q>    search modules
Stage failure -> non-zero exit code (1 = fail, 130 = aborted).
""",
        "ru": """\
CLI без интерфейса:
  aiscientist -q run --template <t> [--stages ...] [--num-ideas N] [--idea <i>]
  aiscientist status        статусы прогонов
  aiscientist logs [-j N]   события последнего (или N-го) job
  aiscientist search <тег>  поиск модулей
Падение стадии -> ненулевой код выхода (1 = fail, 130 = aborted).
""",
    },
    "help_files": {
        "en": """\
File layout:
  aiscientist.toml            console defaults (module/template/idea)
  .env                        API key and model (see .env.example)
  idea.md / have.md /         research notes — found in vault,
  hypothesis.md / papers.md   repo root and experiment folder; shown on banner.
  templates/<tpl>/ideas.json  template ideas (menu for `run`)
  results/jobs.jsonl          runs;  results/events/<job>.jsonl — events
  results/<tpl>/<ts>_<name>/  run artifacts (`loot`)
""",
        "ru": """\
Где что лежит:
  aiscientist.toml            дефолты консоли (сменить модуль/шаблон/идею)
  .env                        ключ и модель (см. .env.example)
  idea.md / have.md /         заметки исследования — ищутся в vault,
  hypothesis.md / papers.md   корне репо и папке опыта; выводятся на баннере.
  templates/<tpl>/ideas.json  идеи шаблона (меню для `run`)
  results/jobs.jsonl          прогоны;  results/events/<job>.jsonl — события
  results/<tpl>/<ts>_<name>/  артефакты прогона (`loot`)
""",
    },
    # ---- REPL messages ----
    "unknown_command": {
        "en": "unknown command `%s`. Type `help` for commands.",
        "ru": "неизвестная команда `%s`. help — список команд.",
    },
    "command_error": {
        "en": "command `%s` error: %s",
        "ru": "ошибка команды `%s`: %s",
    },
    "no_topic": {
        "en": "no topic `%s`. Topics: %s",
        "ru": "нет темы `%s`. Темы: %s",
    },
    "search_empty": {
        "en": "no results for `%s`",
        "ru": "по запросу `%s` ничего не найдено",
    },
    "module_not_found": {
        "en": "module `%s` not found. `show modules` or `use` without argument.",
        "ru": "модуль `%s` не найден. `show modules` или `use` без аргумента.",
    },
    "module_selected": {
        "en": "[*] selected module %s: %s",
        "ru": "[*] выбран модуль %s: %s",
    },
    "module_options_hint": {
        "en": "[*] options — `show options`",
        "ru": "[*] опции — `show options`",
    },
    "no_module": {
        "en": "no module selected. `use <module>`",
        "ru": "нет выбранного модуля. `use <module>`",
    },
    "module_reset": {
        "en": "[*] module %s reset",
        "ru": "[*] модуль %s сброшен",
    },
    "no_modules": {
        "en": "no modules available",
        "ru": "модулей нет",
    },
    "modules_empty_hint": {
        "en": "[*] no modules yet",
        "ru": "[*] модулей пока нет (появятся на шагах 5–6)",
    },
    "no_options": {
        "en": "[*] module has no options",
        "ru": "[*] у модуля нет опций",
    },
    "set_usage": {
        "en": "set KEY VALUE",
        "ru": "set KEY VALUE",
    },
    "unknown_option": {
        "en": "unknown option `%s`. `show options`",
        "ru": "неизвестная опция `%s`. `show options`",
    },
    "option_set": {
        "en": "[*] %s = %s",
        "ru": "[*] %s = %s",
    },
    "option_reset": {
        "en": "[*] %s reset",
        "ru": "[*] %s сброшена",
    },
    "unset_usage": {
        "en": "unset KEY",
        "ru": "unset KEY",
    },
    "invalid_choice": {
        "en": "valid choices: %s",
        "ru": "допустимые значения: %s",
    },
    "no_modules_run": {
        "en": "no modules — `show modules`",
        "ru": "нет модулей — `show modules`",
    },
    "missing_required": {
        "en": "required options not set: %s. `set` / `show options`",
        "ru": "не заданы обязательные опции: %s. `set` / `show options`",
    },
    "job_started": {
        "en": "[*] job %s started (%s)",
        "ru": "[*] job %s started (%s)",
    },
    "no_jobs": {
        "en": "[*] no jobs yet",
        "ru": "[*] прогонов пока нет",
    },
    "no_job_events": {
        "en": "[*] job %s has no events yet",
        "ru": "[*] у job %s пока нет событий",
    },
    "no_logs": {
        "en": "[*] no jobs — no logs",
        "ru": "[*] нет jobs — логов нет",
    },
    "job_completed": {
        "en": "[*] job %s already completed (%s)",
        "ru": "[*] job %s уже завершён (%s)",
    },
    "follow_mode": {
        "en": "[*] follow mode: Ctrl+C to exit (job #%s)",
        "ru": "[*] follow-режим: Ctrl+C для выхода (job #%s)",
    },
    "follow_stopped": {
        "en": "\n[*] follow mode stopped",
        "ru": "\n[*] follow-режим остановлен",
    },
    "follow_done": {
        "en": "[*] job %s completed (%s)",
        "ru": "[*] job %s завершён (%s)",
    },
    "no_active_jobs": {
        "en": "[*] no active jobs",
        "ru": "[*] нет активных jobs",
    },
    "stop_requested": {
        "en": "[*] stop requested for job %s",
        "ru": "[*] запрошена остановка job %s",
    },
    "no_results": {
        "en": "[*] no results",
        "ru": "[*] результатов нет",
    },
    "run_show": {
        "en": "[*] run: %s",
        "ru": "[*] прогон: %s",
    },
    "no_file": {
        "en": "no such file",
        "ru": "нет такого файла",
    },
    "file_not_found": {
        "en": "file #%s not found",
        "ru": "файл #%s не найден",
    },
    "editor_not_found": {
        "en": "editor `%s` not found",
        "ru": "редактор `%s` не найден",
    },
    "editor_open_error": {
        "en": "cannot open `%s`: %s",
        "ru": "не удалось открыть `%s`: %s",
    },
    "shell_started": {
        "en": "[*] shell (%s) in %s; type `exit` to return to console",
        "ru": "[*] шелл (%s) в %s; exit — назад в консоль",
    },
    "shell_error": {
        "en": "cannot start shell: %s",
        "ru": "не удалось запустить шелл: %s",
    },
    "no_api_key": {
        "en": "[!] no API key — fill in .env (see `help start`)",
        "ru": "[!] нет API-ключа — заполните .env (см. `help start`)",
    },
    "tab_hint": {
        "en": "[*] Tab — autocomplete, ↑/↓ — history",
        "ru": "[*] Tab — дополнение, ↑/↓ — история",
    },
    "template": {
        "en": "Template:",
        "ru": "Шаблон:",
    },
    "idea": {
        "en": "Idea:",
        "ru": "Идея:",
    },
    "no_filter": {
        "en": "— no filter —",
        "ru": "— без фильтра —",
    },
    "template_label": {
        "en": "[*] template: %s",
        "ru": "[*] шаблон: %s",
    },
    "module_menu_title": {
        "en": "Module:",
        "ru": "Модуль:",
    },
    "cancel": {
        "en": "— cancel —",
        "ru": "— отмена —",
    },
    "choose": {
        "en": "Choice: ",
        "ru": "Выбор: ",
    },
    "job_menu_title": {
        "en": "Job (Enter = logs):",
        "ru": "Job (Enter = logs):",
    },
    "run_menu_title": {
        "en": "Run (Enter = show):",
        "ru": "Прогон (Enter = показать):",
    },
    # ---- CLI messages ----
    "cli_tui_unavailable": {
        "en": "aiscientist: TUI unavailable (%s) — falling back to console.",
        "ru": "aiscientist: TUI недоступна (%s) — переключаюсь на консоль.",
    },
    "cli_tui_error": {
        "en": "aiscientist: cannot start TUI (%s) — falling back to console.",
        "ru": "aiscientist: не удалось запустить TUI (%s) — переключаюсь на консоль.",
    },
    "cli_module_not_found": {
        "en": "aiscientist: module pipeline/run not found",
        "ru": "aiscientist: модуль pipeline/run не найден",
    },
    "cli_unknown_command": {
        "en": "aiscientist: unknown command `%s`. Type `help`.",
        "ru": "aiscientist: неизвестная команда `%s`. Наберите `help`.",
    },
    "cli_interrupted": {
        "en": "\nInterrupted.",
        "ru": "\nПрервано.",
    },
    "cli_template_help": {
        "en": "template from templates/",
        "ru": "шаблон из templates/",
    },
    "cli_model_help": {
        "en": "model (empty = default)",
        "ru": "модель (пусто = default)",
    },
    "cli_idea_help": {
        "en": "run only this idea (by Name)",
        "ru": "запустить только эту идею (по Name)",
    },
    "cli_job_help": {
        "en": "job id",
        "ru": "id job'а",
    },
    "cli_status_empty": {
        "en": "[*] no runs yet",
        "ru": "[*] прогонов пока нет",
    },
    # ---- module env ----
    "env_workdir": {
        "en": "workdir: %s",
        "ru": "workdir: %s",
    },
    "env_key_set": {
        "en": "%s: set",
        "ru": "%s: задан",
    },
    "env_key_unset": {
        "en": "%s: not set",
        "ru": "%s: не задан",
    },
    "env_model": {
        "en": "AISC_DEFAULT_MODEL: %s",
        "ru": "AISC_DEFAULT_MODEL: %s",
    },
    "env_model_unset": {
        "en": "AISC_DEFAULT_MODEL: (not set)",
        "ru": "AISC_DEFAULT_MODEL: (не задан)",
    },
    "env_latex_ok": {
        "en": "ok",
        "ru": "ok",
    },
    "env_latex_no": {
        "en": "NO",
        "ru": "НЕТ",
    },
    "env_vault_found": {
        "en": "vault: %s",
        "ru": "vault: %s",
    },
    "env_vault_missing": {
        "en": "vault: not found (%s)",
        "ru": "vault: не найден (%s)",
    },
    # ---- module ideas ----
    "ideas_empty_template": {
        "en": "TEMPLATE not set (`set TEMPLATE <name>`)",
        "ru": "TEMPLATE не задан (`set TEMPLATE <имя>`)",
    },
    "ideas_not_found": {
        "en": "ideas.json not found: %s",
        "ru": "ideas.json не найден: %s",
    },
    "ideas_empty": {
        "en": "no ideas",
        "ru": "идей нет",
    },
    # ---- module report/last ----
    "report_no_results": {
        "en": "no results",
        "ru": "результатов нет",
    },
    "report_latest": {
        "en": "latest run: %s",
        "ru": "последний прогон: %s",
    },
    # ---- module pipeline/run ----
    "pipeline_template_not_set": {
        "en": "TEMPLATE not set (`set TEMPLATE <name>`)",
        "ru": "TEMPLATE не задан (`set TEMPLATE <имя>`)",
    },
    "pipeline_template_not_found": {
        "en": "template \"%s\" not found: %s",
        "ru": "шаблон «%s» не найден: %s",
    },
    "pipeline_run_aborted": {
        "en": "run aborted",
        "ru": "прогон прерван",
    },
    "pipeline_run_failed": {
        "en": "run failed",
        "ru": "прогон завершился с ошибкой",
    },
    # ---- lang command ----
    "lang_set": {
        "en": "[*] language set to: %s",
        "ru": "[*] язык установлен: %s",
    },
    "lang_current": {
        "en": "[*] current language: %s",
        "ru": "[*] текущий язык: %s",
    },
    "lang_usage": {
        "en": "lang [en|ru] — set or show language",
        "ru": "lang [en|ru] — установить или показать язык",
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
