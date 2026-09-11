# ROADMAP → 1.0 (готовность 100%)

> **Статус 2026-09-10:** вехи **A, B, C1–C3, D, E1–E4 выполнены** (см.
> `docs/RELEASE-v0.2-beta3.md`). Осталось: секрет `OPENROUTER_API_KEY` в
> GitHub Settings → Secrets (для C2, `gh` на машине не найден — добавить
> вручную), ручные прогоны по `docs/RUNBOOK-E2E.md`, тег релиза и веха F.

> Основа: `docs/ANALYSIS.md` (проход 2, готовность ~80%).
> Оставшиеся 20% разложены на 6 вех. Каждая — с критерием приёмки.
> Требуют решения пользователя: ключи для canary-workflow, ручной E2E-прогон, дата тега.

## Критерий «100%» (definition of done для релиза 1.0.0)

1. CI зелёный: Python 3.11 **и** 3.12 × Ubuntu **и** Windows + TUI + lint + coverage-gate.
2. Ни одной deprecated-зависимости и ни одного собственного FutureWarning.
3. Живые E2E-прогоны: автоматический canary (ideas→novelty, опционально с ключом)
   + задокументированный полный manual-run по RUNBOOK, результат приложен к RC-выпуску.
4. Один, недвусмысленный способ включить improve-цикл (legacy env-пары удалены/депрекейтед).
5. Все известные дефекты, найденные при аудите, исправлены и покрыты тестами.
6. Версия `1.0.0`, RELEASE-ноты, MIGRATION.md, issue-шаблоны, README без расхождений с реальностью.
7. Остаточные внешние зависимости (LaTeX, GPU, API-ключи, Ollama) — каждая: либо есть Docker-путь,
   либо диагностируется `/doctor` до списания кредитов, либо описана в README.

---

## Веха A — инженерная гигиена (реализуется без ключей, ~1 пул)

- **A1. `run_plotting` использует `"python"` из PATH** (perform_experiments.py:154) — в отличие от
  `run_experiment`, который намеренно запускает `sys.executable`. На Windows без venv в PATH — тихий
  провал плотов. → починить на `sys.executable`, регресс-тест.
- **A2. `perform_review` ensemble: `parsed_reviews[0]` при пустом списке → IndexError**
  (perform_review.py:174, если все члены ансамбля не вернули валидного JSON). → явная ошибка
  с понятным сообщением + fallback на `num_reviews_ensemble=1` + тест.
- **A3. Линт**: `ruff` в `requirements-dev.txt`, конфиг в `pyproject.toml` (умеренный набор правил),
  job `ruff check` в CI, почистить найденное.
- **A4. Coverage**: `pytest-cov`, гейт `--cov=ai_scientist --cov-fail-under=65` (по факту замерить
  и поставить честный порог), badge в README.
- **A5. CI-матрица Python**: `["3.11", "3.12"]` (pyproject обещает >=3.11, CI проверяет только 3.12).
- **A6. README vs реальность**: README обещает Docker «network-restricted», но `docker-compose.yml`
  без ограничений сети. Вариант A (честный): убрать слово из README. Вариант B (полезный):
  задокументировать опциональный lockdown (`network_mode` + allowlist apt/pypi/api) в docs.
  → предлагается B-lite: секция SECURITY.md + правка формулировки.

## Веха B — деprecation legacy improve-API (~1 коммит)

- **B1.** `AISC_REVIEW_MIN_SCORE` / `AISC_REVIEW_FIX_ITER`: при чтении — одноразовое
  `warnings.warn(DeprecationWarning)` с указанием на `/improve` (IMPROVE/MIN_SCORE/ROUNDS),
  строки в §9 BETA0.1.md помечены `deprecated`, запись в RELEASE.
- **B2.** Удаление переменных — только в 1.0.0 (или сейчас, раз проект beta). Решение за
  пользователем: мягкий путь (warn→удалить в 1.0) или смелый (удалить сразу).

## Веха C — живые прогоны (частично требует участия пользователя)

