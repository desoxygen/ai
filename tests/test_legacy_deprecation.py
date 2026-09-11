"""The legacy improve env pair must still work but loudly deprecate itself
(removal planned for v1.0 — see docs/MIGRATION.md)."""
import warnings

import pytest

from ai_scientist.pipeline import PipelineRunner


def test_legacy_env_pair_deprecation_warning(monkeypatch):
    monkeypatch.setenv("AISC_REVIEW_MIN_SCORE", "6")
    monkeypatch.setenv("AISC_REVIEW_FIX_ITER", "2")
    with pytest.warns(DeprecationWarning, match="AISC_REVIEW_MIN_SCORE"):
        assert PipelineRunner._legacy_improve_settings() == (6.0, 2)


def test_legacy_env_pair_silent_when_unset(monkeypatch):
    monkeypatch.delenv("AISC_REVIEW_MIN_SCORE", raising=False)
    monkeypatch.delenv("AISC_REVIEW_FIX_ITER", raising=False)
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # any warning becomes a failure
        assert PipelineRunner._legacy_improve_settings() == (0.0, 0)
