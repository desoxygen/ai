# E2E-замеры: живой LaTeX, роли моделей, страница Paper (2026-09-10, вечер)

Продолжение `docs/E2E-MEASUREMENTS.md`. План: `docs/PLAN-PAPER-ROLES-TUI.md`.

## Фаза L — LaTeX на хосте

| Замер | Значение |
|---|---|
| Установка | MiKTeX 26.5 (miktexsetup 5.5.0, package-set=basic, user-mode) |
| Скачивание пакетов | 249.6 МБ за ~14 мин (ctan.gust.org.pl; дефолтный зеркало macomnet **не резолвится** с этой машины — обход через `--remote-package-repository`) |
| Установка | exit 0, ~2 мин; бинари в `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64`, USER PATH обновлён |
| Первый compile_latex | 123 с (on-demand докачка пакетов) |
| Повторный compile_latex | **6.6 с** на 4 прохода pdflatex+bibtex |

## Фаза L — формирование реальной статьи (grokking_toy resume)

Цикл прогонялся на run-папке `results/e2e_grok/…cosine_lr_schedule` (run_1/run_2
реальные эксперименты из дневного прогона). Модель плана/ревью:
`openrouter/nvidia/nemotron-3-super-120b-a12b:free` (131k ctx), кодер: Aider.

| Шаг | Время | Результат |
|---|---|---|
| writeup-секции (Title&Abstract → … → Results/draft) | ~2.5 мин/секция через локальный ollama-кодер | template.tex **22 840 Б, 7 секций**, живые `detail.section/phase` события (draft→refine) |
| компиляция сгенерированного tex | 123 с | **PDF 7 страниц, 97 664 Б** — реальный preprint с настоящим abstract/секциями |
| review#1 (perform_review, reflections=5, few-shot) | **138.1 с** | **3.0/10**; weaknesses: дублирование параграфов, «RESULTS HERE»-плейсхолдер, не определён модуль P |
| improve-раунд (perform_improvement + Aider) | **212.6 с** | «Applied edit to template.tex» |
| перекомпиляция | 6.6 с | PDF **4 стр., 113 549 Б** |
| review#2 | **51.9 с** | **2.0/10** — честный замер: free-модель *ухудшила* статью (сжала 7→4 стр., секции Results не дописаны) |

Итог цикла writeup→review→improve→re-review **пройден живьём от начала до конца**;
вердикт «улучшение не всегда улучшает» — именно то, зачем нужен числовой порог
`/improve min:rounds` и человек в контуре.

## Дефекты, найденные фазой L, и фиксы

1. **Класс Unicode-багов Windows** (тот же корень, что у `load_dotenv`): файловые
   `open()` без `encoding` на cp1252-хосте. Упало реальное ревью
   (`UnicodeDecodeError 0x9d` в few-shot). Починено **в 19 местах**: few-shot
   `.txt/.json` (perform_review) + все чтения `.py/.json/.tex` в
   generate_ideas/perform_experiments/perform_writeup/pipeline/discussion.
   Регресс-тест `test_review_fewshot_read_is_utf8`.
2. **chktex не обязателен**: MiKTeX его не поставляет — раньше его отсутствие
   отключало writeup/review целиком. Теперь обязателен только pdflatex
   (2 теста).
3. **Таймаут компиляции**: 30 с → `AISC_LATEX_TIMEOUT` (default 120) — первый
   MiKTeX on-demand compile требует ~2 мин.
4. **Контекст-лимит кодера**: локальный `qwen2.5-coder:7b` (4k ctx) не влезает в
   22-КБ template.tex — aider уходит в «chat context exceeded». Документировано;
   для paper-стадий нужен ≥32k-контекст — как раз то, для чего введён `code`-роль
   с автовыбором из каталога.
5. Сайд-проект: PowerShell round-trip удвоил кодировку в App.tsx (Get-Content
   ANSI + WriteAllText UTF-8) — файл пересобран из git + edit-tool; все 89 TUI
   тестов снова зелёные. Урок: не править UTF-8-исходники через PS 5.1 конвейер.

## Фаза R — роли моделей (реализовано)

`ai_scientist/model_router.py`: роли **plan / code / review / discuss**,
приоритет `--plan-model|--code-model|--review-model` > `AISC_MODEL_*` >
автовыбор из живого OpenRouter-каталога (только free, пока `AISC_ALLOW_PAID`
не включён; эвристики: code→coder-семейства, plan/review→сильные+контекст) >
базовая модель. Ленивая резолвинг-схема (конструктор пайплайна не трогает сеть),
гард «нет OPENROUTER-ключа → автопик выключен». Wired в `PipelineRunner`,
`pipeline/run` (+3 опции), CLI (`--plan-model/--code-model/--review-model`),
`/doctor` (роль-таблица). **24 теста** (13 router/module + 11 integration без сети).

## Фаза T — страница Paper (реализовано)

* Бэкенд: `perform_writeup(progress=...)` → события `writeup/log detail={section,phase}`;
  модуль `writeup/paper` (resume папки → writeup,review[,improve]), CLI
  `aiscientist -q paper` (4 теста модуля).
* TUI: 7-й workspace **Paper** (`7`, TabStrip, tab-cycle, `/paper [tpl] [--improve]`,
  клавиша `p` — перезапуск, `a` — читалка). Компонент: чек-лист секций из событий,
  writeup→review→improve статусы, score before→after, PDF-статус, роли моделей.
  Чистое ядро `lib/paper.ts` + **4 TS-теста**; итог **89/89**, `tsc` чист.

## Итоговые счётчики (после всех правок)

pytest **153** passed · coverage **61.34%** (гейт 55) · ruff **0** ·
standalone smoke **10/0** · TUI **89/89** · `tsc --noEmit` **0** · публично
**242** автотеста.

## Что осталось для 100%

- Полный непрерывный paper-прогон одним `aiscientist -q paper --improve` на
  мощной модели (не free) и без обрывов — единственный шлагбаум 1.0, который
  нельзя было честно снять этой ночью без платных ключей; чек-лист в RUNBOOK.
- Релиз-циклом: прогнать RUNBOOK §1–3 ещё раз на собранной из git копии.