- **C1. Offline-canary job в CI** (без ключей): прогон `templates/*/experiment.py --out_dir=run_ci`
  + `plot.py` для grokking_toy и parity_transformer на обеих ОС — ловит дрейф torch/numpy
  «на живых» шаблонах. Временной бюджет ~4 мин/матрица.
- **C2. Live-LLM canary workflow** (`workflow_dispatch` + опц. nightly): ubuntu, установка,
  stages `ideas,novelty` на `grokking_toy` через OpenRouter free-модель; если secret
  `OPENROUTER_API_KEY` не задан — job скипается (форки не ломаются). **От тебя: добавить secret
  в репозиторий GitHub** (или сказать, что не надо — тогда только dispatch вручную).
- **C3. RUNBOOK для полного E2E** (`docs/RUNBOOK-E2E.md`): чек-лист ручного прогона на своей
  машине/Docker: ключ, `/doctor`, полный цикл `grokking_toy` + improve, `/report`, критерии
  успеха/признаки деградации, что приложить к баг-репорту. Прогон и прикладывание лога к
  RC-выпуску — твоя часть (или моя, если дашь запуск на этой машине с ключом).
- **C4. Опционально, после beta-фидбека:** canary «experiments» через Ollama (тяжёлый, ~20+ мин,
  модель qwen2.5-coder) — в план 1.0 не включаем, заносим в backlog.

## Веха D — TUI: долить хвостыdoctor и мелочи (~1 пул)

- **D1.** Чистая функция статуса модели (`modelStatus(...)` из App.tsx) — вынести в `llm.ts`
  или отдельный модуль + bun-тесты на строки WARNING/OK/ollama (сейчас тест есть только на
  маппинг `providerKeyFor`).
- **D2.** Прогнать `bun test`/`tsc` после изменений — само собой.

## Веха E — релизная упаковка

- **E1.** `docs/RELEASE-v0.2-beta3.md`: 3 шаблона (2 CPU), perform_*-интеграция, удаление
  google-generativeai, model-key cross-check в /doctor, фикс guard-ключа, фиксы A1/A2.
  Версию в `pyproject.toml`/`console/__init__.py` → `0.2b3`, бейдж README.
- **E2.** `docs/MIGRATION.md`: beta1→beta2 (REPL удалён), beta2→beta3 (env-разъёзды, legacy
  improve-warn), beta3→1.0 (удаление legacy-переменных).
- **E3.** `.github/ISSUE_TEMPLATE/`: bug-report (просит вывод `/doctor` + `/report <id>`),
  feature, template для отчёта бета-тестера.
- **E4.** Ревизия README: «network-restricted» (A6), счётчики тестов, CPU-быстрый старт.
- **E5.** PyPI-публинг — **не** включаем в 1.0 (лицензия-наследник Sakana, имя занято
  апстримом); установка остаётся `git+https`. Отметить в docs явно.
- **E6.** Тег `v0.2-beta3` и GitHub Release — после прогонов C; дата за тобой.

## Веха F — «последняя миля» 1.0.0

- **F1.** Сбор beta-фидбека по issue-шаблонам; триаж.
- **F2.** Удалить legacy env-переменные (B2), bump `1.0.0`, финальный RELEASE + MIGRATION.
- **F3.** Полный E2E-прогон по RUNBOOK приложить к телу релиза.

---

## Порядок выполнения

A (полностью, без ключей) → B (мягкий деprecation) → C1+C2 (workflow, секреты — от тебя) →
D → E1–E4 → [стоп: ручные прогоны + сбор фидбека] → F.

Оценка: A–E — кодовая работа без внешних требований, кроме секрета GitHub для C2;
F — календарная (зависит от бета-тестеров), не блокер кода.

## Что нужно от пользователя (кроме апрува плана)

1. Секрет `OPENROUTER_API_KEY` в GitHub → для C2 (или отказ — тогда canary только dispatch вручную).
2. Решение B2: warn-then-delete или immediate delete.
3. Готовность выполнить C3-прогон (полный цикл с реальным ключом) до F — или доверить мне
   запуск на этой машине.
4. Окно/дата тега v0.2-beta3 (E6).
