"""Тесты pipeline: стадии, статусы, resume, graceful-прерывание — всё на фейках."""
import json
import types

import pytest

from ai_scientist import pipeline as pl
from ai_scientist.pipeline import PipelineRunner


@pytest.fixture()
def runner(tmp_path, monkeypatch):
    """Runner с подменённым клиентом и изолированной папкой результатов."""
    monkeypatch.setattr(pl, "create_client", lambda model: (None, "fake-model"))
    r = PipelineRunner("nanoGPT_lite", "fake-model", num_ideas=2,
                       stages={"ideas"})
    # результаты — во временную папку проекта
    monkeypatch.setattr(r, "results_dir", str(tmp_path / "results" / "nanoGPT_lite"))
    return r


def test_stage_ideas_generates_when_selected(runner, monkeypatch):
    calls = {}
    ideas = [{"Name": "gen_one", "Title": "T", "Experiment": "E"}]

    def fake_generate(*a, **kw):
        calls["called"] = True
        return ideas

    monkeypatch.setattr(pl, "generate_ideas", fake_generate)
    out = runner.stage_ideas()
    assert calls["called"] and out == ideas


def test_stage_ideas_reuses_when_not_selected(runner, monkeypatch):
    monkeypatch.setattr(pl, "generate_ideas",
                        lambda *a, **kw: pytest.fail("не должен вызываться"))
    runner.stages = {"experiments"}
    existing = runner._ideas_from_json()
    if existing:  # в реальном шаблоне есть ideas.json
        assert runner.stage_ideas() == existing


def test_novelty_zero_stops_pipeline(runner, monkeypatch, tmp_vault):
    def fake_ideas(*a, **kw):
        return [{"Name": "a", "Title": "T", "Experiment": "E"},
                {"Name": "b", "Title": "T", "Experiment": "E"}]

    def fake_novelty(ideas, **kw):
        for i in ideas:
            i["novel"] = False
        return ideas

    monkeypatch.setattr(pl, "generate_ideas", fake_ideas)
    monkeypatch.setattr(pl, "check_idea_novelty", fake_novelty)
    runner.stages = {"ideas", "novelty"}
    summary = runner.run()
    assert summary["ideas"] == []          # ни одна не novel → стоп
    assert runner.statuses == {}


def test_idea_marked_noted_when_no_exec_stages(runner, monkeypatch, tmp_vault):
    monkeypatch.setattr(pl, "generate_ideas",
                        lambda *a, **kw: [{"Name": "only_idea", "Title": "T",
                                           "Experiment": "E"}])
    runner.stages = {"ideas"}
    summary = runner.run()
    assert summary["statuses"]["only_idea"]["status"] == "noted"


def test_experiments_failure_marks_status(runner, monkeypatch, tmp_vault):
    monkeypatch.setattr(pl, "generate_ideas",
                        lambda *a, **kw: [{"Name": "bad_idea", "Title": "T",
                                           "Experiment": "E"}])
    monkeypatch.setattr(pl, "perform_experiments",
                        lambda *a, **kw: False)  # лимит итераций
    runner.stages = {"ideas", "experiments"}
    # baseline отсутствует (нет run_0) → идея получит "skipped/no baseline"
    summary = runner.run()
    st = summary["statuses"]["bad_idea"]
    assert st["status"] in ("skipped", "experiments_failed")


def test_run_idea_success_flow(runner, monkeypatch, tmp_vault, tmp_path):
    """Полный путь одной идеи на фейках: эксперименты ок → writeup ок → reviewed."""
    idea = {"Name": "good_idea", "Title": "T", "Experiment": "E"}
    monkeypatch.setattr(pl, "perform_experiments", lambda *a, **kw: True)
    monkeypatch.setattr(PipelineRunner, "stage_writeup",
                        lambda self, idea, folder, notes: True)
    monkeypatch.setattr(PipelineRunner, "stage_review",
                        lambda self, idea, folder: True)
    monkeypatch.setattr(PipelineRunner, "_make_coder", lambda *a, **kw: None)

    fake_baseline = {"gpt": {"means": {"loss": 1.0}}}
    runner.stages = {"experiments", "writeup", "review"}
    template_dir = tmp_path / "tpl_with_baseline"
    template_dir.mkdir()
    (template_dir / "run_0").mkdir()
    (template_dir / "run_0" / "final_info.json").write_text(json.dumps(fake_baseline))
    (template_dir / "notes.txt").write_text("", encoding="utf-8")
    runner.base_dir = str(template_dir)

    runner.run_idea(idea)
    assert runner.statuses["good_idea"]["status"] == "reviewed"


