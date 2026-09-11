# playground

Пустой тестовый проект для локальной обкатки пайплайна (создан вручную,
без затрат API).

- **Эксперимент**: логистическая регрессия на numpy по синтетическим
  «двум полумесяцам», сетка learning rates {0.1, 0.3}, 3 trials × 3 seeds.
- **Метрики**: `test_acc`, `test_loss`, `best_lr`, `total_train_time`
  в `<out_dir>/final_info.json` (формат `{"means", "stderrs"}`).
- **Бейслайн**: `run_0/` уже прогнан (test_acc ≈ 0.871, ~0.04 с, CPU-only,
  без интернета).

## Как гонять

```
/run playground              # весь цикл: ideas → novelty → experiments → writeup → review
/improve 6:2                 # цикл починки статьи по рецензии
python experiment.py --out_dir run_test && python check_run.py run_test
```

Идея-затравка (`seed_ideas.json`): добавить квадратичный признак, чтобы
линейная модель «разогнула» геометрию данных — ожидаемое улучшение test_acc.
