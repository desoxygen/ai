"""Integration tests for the perform_* science modules — no API, no GPU, no LaTeX.

Aider coders, LLM clients and chktex/pdflatex are replaced by recording fakes;
``run_experiment`` runs a real subprocess against a synthetic ``experiment.py``
(hermetic, ~1 s). Closes the "no integration tests for perform_*" gap from
docs/BETA0.1.md §16 and docs/ANALYSIS.md.
"""
import io
import json

import pytest

from ai_scientist import perform_experiments as pe
from ai_scientist import perform_review as pr
from ai_scientist import perform_writeup as pw
from ai_scientist import settings
from ai_scientist.loop_guard import StageSkip

IDEA = {"Name": "idea_x", "Title": "A Title", "Experiment": "Do the thing."}


class FakeCoder:
    """Records every prompt; replays scripted replies (last reply repeats)."""

    def __init__(self, replies=()):
        self.prompts = []
        self._replies = list(replies)

    def run(self, prompt):
        self.prompts.append(prompt)
        return self._replies.pop(0) if self._replies else "done"


# ---------------------------------------------------------------- experiments
def test_perform_experiments_happy_path(tmp_path, monkeypatch):
    """Full flow with a REAL subprocess experiment: run -> sanity -> plot -> notes."""
    (tmp_path / "experiment.py").write_text(
        "import argparse, json, os\n"
        "p = argparse.ArgumentParser(); p.add_argument('--out_dir')\n"
        "a = p.parse_args()\n"
        "os.makedirs(a.out_dir, exist_ok=True)\n"
        "json.dump({'acc': {'means': 0.68, 'stderrs': 0.0}},\n"
        "          open(os.path.join(a.out_dir, 'final_info.json'), 'w'))\n",
        encoding="utf-8")
    monkeypatch.setattr(pe, "run_plotting", lambda folder_name, timeout=600: (0, ""))
    coder = FakeCoder(["working on it", "ALL_COMPLETED"])

    ok = pe.perform_experiments(IDEA, str(tmp_path), coder, baseline_results={"acc": 0.60})

    assert ok is True
    assert (tmp_path / "run_1" / "final_info.json").exists()   # run executed
    assert (tmp_path / "run_1.py").exists()                    # code snapshot
    assert (tmp_path / "sanity.json").exists()                 # sanity gate ran
    json.loads((tmp_path / "sanity.json").read_text(encoding="utf-8"))
    assert "ALL_COMPLETED" in coder.prompts[1]                 # result fed back


def test_perform_experiments_sanity_suspect_feeds_back(tmp_path, monkeypatch):
    """A 10x jump over baseline must be flagged 'suspect' and surfaced to the coder."""
    def fake_run(folder_name, run_num, timeout=7200, deadline=0.0):
        d = tmp_path / f"run_{run_num}"
        d.mkdir(exist_ok=True)
        (d / "final_info.json").write_text(
            json.dumps({"acc": {"means": 5.0, "stderrs": 0.0}}))
        return 0, "results"
    monkeypatch.setattr(pe, "run_experiment", fake_run)
    monkeypatch.setattr(pe, "run_plotting", lambda folder_name, timeout=600: (0, ""))
    coder = FakeCoder(["change", "ALL_COMPLETED"])

    ok = pe.perform_experiments(IDEA, str(tmp_path), coder, baseline_results={"acc": 0.50})

    assert ok is True
    assert "SANITY WARNING" in coder.prompts[1]


def test_perform_experiments_identical_errors_escalate(tmp_path, monkeypatch):
    """Regression: the repeat-signature key must be run-number-INDEPENDENT,
    otherwise identical crash loops never reach the guard."""
    monkeypatch.setattr(settings.GUARD, "max_repeat_signatures", 2)
    monkeypatch.setattr(pe, "run_experiment",
                        lambda folder_name, run_num, **kw: (1, "boom: same crash trace"))
    coder = FakeCoder(["try"] * 5)

    with pytest.raises(StageSkip):
        pe.perform_experiments(IDEA, str(tmp_path), coder, baseline_results={"acc": 0.5})


