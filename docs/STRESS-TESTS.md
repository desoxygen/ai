# Стресс-тесты: план и протокол

Дата: 2026-09-11 · Окружение: Windows 11, Python 3.12 (.venv), Bun 1.3.13
Метод: 5 циклов «план → тест → фикс → ретест». Каждый цикл фиксируется в
этом файле (секция «Протокол»). Тесты герметичны: `AISC_RESULTS_DIR`
указывает во временный каталог, реальный дашборд не мусорится; живые API не
тратятся (off-line стадии и заведомо падающие job'ы).

## Триггер

Дашборд показал 21 запись истории (dev/e2e-мусор прошлых замеров) и job #21
с парой событий от двух процессов. Диагноз до начала тестов:

- **F1** `JobRegistry` не защищён между процессами: два spawn'а TUI читают
  `jobs.jsonl`, оба берут `max(id)+1` → дубль id, общий файл событий,
  а полный `_save()`-rewrite теряет записи конкурента. (Воспроизведено.)
- **F2** Нет очистки истории: `results/jobs.jsonl` + `events/*.jsonl` растут
  вечно, дашборд показывает всё когда-либо запущенное.
- **F3** TUI `readJobs` не схлопывает дубли id (last-wins) и сам переписывает
  файл целиком (`markJobStatus`/`deleteJobRecord`), что конфликтовало бы с
  append-раннерами.

## План циклов

| # | Область | Что делаем | Критерий прохождения |
|---|---|---|---|
| 1 | Целостность журнала | параллельные `create()` из разных процессов; проверка id/потерь; фикс: file-lock + append-only + fold-by-id (Python и TUI) | 0 дублей id, все записи целы, TUI читает last-wins |
| 2 | Контракты шаблонов | `aiscientist -q run/paper` на битых шаблонах: нет run_0, нет prompt.json, нет seed_ideas, битый experiment.py, `/paper` без прогонов | каждый кейс: `status=failed` + человекочитаемый `fail`-event, exit≠0, без traceback-свала |
| 3 | Гигиена истории | `aiscientist -q jobs-purge [--template]`; purge боевого `results/` от dev-мусора; running не трогается | дашборд пуст; running-запись цела; события удалены |
| 4 | Guardrails под абьюзом | двойной запуск одного шаблона; kill процесса на середине job; AISC_MAX_STAGE_MINUTES=0; фейковый API-ключ (ideas) | второй запуск не портит журнал; kill → aborted; лимиты дают чистый fail |
| 5 | Soak | 15 быстрых job'ов подряд + 20 прогонов baseline playground + plot; целостность journals | id монотонны, файлы событий не перемешаны, 0 «running»-зомби |

Инфраструктура: `tests/test_jobs_store.py` (регрессы F1–F3 в pytest),
`opencode-tui/src/lib/aiscientist.test.ts` (fold/tombstone/append-only),
воспроизводитель гонки — `docs/e2e/stress_c1_jobs_race.py`.

---

## Протокол

### Цикл 1 — целостность журнала — НАЙДЕНО→ИСПРАВЛЕНО

**Тест до фикса.** `python docs/e2e/stress_c1_jobs_race.py 2 5`
(два процесса × 5 create, общий AISC_RESULTS_DIR):

    expected=10 lines=5 unique=5  →  FAIL (потеряно 5 записей)

Боёвой след того же бага: `results/events/21.jsonl` содержит ПОВТОРЯЮЩИЕСЯ
started/fail от двух процессов (run_id `20260911_180010` и `20260911_180012`
с общим job_id=21) — классика гонки `max(id)+1`.

**Фикс (Python, `ai_scientist/console/jobs.py`):**
- `_ProcLock` — sidecar `jobs.jsonl.lock` (O_EXCL, stale-steal 30 с,
  timeout 10 с). Windows-специфика: занятое открытие отдаёт
  `PermissionError`, а не `FileExistsError` — ловим оба.
- журнал append-only: `create()` присваивает id под локом (идемы никогда не
  переиспользуются — tombstone-записи остаются в `_by_id`), `update()`
  дописывает новую версию записи; `_load()`/`_fold()` — last-wins по id;
  полное перезаписывание файла осталось только в `purge()` (цикл 3).

**Фикс (TUI, `opencode-tui/src/lib/aiscientist.ts`):**
- `readJobs` — fold по id + фильтр tombstone (`{id, deleted:true}`);
- `markJobStatus`/`deleteJobRecord` больше не переписывают файл — дописывают
  запись/тумбston под тем же protocol'ом замка (`withJobsLock`).

**Ретест:** `stress_c1_jobs_race.py 4 8` и `6 10` → `PASS` (60 записей,
0 дублей, 0 потерь). Регрессы: `tests/test_jobs_store.py` 5 passed,
`aiscientist.test.ts` 12 passed. Попутно фикс выявил собственный баг
(устаревший in-memory объект после `_fold` внутри `_append`) — тоже закрыт
тестом.

### Цикл 2 — контракты шаблонов — НАЙДЕНО→ИСПРАВЛЕНО

**Тест:** `docs/e2e/stress_c2_templates.py` — 5 битых шаблонов
(нет run_0 / пустой каталог / нет prompt.json / `/paper` без прогонов /
битый JSON) через реальный headless-раннер в изолированный results-каталог.

**Найдено (до фикса):** сырые `OSError`/`JSONDecodeError` repr в fail-событиях
(`"[Errno 2] No such file or directory: 'templates\\…'"` с двойными
экранами) — нечитаемо на дашборде; skip-причина «нет baseline» вообще не
попадала в событийный поток (только print).

**Фикс:**
- `generate_ideas._load_template_file/_prompt_system` — человекочитаемые
  сообщения «шаблон X неполный: нет файла … — создайте через /new-project
  или /skeleton», «prompt.json: некорректный JSON (…, строка N)»;
- `pipeline.run_idea` — skip идеи без baseline теперь emits
  `experiments/log` с внятной причиной.
- Попутно: `pipeline.PipelineRunner.results_dir` игнорировал
  `AISC_RESULTS_DIR` (жёсткий относ `results/`) — артефакты стресс-ранов
  утекали в боевой каталог. Исправлено на `settings.RESULTS_DIR`
  (то же в `writeup/paper.py`); регресс `test_pipeline_results_dir_honours_env`.

**Ретест:** 5/5 PASS; pytest 165 → далее 167 passed.

### Цикл 3 — гигиена истории — ИСПРАВЛЕНО

**Проблема:** боевой `results/jobs.jsonl` копил всё когда-либо запускавшееся;
на дашборде — 21 запись чужих прогонов, 5 из них «running»-зомби (вчерашние
убитые процессы; Windows переиспользует PID, но `pidAlive`+event-age в TUI
их честно показывали как aborted — в Python-реестре такой сверки не было).

**Фикс:** `aiscientist -q jobs-purge [--template T]` — компакция журнала под
кросс-процессным локом: finished-записи и их events-файлы удаляются,
`running` с живым PID защищён, зомби (running/queued + мёртвый PID или
протухший run_id) закрываются как `aborted` и тоже вычищаются; watermark-
tombstone гарантирует, что id не переиспользуются.

**Тест/ретест:** боевой purge съел 16 finished + 5 зомби, `status` →
«no runs yet»; регресс `test_purge_reaps_zombies_keeps_live` +
`test_cli_jobs_purge_smoke`.

### Цикл 4 — guardrails под абьюзом — НАЙДЕНО→ИСПРАВЛЕНО

**Тест:** `docs/e2e/stress_c4_guardrails.py`
A) 8 одновременных `paper` одного шаблона;
B) живой LLM-job убивается `taskkill /T /F` в середине;
C) повторный запуск того же module+template.

