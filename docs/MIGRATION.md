# Migration guide

## beta 1 → beta 2

- **The REPL is gone.** `aiscientist` now always opens the TUI
  (`opencode-tui/`). There is no second interactive console. The headless
  runner (`aiscientist -q run|skeleton|status|logs|search`) is debug/CI
  plumbing only — see `docs/DEBUG.md`.
- **Bun is required** (the TUI is the only interface). Without Bun and
  `bun install` in `opencode-tui/`, `aiscientist` prints an install hint and
  exits — there is no silent fallback.
- `config.py` / `aiscientist.toml` (REPL defaults) were removed. Use `.env`.
- Docker now ships Bun and builds the TUI: `docker compose run --rm scientist`
  opens the dashboard.
- Fresh installs fixed: `pip install -e .` no longer backtracks into
  unbuildable pre-cp312 sdists (numpy/tiktoken/aiohttp floors).

## beta 2 → beta 3 (this release)

- No breaking changes. New optional CPU templates (`grokking_toy`,
  `parity_transformer`) appear in `/project`; nothing to migrate.
- `/doctor` gained model-key and Ollama-server checks; if your
  `AISC_DEFAULT_MODEL` has no matching key you now see a WARNING instead of a
  silent runtime failure.
- `google-generativeai` removed from dependencies (it was never imported;
  Gemini still works via `GEMINI_API_KEY` through the OpenAI-compatible
  endpoint). Reinstall with `pip install -e .`.
- **Deprecated** (still honored this release, **removed in 1.0**):
  `AISC_REVIEW_MIN_SCORE` / `AISC_REVIEW_FIX_ITER`. Replace with the
  improve-loop options:
  - TUI: `/improve <min>:<rounds>` (persisted), or row **A** for the preset;
  - headless: `aiscientist -q run ... --improve --min-score 6 --rounds 2`;
  - env/module: `IMPROVE=on`, `IMPROVE_MIN_SCORE`, `IMPROVE_ROUNDS`.
  Setting the old pair now emits a `DeprecationWarning`.

## beta 3 → 1.0 (planned)

- `AISC_REVIEW_MIN_SCORE` / `AISC_REVIEW_FIX_ITER` are **deleted**; only the
  improve-loop options remain.
- Remaining decisions (PyPI publishing, exact feature set) are tracked in
  `docs/ROADMAP-1.0.md`.
