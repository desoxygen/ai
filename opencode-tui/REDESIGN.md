# REDESIGN — привести TUI к дизайн-языку официального OpenCode

> СТАТУС: выполнено — все этапы 1–7 реализованы, 66/66 тестов зелёные (3 прогона подряд), typecheck чист.

Источник: `packages/opencode/src/cli/cmd/tui/context/theme/opencode.json` (дефолтная тема),
docs `opencode.ai/docs/themes` + `opencode.ai/docs/tui`, компоненты `routes/session` (sidebar 42,
wide > 120, `backgroundElement` для user-сообщений, selected item = primary-фон + текст фона,
dialogs = backgroundMenu #1e1e1e, leader ctrl+x, palette ctrl+p, block cursor).

## Официальная палитра (dark) — канон
| токен | hex | назначение |
|---|---|---|
| background | `#0a0a0a` | фон терминала |
| backgroundPanel | `#141414` | панели (sidebar/tabstrip) |
| backgroundElement | `#1e1e1e` | input-боксы, user-бабблы, меню |
| borderSubtle / border / borderActive | `#3c3c3c` / `#484848` / `#606060` | рамки |
| text / textMuted | `#eeeeee` / `#808080` | текст |
| primary | `#fab283` | бренд: спиннер, selected-фон, акценты |
| secondary | `#5c9cf5` | синий |
| accent | `#9d7cd8` | фиолетовый (tool/заголовки) |
| info / success / warning / error | `#56b6c2` / `#7fd88f` / `#f5a742` / `#e06c75` | статусы |

Отличие от текущего: бренд — **тёплый персидско-оранжевый**, а не лавандовый; серые — по
равномерной шкале step1..12, бордеры заметно светлее нынешних #202020.

## Этапы
1. **themes.ts**: переопределить палитру `opencode` на канон; добавить токены `element`,
   `borderSubtle`, `borderActive`, `selectedText`, `menu`; themeOf — fill-дефолты для остальных
   7 тем (из panel/border/accent), чтобы они не сломались.
2. **PromptInput + HomeScreen input**: rounded-бокс (border, фон element), слева-внутри агент-чип,
   справа модель/ctx; под строкой — один muted-футер (подсказки слева, $cost/ctx справа), как
   statusline у opencode.
3. **ChatLog**: user-сообщение = плашка `backgroundElement` с marginX (без цветной шайбы; shell —
   оставить $); tool-линии: иконка dim, label accent; thinking: `∴ Thinking…` primary-спиннер;
   metadata-строка ассистента — textMuted.
4. **FuzzyList/Dialog**: фон `menu (#1e1e1e)`, rounded, тень не нужна; selected строка:
   **primary-фон + текст цвета фона**, категория — textMuted; счётчик "n/m" справа.
5. **Sidebar**: секционные заголовки с `borderSubtle` разделителями; sparkline primary;
   «working on» — element-плашки; подвал version+cwd в textMuted.
6. **TabStrip/footer/chat hint**: активная вкладка — primary bold + element-подложка;
   нижняя строка 2→1, цвет borderSubtle; toast — иконка (✓/✕/⚠/ℹ) + element-фон + colored left bar.
7. **Мелочи**: блок-курсор (уже), `⌗` перед проектом, leader-панель WhichKey в element-стиле,
   spinner — braille primary (SPINNERS уже braille; цвет — C.primary).

## Не трогаем
Раскладку/клавиши/пайплайн, JSON-формат state, тексты. Тесты (64) должны остаться зелёными.