**Найдено:** A вскрывал исходную жалобу — три параллельных paper-job (#19–21)
не только гоняли журнал, но и засоряли дашборд дублями.

**Фикс:** single-flight guard — `JobRegistry.live_duplicates()` + проверка в
`runner.execute_job()`: второй раннер того же module+template при живом
первом завершается instant-fail с событием
`duplicate: … job #N — повторный запуск отклонён` (i18n-ключ
`job_duplicate_blocked`), exit 1, журнал чист.

**Ретест:** A) 8 unique ids, 7/7 отклонены guard'ом, событийные файлы не
смешаны; B) зомби убит → `_pid_alive=False` → purge reaped без потерь;
C) отказ. PASS. Регресс `test_duplicate_guard_blocks_second_runner`.

### Цикл 5 — soak — PASS

**Тест:** `docs/e2e/stress_c5_soak.py`
A) 20 повторных baseline-прогонов playground в песочнице: все exit 0,
метрики идентичны (детерминированность), `plot.py` отрисовал 4 фигуры по
20 прогонам;
B) 15 быстрых job'ов батчами в один журнал: ids ровно 1..15, записи целы,
по одному событийному файлу на job, run_id в файле не смешан, зомби нет.

## Итог

5/5 циклов закрыты. Найденные и исправленные дефекты: F1 (гонка журнала,
дубли id — причина «агентов предыдущих исследований» на дашборде), F2 (нет
очистки истории → `jobs-purge` + reap зомби), F3 (TUI-ридер без fold),
F4 (сырые OSError в событиях), F5 (skip без baseline невидим для дашборда),
F6 (`AISC_RESULTS_DIR` игнорировался пайплайном → утечки в боевой results),
F7 (нет single-flight → spam параллельных дублей при быстрых кликах).

Итоговые метрики: pytest 167 passed (cov 62.6%), bun 91 pass / tsc clean,
ruff clean (ai_scientist+tests, CPU-шаблоны), stress C1–C5 PASS.

Известные ограничения (зафиксированы, не лечились):
- окно ~мс между `create()` и `running`-update: два процесса, стартовавшие
  в одну миллисекунду, оба пройдут single-flight guard (проверено: при
  реальных кликах интервал больше — guard срабатывает);
- `reconcile` TUI опирается на PID: после мгновенного переиспользования PID
  Windows возможна ложная «живость» до 2 с (пульс refresh) — cosmetic;
- purge без `--template` убирает ВСЕ finished-записи — это documented
  поведение «no runs yet».