def test_idea_from_folder_reconstructs(runner, tmp_path):
    folder = tmp_path / "results" / "nanoGPT_lite" / "20260101_000000_my_idea"
    folder.mkdir(parents=True)
    (folder / "notes.txt").write_text(
        "# Title: Моя идея\n# Experiment description: описание\n", encoding="utf-8")
    idea = runner._idea_from_folder(folder)
    assert idea["Name"] == "my_idea"
    assert "Моя идея" in idea["Title"]
    assert "описание" in idea["Experiment"]


def test_resume_run_invokes_writeup_and_review(runner, monkeypatch, tmp_path):
    folder = tmp_path / "results" / "nanoGPT_lite" / "20260101_000000_res_idea"
    folder.mkdir(parents=True)
    (folder / "notes.txt").write_text("# Title: R\n", encoding="utf-8")
    (folder / "latex").mkdir()
    (folder / "latex" / "template.tex").write_text("\\documentclass{article}", encoding="utf-8")
    (folder / "res_idea.pdf").write_bytes(b"%PDF-1.4 fake")

    calls = []
    monkeypatch.setattr(PipelineRunner, "stage_writeup",
                        lambda self, idea, folder, notes: calls.append("writeup") or True)
    monkeypatch.setattr(PipelineRunner, "stage_review",
                        lambda self, idea, folder: calls.append("review") or True)

    summary = runner.resume_run(folder, {"writeup", "review"})
    assert calls == ["writeup", "review"]
    assert "res_idea" in summary["statuses"]


def test_resume_run_missing_folder_raises(runner):
    with pytest.raises(FileNotFoundError):
        runner.resume_run("/нет/такой/папки", {"writeup"})


def test_keyboard_interrupt_is_graceful(runner, monkeypatch, tmp_vault):
    def boom(*a, **kw):
        raise KeyboardInterrupt()

    monkeypatch.setattr(PipelineRunner, "stage_ideas", boom)
    runner.stages = {"ideas"}
    summary = runner.run()
    assert summary["aborted"] is True


def test_run_aborted_is_graceful(runner, monkeypatch, tmp_vault):
    def boom(*a, **kw):
        from ai_scientist.loop_guard import RunAborted
        raise RunAborted("stop")

    monkeypatch.setattr(PipelineRunner, "stage_ideas", boom)
    runner.stages = {"ideas"}
    summary = runner.run()
    assert summary["aborted"] is True


# ------------------------------------------------------------- improvement loop
def _prep_review(runner, tmp_path, monkeypatch, scores):
    """Общая подготовка stage_review: фейковые ревью/правком/компиляция."""
    from ai_scientist import perform_writeup as pw

    folder = tmp_path / "20260907_120000_imp_idea"
    (folder / "latex").mkdir(parents=True)
    pdf = folder / "imp_idea.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    monkeypatch.delenv("AISC_REVIEW_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AISC_REVIEW_MIN_SCORE", raising=False)
    monkeypatch.delenv("AISC_REVIEW_FIX_ITER", raising=False)
    monkeypatch.setattr(pl, "load_paper", lambda p: "paper text")
    it = iter(scores)
    monkeypatch.setattr(pl, "perform_review",
                        lambda *a, **kw: {"Overall": next(it)})
    monkeypatch.setattr(PipelineRunner, "_make_coder", lambda *a, **kw: None)
    monkeypatch.setattr(pw, "compile_latex", lambda *a, **kw: None)
    calls = {"improve": 0}

    def fake_improve(review, coder):
        calls["improve"] += 1
    monkeypatch.setattr(pl, "perform_improvement", fake_improve)
    events = []
    runner.emit = lambda stage, status, message, **kw: events.append((stage, status))
    idea = {"Name": "imp_idea", "Title": "T", "Experiment": "E"}
    return idea, str(folder), pdf, calls, events


