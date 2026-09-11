# Анализ готовности проекта AI-Scientist (v0.1-beta2)

> Дата анализа: 2026-09-10. Сгенерировано вручную по итогам полного обхода репозитория,
> проверки тестов и чтения документации.
>
> **Проход 1:** готовность ~60–70% (см. §1–5 ниже).
> **Проход 2 (2026-09-10, после работ по этому отчёту):** готовность **~80%** —
> см. §6 «Выполненные работы» и §7 «Обновлённая оценка».

## 1. Что это

Форк [SakanaAI/AI-Scientist](https://github.com/SakanaAI/AI-Scientist) — автоматизированный
исследовательский пайплайн:

```
ideas → novelty → experiments → writeup → review ─┐
  ▲                                               │ score < min
  └──────────── learnings ←── improve (revise) ◄──┘
```

- Эксперименты пишет LLM-кодинг-агент (Aider).
- Статья генерируется в LaTeX, ревью — LLM-ансамбль.
- Единственный интерфейс — TUI на Bun + React (`opencode-tui/`).
- Headless-раннер (`aiscientist -q ...`) — backend для TUI и CI, не пользовательский UI.

## 2. Структура (172 отслеживаемых файла)

```
ai_scientist/            # Python-ядро
  pipeline.py            # PipelineRunner (599 строк): guard'ы + improve-цикл
  generate_ideas.py      # генерация идей + проверка новизны
  perform_experiments.py # эксперименты (Aider)
  perform_writeup.py     # статья (Aider + LaTeX)
  perform_review.py      # LLM-ревью + perform_improvement
  llm.py                 # мультипровайдерный клиент
  openrouter.py          # каталог моделей OpenRouter
  settings.py            # .env, GuardLimits, Obsidian-vault
  loop_guard.py          # StageGuard, RunAborted, LLM-gate
  research_quality.py    # sanity-check, learnings, run_meta
  obsidian_notes.py      # интеграция с Obsidian
  console/               # CLI, runner, registry, jobs, events, i18n, modules/
opencode-tui/            # TUI (Bun + React 19, @opentui) — 17 компонентов + 32 lib-файла
templates/nanoGPT_lite/  # единственный готовый шаблон (baseline run_0 закоммичен)
docs/                    # BETA0.1.md (источник истины), DEBUG.md, release-notes
tests/                   # 11 файлов Python-тестов
.github/workflows/ci.yml # CI: Linux + Windows, Python + TUI
Dockerfile / docker-compose.yml
```

## 3. Фактическая проверка (выполнена, а не по документации)

| Проверка | Результат |
|---|---|
| Python-тесты (`pytest tests/ -q`) | 107 passed, 2 warnings (14.3s) |
| TUI-тесты (`bun test`) | 83 pass, 0 fail, 277 expect |
| TypeScript (`bun run typecheck`) | exit 0 |
| `.env` в git | корректно в `.gitignore` (секрет не закоммичен) |
| venv | Python 3.12.7, pytest 9.1.1 |

## 4. Готовность — оценка

**Вердикт: готов к бета-использованию; НЕ готов к production.**

### Сильные стороны (на уровне)

1. Полный пайплайн реализован и покрыт тестами (107 + 83), CI на двух ОС.
2. Документация зрелая — `BETA0.1.md` как единый источник истины, event-контракт, guard-система.
3. Чистая архитектура: один интерфейс (TUI), backend-раннер изолирован, модули auto-discovered.
4. Reproducibility: `run_meta.json`, seed, Welch-z sanity-check, code hash.
5. Guard-rails против зацикливаний, таймауты, Obsidian-журнал.
6. Мультимодельность (OpenRouter/OpenAI/Anthropic/DeepSeek/Gemini/Ollama), Docker, i18n (en/ru).

### Слабые места / блокеры

1. Только 1 шаблон (`nanoGPT_lite`); `2d_diffusion`/`grokking` требуют ручной настройки.
2. LaTeX (`pdflatex` + `chktex`) обязателен для writeup/review — без него стадии молча пропускаются.
3. Нет интеграционных тестов для `perform_experiments/writeup/review` — science-ядро тестируется
   только на уровне пайплайна (признано в §16 Known Issues).
4. `google.generativeai` deprecated — FutureWarning, со временем сломается.
5. Выполняет LLM-генерируемый код — требует Docker/песочницу (явное предупреждение в README).
6. Статус бета — нет стабильного 1.0 (версия `0.1b2`).

### Риски / несоответствия (обнаружены при проверке)

7. В локальном `.env`: `AISC_DEFAULT_MODEL=ollama/qwen2.5-coder...`, но задан только
   `OPENROUTER_API_KEY` — дефолтная модель (Ollama) и реально доступный провайдер
   (OpenRouter) не совпадают; Ollama-сервер не гарантирован запущенным.
8. Зависимость от внешних сервисов (OpenRouter/OpenAI, Semantic Scholar, Aider, LaTeX) —
   при их недоступности пайплайн деградирует.
9. `bun`-рантайм нужен для единственного интерфейса — без него `aiscientist` печатает
   подсказку и выходит (код 1).

## 5. Итоговая оценка

- **Техническая зрелость:** высокая (тесты, CI, доки, архитектура).
- **Функциональная полнота:** средняя (ядро есть, но 1 домен + внешние зависимости).
- **Готовность к полноценному использованию:** ~60–70%.

Уверенно работает как бета-инструмент для одного домена; до production не хватает:
больше шаблонов, интеграционные тесты science-модулей, устранение deprecation Google API,
упрощение окружения (LaTeX/Bun).

---

## 6. Проход 2 — работы, выполненные по итогам прохода 1 (2026-09-10)

| # | Проблема из прохода 1 | Что сделано | Статус |
|---|---|---|---|
| 1 | Только 1 шаблон (`nanoGPT_lite`, к тому же CUDA-only) | Добавлены `templates/grokking_toy` (грукинг модульного сложения, baseline грукается на ~9150±1750 шагах) и `templates/parity_transformer` (чётность 8-битных последовательностей, baseline val_acc 0.992). Оба: CPU, детерминированные, без сети, ~1 мин на прогон, полный контракт шаблона (`experiment.py`+`plot.py`+`prompt.json`+seed-ideas+`ideas.json`+`learnings.md`+LaTeX+закоммиченный `run_0/`). | ✅ закрыто |
| 2 | Нет интеграционных тестов для `perform_*` | `tests/test_perform_integration.py` (9 тестов): эксперименты реальным подпроцессом (run→sanity-гейт→snapshot→plot→notes), фидбэк `SANITY WARNING` при подозрительном результате, эскалация повторяющихся крашей guard'ом, ревью одиночное и ансамблевое (усреднение оценок), `perform_improvement`, `load_paper` на реальном PDF, полный flow `perform_writeup` и `generate_latex` (битые `\cite`, отсутствующие рисунки, дубли секций). | ✅ закрыто |
| 3 | `google.generativeai` deprecated | Зависимость удалена из `pyproject.toml`/`requirements.txt` — код её никогда не импортировал (Gemini работает через OpenAI-совместимый endpoint в `llm.py:create_client`). | ✅ закрыто |
| 4 | Несоответствие дефолтной модели и ключа в `.env` (риск №7) | `/doctor` теперь кросс-проверяет: `provider_key_for()` (Python, `auxiliary/env.py`) и `providerKeyFor()` (TUI, `llm.ts`) определяют ключ, который нужен дефолтной модели, и предупреждают, если он не задан; для `ollama/*` оба проверяют доступность сервера (`Ollama server: NOT REACHABLE`). `tests/test_env_doctor.py` (15) + TS-тест. В `.env.example` добавлены `AISC_PYTHON` и `OLLAMA_HOST`. Локальный `.env (ollama + openrouter key)` теперь сам себе подсвечивает проблему. | ✅ закрыто |
| 5 | — (найдено по ходу) | **Реальный баг в `perform_experiments`:** ключ детектора повторов содержал номер рана (`run{run}-error`), из-за чего сигнатура идентичной ошибки сбрасывалась на каждом ране и guard никогда не эскалировал зацикливание. Исправлен (`run-error`), регресс-тест в интеграционном наборе. | ✅ исправлено |

### Результаты перепроверки (тот же «тест готовности»)

| Проверка | Проход 1 | Проход 2 |
|---|---|---|
| Python (`pytest tests/ -q`) | 107 passed | **131 passed** (+24) |
| Standalone smoke (`tests/test_smoke.py`) | 10/0 | 10/0 |
| TUI (`bun test`) | 83 pass, 0 fail | **84 pass, 0 fail** |
| TypeScript (`tsc --noEmit`) | exit 0 | exit 0 |
| CLI (`aiscientist --version`, `search`) | — | OK |
| Шаблоны: baseline читается парсером пайплайна | 1 (GPU-only) | **3** (2 из них CPU, проверено прогоном) |
| `.env` с секретом в git | нет | нет |
| Итого публичных тестов (бейдж README) | 196 (устаревший) | **215** (131 pytest + 84 bun) |

## 7. Обновлённая оценка готовности к релизу: ~80%

Закрыты все четыре блокера прохода 1 из категории «можно исправить в репозитории».
Что остаётся до «полноценного использования» — по большей части класс beta:

1. **E2E-прогон с реальным API не автоматизирован** — CI покрывает mock-тесты; полный
   цикл ideas→…→improve с живым LLM+LaTeX нужно вычитать вручную на тестер-машине
   (для этого и бета). Кандидат: ночной canary-workflow на бесплатной модели.
2. **LaTeX обязателен** для writeup/review (деградация вежливая, но полная статья
   требует texlive; Docker-путь это решает).
3. **Выполнение LLM-кода** — по-прежнему требует песочницы (дизайн-решение,
   задокументировано).
4. **nanoGPT_lite требует GPU** — теперь хотя бы очевидно (2 CPU-домена рядом,
   `/doctor` показывает статус baseline).
5. **Версия `0.1b2`** — до релиза 1.0 остаётся: собрать фидбек беты, E2E-canary,
   решить судьбу legacy-переменных (`AISC_REVIEW_MIN_SCORE`/`AISC_REVIEW_FIX_ITER`).

### Вердикт
Проект стал заметно ближе к релизу: заявленная в README многодоменность теперь
соответствует факту, science-ядро впервые покрыто интеграционными тестами,
мёртвая deprecated-зависимость устранена, а типичная ошибка конфигурации
(модель без ключа) диагностируется `/doctor` до списания кредитов.
Для бета-эксплуатации готов; для «production» остаётся обкатка живыми прогонами.
