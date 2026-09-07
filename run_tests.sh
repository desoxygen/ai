#!/bin/bash
# Полный прогон тестов AI-Scientist: pytest-набор + smoke-скрипт.
set -e
cd "$(dirname "$0")"
if ! python -c "import pytest" 2>/dev/null; then
    echo "Ставлю pytest…"
    pip install -q -r requirements-dev.txt
fi
python -m pytest tests/ -q --tb=short "$@"
echo
python tests/test_smoke.py