def test_run_plotting_uses_pipeline_interpreter(tmp_path, monkeypatch):
    """Regression: plotting must run under sys.executable, not PATH "python"
    (on Windows the PATH python can be a different install without deps)."""
    seen = {}

    class FakeProc:
        returncode = 0
        stderr = ""

    def fake_run(command, **kw):
        seen["command"] = command
        return FakeProc()

    monkeypatch.setattr(pe.subprocess, "run", fake_run)
    code, prompt = pe.run_plotting(str(tmp_path))
    assert code == 0 and prompt == ""
    assert seen["command"][0] == pe.sys.executable
    assert seen["command"][1:] == ["plot.py"]


# --------------------------------------------------------------------- review
def _review_json(overall=6):
    return json.dumps({
        "Summary": "s", "Strengths": [], "Weaknesses": ["unclear eval"],
        "Originality": 3, "Quality": 3, "Clarity": 3, "Significance": 3,
        "Questions": [], "Limitations": [], "Ethical Concerns": False,
        "Soundness": 3, "Presentation": 3, "Contribution": 3,
        "Overall": overall, "Confidence": 3, "Decision": "Accept",
    })


def _review_reply(overall):
    return "THOUGHT:\nnote the unclear evaluation\nREVIEW JSON:\n```json\n" + _review_json(overall) + "\n```"


def test_perform_review_single(monkeypatch):
    seen = {}

    def fake_get(msg, **kw):
        seen["msg"] = msg
        return _review_reply(7), []

    monkeypatch.setattr(pr, "get_response_from_llm", fake_get)
    review = pr.perform_review("A great paper about grokking. " * 20, model="fake-model",
                               client=None, num_reflections=1, num_fs_examples=0,
                               num_reviews_ensemble=1)
    assert review["Overall"] == 7
    assert "A great paper" in seen["msg"]          # the paper text reached the model
    assert review["Weaknesses"] == ["unclear eval"]


def test_perform_review_ensemble_averages_scores(monkeypatch):
    def fake_batch(msg, **kw):
        return [_review_reply(4), _review_reply(8)], [[], []]

    monkeypatch.setattr(pr, "get_batch_responses_from_llm", fake_batch)
    monkeypatch.setattr(pr, "get_meta_review",
                        lambda model, client, temperature, reviews: dict(reviews[0]))
    review = pr.perform_review("paper text", model="fake", client=None,
                               num_reflections=1, num_fs_examples=0,
                               num_reviews_ensemble=2)
    assert review["Overall"] == 6                   # mean(4, 8)


def test_perform_review_ensemble_falls_back_when_unparsable(monkeypatch):
    """Regression: if NO ensemble member returns valid JSON the function used
    to crash with IndexError; it must degrade to a single reviewer instead."""
    def fake_batch(msg, **kw):
        return ["total nonsense", "also nonsense"], [[], []]

    fallback_calls = []

    def fake_single(msg, **kw):
        fallback_calls.append(msg)
        return _review_reply(5), []

    monkeypatch.setattr(pr, "get_batch_responses_from_llm", fake_batch)
    monkeypatch.setattr(pr, "get_response_from_llm", fake_single)
    monkeypatch.setattr(pr, "get_meta_review",
                        lambda *a, **k: pytest.fail("meta review must not run"))
    review = pr.perform_review("paper text", model="fake", client=None,
                               num_reflections=1, num_fs_examples=0,
                               num_reviews_ensemble=3)
    assert review["Overall"] == 5
    assert len(fallback_calls) == 1


def test_perform_improvement_hands_review_to_coder():
    coder = FakeCoder(["revised"])
    out = pr.perform_improvement({"Overall": 5, "Weaknesses": ["unclear eval"]}, coder)
    assert out == "revised"
    assert "unclear eval" in coder.prompts[0]
    assert "Do not invent new results" in coder.prompts[0]


