# ПЛАН: живой LaTeX → статья · роли моделей по задачам · страница Paper в TUI

> **СТАТУС 2026-09-10 (вечер): все три фазы L/R/T выполнены и проверены
> живьём.** Протокол замеров и найденных дефектов: `docs/E2E-PAPER-MEASUREMENTS.md`
> (MiKTeX 26.5 user-mode; реальный PDF 7 стр. из сгенерированного tex; цикл
> review 3/10 → improve → re-review; 5 дефектов Windows/класс-encoding
> исправлены с регресс-тестами; 242 автотеста зелёные).

> На согласование. После апрува выполняется по фазам, каждая — с проверкой.
> Контекст: хост без LaTeX (choco есть, но нужен админ; winget нет) → путь
> без админа: официальный miktexsetup (user-install). E2E-стадии 1–3 уже
> подтверждены живьём (docs/E2E-MEASUREMENTS.md).

## Фаза L — настоящий LaTeX и реальная статья на этой машине

**L1. Установка MiKTeX (user-level, без админа):**
- скачать `miktexsetup_windows_x64.zip` с miktex.org → `download_standalone` (~250 МБ)
  → `install --shared=no` → бинари в `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64`;
- PATH — для процесса/сессий (и per-user через setx);
- включить on-demand установку недостающих пакетов (`initexmf --set-config-value [MPM]AutoInstall=1`).
- Запасной вариант (если попросишь и дашь админа): `choco install miktex`.

**L2. Windows/хост-совместимость в коде (все — реальные блокеры без LaTeX-стека):**
- `check_latex_dependencies()`: **chktex — опционален** (MiKTeX его не даёт).
  pdflatex — обязателен; chktex отсутствует → info-лог, не отключение стадии.
- `perform_writeup.generate_latex`: цикл chktex пропускать, если бинаря нет
  (сейчас `os.popen("chktex …")` на Windows вернёт мусор «не распознано» в промпт кодеру).
- `compile_latex`: timeout 30 c → конфигурируемый `AISC_LATEX_TIMEOUT` (default 120 c),
  т.к. первый MiKTeX auto-install пакетов медленный.
- тесты на все три (без реального LaTeX в CI — через monkeypatch).

**L3. Живое формирование статьи (главная проверка):**
- восстановить scratch-шаблон и через **`PipelineRunner.resume_run`** (папка job 13:
  `results/e2e_grok/20260910_182605_cosine_lr_schedule`, там уже run_1/run_2/notes)
  прогнать `writeup → review` реальным aider (ollama coder) + pdflatex;
- замерить: время секций, компиляция PDF (страницы, битые cite), ревью-скоринг, артефакты;
- затем `--improve`-цикл (низкий порог min-score, 1 раунд) — замер before→after.

## Фаза R — разные модели под задачи (автопоиск по каталогу + ручной override)

**R1. Роли** (новый `ai_scientist/model_router.py` + `.env`):
| Роль | Для чего | Эвристика автовыбора | Override |
|---|---|---|---|
| `plan` | ideas, novelty, формулировка плана секций | крупные/сильные (ultra/super/pro/max/r1/…), контекст ≥ 64k | `AISC_MODEL_PLAN` |
| `code` | aider: правки experiment.py/plot/tex | coder-семейства (qwen*coder, deepseek, glm, kimi…), «flash/turbo» допустимы | `AISC_MODEL_CODE` |
| `review` | рецензия статьи | сильные рассуждающие | `AISC_REVIEW_MODEL` (уже есть) |
| `discuss` | чат-дискуссия | план | `AISC_DISCUSS_MODEL` (уже есть) |
- источник каталога — живой OpenRouter-кэш (`openrouter.list_models`), бесплатные
  приоритетны пока `AISC_ALLOW_PAID` не включён (тогда ценовой потолок);
- явный override всегда побеждает; нерезолвится — тихий fallback на `AISC_DEFAULT_MODEL`.
- «Квен 3.8 flash»-подобная: попадает в `code` по keyword-эвристикам либо
  выставляешь явно `AISC_MODEL_CODE=...`.

**R2. Внедрение без поломки контракта:**
- `PipelineRunner` принимает роли; `stage_ideas/novelty` → plan-клиент,
  `_make_coder` → code-модель, review уже разворачивается;
- `pipeline/run` MANIFEST += `PLAN_MODEL/CODE_MODEL` (пусто = auto), CLI `--plan-model/--code-model`;
- `/doctor` показывает развёрнутые роли (`plan=… code=… review=…`);
- i18n-строки; тесты: резолвер на мок-каталоге, приоритеты override, fallback.

## Фаза T — страница Paper в TUI (процесс создания статьи)

**T1. Backend-события (контракт):**
- `perform_writeup(..., progress=None)` — опциональный колбэк перед каждой секцией
  (наука не меняет поведение по умолчанию);
- `stage_writeup` эмитит `log`-события `detail={"section": "Abstract"…}` —
  Dashboard/Paper видят «какая секция сейчас»;
- новый модуль `writeup/paper` (тип pipeline): resume папки/проекта в
  `stages writeup,review[,improve]` через `resume_run` — голова для кнопки /paper;
  CLI: `aiscientist -q paper --folder … | --template … [--improve]`.

**T2. TUI:**
- **7-й workspace `Paper`** (клавиша `7`): слева — чек-лист секций статьи
  (pending/writing/done по event-stream), по центру — live-лог writeup/review/improve,
  справа — статус: проект, роли моделей (plan/code/review), PDF (`template.pdf`: есть/нет,
  страницы?), последний review-score, раунды improve;
- `/paper [шаблон]` — запустить/возобновить создание статьи для текущего/указанного
  проекта (детачит job на Agents/Dashboard как /run); `Shift+T` в стартовом меню;
- существующий Article (6) остаётся читалкой готовой статьи;
- тесты: чистые хелперы состояний секций/статуса PDF (bun), без сети.

## Что меняется в существующем
- файлы: `pipeline.py`, `perform_writeup.py`, новый `model_router.py`, `settings.py`,
  `console/modules/pipeline/run.py` + новый `writeup/paper.py`, `i18n.py`,
  TUI: новый `PaperWorkspace.tsx` + `App.tsx` (ws 7, /paper) + `aiscientist.ts` (paperArgs);
- docs: BETA0.1 (event-контракт + секция ролей моделей + новый ws), .env.example, README;
- после всех фаз: полный контрольный прогон (pytest+cov, ruff, bun, typecheck) +
  живая статья-PDF как доказательство (приложить к E2E-MEASUREMENTS).

## Оценки
- L: установка ~10–15 мин (качает 250+ МБ), прогоны writeup+review ~10–25 мин
  (ollama-кодер на CPU/GPU + auto-пакеты MiKTeX при первой компиляции);
- R: ~250 строк кода + тесты;
- T: самый большой кусок — новая страница + resume-модуль; ~400–500 строк TS/Python + тесты.

## Решения за тобой (в апруве)
1. Апрув фаз L→R→T (или другая очередь).
2. Ставить MiKTeX user-level (план по умолчанию) — или дашь админ → choco.
3. `AISC_ALLOW_PAID`: оставить только free-каталог для автовыбора (default) или
   разрешить платные под план/ревью.
4. Клавиша новой страницы — `7` (освободить `M`?) — предлагаю просто `7`.
