"""Tests for the research quality gates (sanity, stats, budget, learnings)."""
import json
import os
import os.path as osp
import sys

import pytest

sys.path.insert(0, osp.join(osp.dirname(__file__), ".."))

from ai_scientist.research_quality import (  # noqa: E402
    _norm, append_learning, idea_budget_deadline, load_learnings,
    sanity_check, welch_z, write_run_meta,
)
from ai_scientist.perform_experiments import _aggregate_seeds  # noqa: E402


def fi(mean, stderr=0.0):
    return {"means": mean, "stderrs": stderr}


class TestWelchZ:
    def test_zero_se(self):
        assert welch_z(1.0, 0.0, 0.0) == float("inf")
        assert welch_z(0.0, 0.0, 0.0) == 0.0

    def test_known_value(self):
        # delta=2, combined stderr=1 → z=2
        assert welch_z(2.0, 1.0, 0.0) == pytest.approx(2.0)


class TestSanityCheck:
    def test_ok_within_noise(self):
        base = {"acc": fi(0.5, 0.02)}
        run = {"acc": fi(0.52, 0.02)}
        v = sanity_check(base, run)
        assert v["verdict"] == "ok"

    def test_suspect_huge_jump(self):
        base = {"acc": fi(0.5, 0.01)}
        run = {"acc": fi(1.9, 0.01)}  # +280%
        v = sanity_check(base, run)
        assert v["verdict"] == "suspect"
        flags = [f for m in v["metrics"] for f in m["flags"]]
        assert "huge-jump" in flags

    def test_suspect_too_clean(self):
        base = {"acc": fi(0.5, 0.0)}
        run = {"acc": fi(1.2, 0.0)}  # big gain, zero noise
        v = sanity_check(base, run)
        assert v["verdict"] == "suspect"

    def test_insignificant_gain(self):
        base = {"acc": fi(0.50, 0.10)}
        run = {"acc": fi(0.53, 0.10)}  # +6% with huge stderrs
        v = sanity_check(base, run)
        assert v["verdict"] == "insignificant"

    def test_no_shared_metrics(self):
        v = sanity_check({"a": fi(1.0)}, {"b": fi(1.0)})
        assert v["verdict"] == "unknown"

    def test_normalizes_raw_floats(self):
        n = _norm({"acc": 0.5, "loss": {"mean": 1.0, "stderr": 0.1}})
        assert n["acc"] == {"mean": 0.5, "stderr": 0.0}
        assert n["loss"] == {"mean": 1.0, "stderr": 0.1}


class TestAggregateSeeds:
    def test_mean_and_stderr(self):
        runs = [
            {"acc": {"means": 0.5, "stderrs": 0.01}},
            {"acc": {"means": 0.6, "stderrs": 0.01}},
        ]
        merged = _aggregate_seeds("", runs)
        assert merged["acc"]["means"] == pytest.approx(0.55)
        # std of [0.5, 0.6] (n-1) = 0.0707 → stderr of mean = std/sqrt(2) = 0.05
        assert merged["acc"]["stderrs"] == pytest.approx(0.05, rel=1e-3)

    def test_empty(self):
        assert _aggregate_seeds("", []) == {}


class TestRunMeta:
    def test_writes_snapshot(self, tmp_path):
        (tmp_path / "experiment.py").write_text("print('hi')\n")
        p = write_run_meta(str(tmp_path), model="openrouter/z-ai/glm-4.6",
                           run_id="test", idea_name="my_idea", seeds=3)
        meta = json.loads(open(p, encoding="utf-8").read())
        assert meta["model"].endswith("glm-4.6")
        assert meta["idea"] == "my_idea"
        assert meta["seeds_requested"] == 3
        assert len(meta["experiment_sha256_16"]) == 16
        assert "python" in meta


class TestLearnings:
    def test_append_and_load(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        append_learning("tpl", "idea_a", "reviewed", "review 7/10")
        append_learning("tpl", "idea_b", "experiments_failed", "OOM")
        text = load_learnings("tpl")
        assert "idea_a" in text and "reviewed" in text
        assert "idea_b" in text and "OOM" in text

    def test_missing_returns_empty(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        assert load_learnings("nope") == ""


class TestBudget:
    def test_off_by_default(self, monkeypatch):
        monkeypatch.delenv("AISC_IDEA_BUDGET_MINUTES", raising=False)
        assert idea_budget_deadline() == 0.0

    def test_deadline_in_future(self, monkeypatch):
        monkeypatch.setenv("AISC_IDEA_BUDGET_MINUTES", "5")
        d = idea_budget_deadline()
        assert d > __import__("time").time()