def test_review_fewshot_read_is_utf8(tmp_path, monkeypatch):
    """Regression (found on the 2026-09-10 Windows E2E run): few-shot files
    contain non-ASCII; opening them with the platform default (cp1252) blew up
    the whole review stage on Windows."""
    d = tmp_path / "fewshot"
    d.mkdir()
    (d / "p.txt").write_text("paper with smart quotes \u201c\u2018\u201d", encoding="utf-8")
    (d / "r.json").write_text('{"review": "great work \\u2014 with em dash"}', encoding="utf-8")
    monkeypatch.setattr(pr, "fewshot_papers", [str(d / "p.pdf")])
    monkeypatch.setattr(pr, "fewshot_reviews", [str(d / "r.json")])
    prompt = pr.get_review_fewshot_examples(1)
    assert "smart quotes" in prompt and "em dash" in prompt


def test_load_paper_real_pdf(tmp_path):
    pymupdf = pytest.importorskip("pymupdf")
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Hello paper world. " * 12)
    pdf = tmp_path / "t.pdf"
    doc.save(str(pdf))
    doc.close()
    text = pr.load_paper(str(pdf))
    assert "Hello paper world" in text


# -------------------------------------------------------------------- writeup
TEX = r"""\documentclass{article}
\begin{filecontents}{references.bib}
@article{good2024, title={Good}}
\end{filecontents}
\section{Intro}
We cite \cite{good2024} and \cite{ghost2024}.
\includegraphics{real_fig.png}
\includegraphics{missing_fig.png}
\section{Intro}
\end{document}
"""


def _make_latex_folder(tmp_path):
    folder = tmp_path / "study"
    (folder / "latex").mkdir(parents=True)
    (folder / "latex" / "template.tex").write_text(TEX, encoding="utf-8")
    (folder / "real_fig.png").write_bytes(b"\x89PNG\r\n")
    return folder


def test_generate_latex_flags_broken_refs_and_dups(tmp_path, monkeypatch):
    folder = _make_latex_folder(tmp_path)
    monkeypatch.setattr(pw.os, "popen", lambda cmd: io.StringIO(""))  # no chktex output

    def fake_compile(cwd, pdf_file, timeout=30):
        open(pdf_file, "wb").close()
    monkeypatch.setattr(pw, "compile_latex", fake_compile)
    coder = FakeCoder()

    pw.generate_latex(coder, str(folder), str(folder / "paper.pdf"))

    prompts = "\n".join(coder.prompts)
    assert "ghost2024" in prompts            # citation missing from bib
    assert "missing_fig.png" in prompts      # figure not on disk
    assert "Duplicate section header" in prompts
    assert (folder / "paper.pdf").exists()   # compile step was reached


def test_perform_writeup_full_flow(tmp_path, monkeypatch):
    folder = _make_latex_folder(tmp_path)
    monkeypatch.setattr(pw, "get_citation_aider_prompt", lambda *a, **k: (None, True))

    generated = {}

    def fake_gen(coder, folder_name, pdf_file, **kw):
        generated["pdf"] = pdf_file
        open(pdf_file, "wb").close()
    monkeypatch.setattr(pw, "generate_latex", fake_gen)
    coder = FakeCoder()

    pw.perform_writeup(IDEA, str(folder), coder, cite_client=None, cite_model="fake")

    assert generated["pdf"] == f"{folder}/idea_x.pdf"
    assert (folder / "idea_x.pdf").exists()
    # Abstract + 6 sections refined twice, related-work sketch, title pass, 8
    # second-refinement passes => the coder must have been walked section by section.
    assert len(coder.prompts) >= 24
    assert any("Experimental Setup" in p for p in coder.prompts)
    assert any("refine only the Abstract" in p for p in coder.prompts)