def test_improve_off_by_default(runner, tmp_path, monkeypatch, tmp_vault):
    idea, folder, _, calls, events = _prep_review(runner, tmp_path, monkeypatch, [3.0])
    assert runner.stage_review(idea, folder)
    assert calls["improve"] == 0
    assert not [e for e in events if e[0] == "improve"]


def test_improve_loop_repairs_and_reviews_again(runner, tmp_path, monkeypatch, tmp_vault):
    idea, folder, pdf, calls, events = _prep_review(
        runner, tmp_path, monkeypatch, [3.0, 8.0])
    runner.improvement = True
    runner.improve_min_score = 6.0
    runner.improve_rounds = 2
    assert runner.stage_review(idea, folder)
    assert calls["improve"] == 1  # второй раунд не нужен: 8 >= 6
    assert runner._last_review_score["imp_idea"] == 8.0
    seq = [e for e in events if e[0] == "improve"]
    assert seq[0] == ("improve", "started") and seq[-1] == ("improve", "done")
    assert ("review", "done") in events


def test_improve_env_legacy_knob_still_works(runner, tmp_path, monkeypatch, tmp_vault):
    idea, folder, _, calls, events = _prep_review(
        runner, tmp_path, monkeypatch, [4.0, 9.0])
    monkeypatch.setenv("AISC_REVIEW_FIX_ITER", "1")
    monkeypatch.setenv("AISC_REVIEW_MIN_SCORE", "6")
    assert runner.stage_review(idea, folder)
    assert calls["improve"] == 1


def test_improve_failure_closes_started(runner, tmp_path, monkeypatch, tmp_vault):
    idea, folder, _, calls, events = _prep_review(
        runner, tmp_path, monkeypatch, [3.0])
    runner.improvement = True
    runner.improve_rounds = 1

    def boom(review, coder):
        raise RuntimeError("aider down")
    monkeypatch.setattr(pl, "perform_improvement", boom)
    assert runner.stage_review(idea, folder)
    seq = [e for e in events if e[0] == "improve"]
    assert seq[0] == ("improve", "started")
    assert ("improve", "fail") in seq
    assert not [e for e in seq if e[1] == "done"]


def test_run_module_forwards_improve_options(tmp_path, monkeypatch):
    from ai_scientist.console.modules.pipeline import run as run_mod

    captured = {}

    class FakeRunner:
        def __init__(self, template, model, **kw):
            captured.update(kw)

        def run(self):
            return {"run_id": "r1", "statuses": {}, "aborted": False}

    monkeypatch.setattr(pl, "PipelineRunner", FakeRunner)
    (tmp_path / "templates" / "nanoGPT_lite").mkdir(parents=True)
    monkeypatch.chdir(tmp_path)
    res = run_mod.run(
        {"TEMPLATE": "nanoGPT_lite", "MODEL": "m1", "IMPROVE": "on",
         "IMPROVE_MIN_SCORE": 7, "IMPROVE_ROUNDS": 3},
        job=types.SimpleNamespace(run_id="r1"), emit=None)
    assert res["ok"]
    assert captured["improvement"] is True
    assert captured["improve_min_score"] == 7.0
    assert captured["improve_rounds"] == 3


# ------------------------------------------------------- LaTeX dependency check
def test_check_latex_requires_only_pdflatex(monkeypatch):
    """chktex (missing on MiKTeX) must NOT disable writeup/review anymore."""
    from ai_scientist import pipeline as _p
    monkeypatch.setattr(_p.shutil, "which",
                        lambda d: "C:/x/pdflatex.exe" if d == "pdflatex" else None)
    assert _p.check_latex_dependencies() is True


def test_check_latex_false_without_pdflatex(monkeypatch):
    from ai_scientist import pipeline as _p
    monkeypatch.setattr(_p.shutil, "which", lambda d: None)
    assert _p.check_latex_dependencies() is False
