# E2E-замеры на хосте (2026-09-10, Windows 11 26100)

Полный прогон `docs/RUNBOOK-E2E.md` на реальной машине (не CI). Все замеры —
фактические прогоны через headless-раннер (тот же код-путь, что spawns из TUI).
Использован черновой шаблон `templates/e2e_grok` (копия `grokking_toy`), удалён
после замеров; артефакты прогонов — в gitignored `results/e2e_grok/`.

## Фаза 0 — префлайт (без сети)

| Компонент | Значение |
|---|---|
| Python (venv) | 3.12.7 (AMD64) |
| torch | 2.14.0+cu126, **CUDA доступна** (nvidia-smi в PATH) |
| numpy / bun / git / aider | 1.26.4 / 1.3.13 / OK / OK (`~/.local/bin/aider.exe`) |
| LaTeX (pdflatex/chktex/bibtex) | **ОТСУТСТВУЕТ** на хосте |
| Docker | CLI 29.5.3, **демон не запущен** (Docker Desktop выключен) |
| Ollama | сервер **доступен** (localhost:11434) |
| Ключи | OPENROUTER ✓, OPENAI ✗; AISC_DEFAULT_MODEL=ollama/qwen2.5-coder:7b |
| Vault | C:\Users\leks\Documents\root |

## Фаза 1 — живые LLM/поиск

| Замер | Значение |
|---|---|
| OpenRouter free (nemotron-3-super-120b) RTT, 1 сообщение | **2.03 c** |
| Stage `ideas`: +2 идеи (num-ideas 2, reflections 1) | **75 c** (17:59:39→18:00:54), идеи по домену, JSON валиден |
| Stage `novelty` через OpenAlex (5 идей) | поиск **1.5 c**/запрос; решения: cosine_lr_schedule → **novel** (раунд 4), weight_decay_sweep → not novel (3), train_subset_size → not novel (1) |
| Stage `novelty` через SemanticScholar без ключа | 429-троттлинг; backoff отрабатывает (0.3→15 c), дожил до 200 OK; полностью — только с `S2_API_KEY` |

## Фаза 2 — эксперименты (Aider + локальный coder, CPU)

Прогон `--stages experiments --idea cosine_lr_schedule`, coder=ollama qwen2.5-coder:7b:

| Замер | Значение |
|---|---|
| job 13 (без бюджета, прерван таймером инструмента на 349 c) | run_1 + run_2 выполнены, sanity **ok**×2, PNG-плоты построены |
| job 14 (бюджет 3 мин на идею, guard-лимиты) | завершился сам за **225 c**, exit **1** = «experiments_failed (лимит итераций)» — корректная семантика |
| Aider-редактирование | SEARCH/REPLACE **не совпал 2 раза, само-починился** (реал-цикл retry из aider) |
| Научный сигнал | run_1 (cosine+warmup): `steps_to_val_90 = 4799.5` vs baseline `9150` — ускорение грукинга; val_acc 1.0 |
| Бюджетный guard | «Idea wall-clock budget exhausted — stopping experiments» → «Not all experiments completed» (без зависания) |
| Повторяемость | метрики baseline run_0 воспроизвелись **до цифр** при перепрогоне (сравнение с прогоном 11:4x) |

## Фаза 2c — деградация без LaTeX

`--stages writeup,review` → `['pdflatex','chktex'] отсутствует` → стадии сняты,
job completed, exit **0**, **4 c**. Полный цикл статьи на хосте возможен только
через Docker (демон не запущен) или установкой MiKTeX — замерен сам механизм деградации.

## Фаза 3 — артефакты reproducibility (run 13)

`run_meta.json` (run_id, model, seeds, python 3.12.7, Windows-11, code hash,
pip_freeze), `sanity.json` (verdict ok + per-metric z), `notes.txt` (Run 0/1/2),
`run_N.py`-снапшоты, копия промпт-файла `<ts>_aider.txt`, 3 PNG, `latex/`.

## Дефекты, НАЙДЕННЫЕ прогоном и исправленные сразу

1. **`pyalex` отсутствовал в зависимостях** — `--engine openalex` падал
   `ModuleNotFoundError`. Добавлен в requirements.txt + pyproject.toml.
2. **Крах novelty при пустом поиске**: `papers=None` → `enumerate(papers)`
   бросал TypeError в тело try (ветка «No papers found» была мертва). Исправлено
   (`papers or []`), регресс-тест `tests/test_novelty.py`.
3. **`run_meta.pip_freeze` пуст в uv-venv** (там нет pip; shell-out молча
   давал 0 строк — snapshot терял версии пакетов). Переведён на
   `importlib.metadata`: **170 пакетов**. Регресс-тест в `test_research_quality.py`.
4. **Stale free-модель в конфигах**: `openrouter/z-ai/glm-5.2:free` **нет в живом
   каталоге** — `.env.example`, `STATIC_FREE_FALLBACK`, `AVAILABLE_LLMS`, BETA0.1
   обновлены; пустой `AISC_DEFAULT_MODEL` = авторежим по живому каталогу.
5. Наблюдение (не правка): сообщения LaTeX-чека в pipeline.py печатаются по-русски
   независимо от `--lang en` (хардкод legacy-кода); сообщения раннера — i18n-ны.

## Вердикт по готовности (после живого прогона)

Рабочий код-путь подтверждан на железе: ideas ✓, novelty ✓ (openalex; S2 — с
ключом), experiments+guard+sanity+plots+meta ✓, exit-коды ✓, graceful skip
paper-стейджей ✓. НЕ проверено на хосте (нет LaTeX/докера): writeup, review,
**improve-цикл** — обязательный следующий шаг перед RC: запустить Docker Desktop
и `docker compose run --rm scientist` по RUNBOOK §1–2, либо поставить MiKTeX.
Оценка готовности: была ~80% → прогон закрыл «не проверено живьём» для стадий
1–3 и дал 4 реальных фикса; с учётом непройденного бумажного цикла: **~85%**.
