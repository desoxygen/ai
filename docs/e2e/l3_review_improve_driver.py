"""L3 driver: real review -> real improvement -> re-review, measuring everything.

Uses the pipeline's own functions (load_paper, perform_review, perform_improvement,
compile_latex) on the actually generated article. Reviewer: strong free model;
improver: same 131k-context model through Aider (a local 7B coder cannot fit a
22KB template.tex in its default context - a real finding from this run).
"""
import json
import os
import sys
import time

from ai_scientist.console import ensure_utf8_stdio
ensure_utf8_stdio()

os.environ.setdefault("AISC_INTERACTIVE", "no")
os.environ.setdefault("AISC_HEADLESS_ON_LIMIT", "skip")

from ai_scientist import settings
settings.load_dotenv()

from aider.coders import Coder
from aider.io import InputOutput
from aider.models import Model

from ai_scientist.llm import create_client
from ai_scientist.perform_review import load_paper, perform_improvement, perform_review
from ai_scientist.perform_writeup import compile_latex

FOLDER = "results/e2e_grok/20260910_182605_cosine_lr_schedule"
PDF = os.path.join(FOLDER, "cosine_lr_schedule.pdf")
REVIEWER = "openrouter/nvidia/nemotron-3-super-120b-a12b:free"
CODER = "openrouter/nvidia/nemotron-3-super-120b-a12b:free"  # 131k ctx for a 22KB tex
R = {"model": REVIEWER}


def score_of(review):
    try:
        return float(str(review["Overall"]).split("/")[0])
    except Exception:
        return None


def main():
    t0 = time.time()
    paper = load_paper(PDF)
    R["paper_chars"] = len(paper)
    print(f"[{time.time()-t0:7.1f}s] load_paper: {len(paper)} chars", flush=True)

    client, model = create_client(REVIEWER)
    cached = os.path.join(FOLDER, "review.txt")
    if os.path.exists(cached):  # resume-safe: reuse review#1 from a previous attempt
        review1 = json.load(open(cached, encoding="utf-8"))
        R["review1_seconds"] = 0.0
        print(f"[{time.time()-t0:7.1f}s] review#1 reused from cache", flush=True)
    else:
        t = time.time()
        review1 = perform_review(paper, model=model, client=client, num_reflections=5,
                                 num_fs_examples=1, num_reviews_ensemble=1, temperature=0.1)
        R["review1_seconds"] = round(time.time() - t, 1)
        with open(cached, "w", encoding="utf-8") as f:
            json.dump(review1, f, indent=2, ensure_ascii=False)
    R["review1_overall"] = score_of(review1)
    R["review1_weaknesses"] = review1.get("Weaknesses", [])[:3]
    with open(os.path.join(FOLDER, "review.txt"), "w", encoding="utf-8") as f:
        json.dump(review1, f, indent=2, ensure_ascii=False)
    print(f"[{time.time()-t0:7.1f}s] review#1: {R['review1_overall']}/10 "
          f"({R['review1_seconds']}s)", flush=True)

    # improve round via Aider with the big-context free model
    io = InputOutput(yes=True, chat_history_file=os.path.join(FOLDER, "improve_aider.txt"))
    coder = Coder.create(main_model=Model(CODER),
                         fnames=[os.path.join(FOLDER, "latex", "template.tex")],
                         io=io, stream=False, use_git=False, edit_format="diff")
    t = time.time()
    perform_improvement(review1, coder)
    R["improve_seconds"] = round(time.time() - t, 1)
    print(f"[{time.time()-t0:7.1f}s] improve round done ({R['improve_seconds']}s)", flush=True)

    compile_latex(os.path.join(FOLDER, "latex"), PDF, timeout=180)
    R["recompiled"] = os.path.exists(PDF) and os.path.getsize(PDF)

    t = time.time()
    paper2 = load_paper(PDF)
    review2 = perform_review(paper2, model=model, client=client, num_reflections=5,
                             num_fs_examples=1, num_reviews_ensemble=1, temperature=0.1)
    R["review2_seconds"] = round(time.time() - t, 1)
    R["review2_overall"] = score_of(review2)
    with open(os.path.join(FOLDER, "review2.txt"), "w", encoding="utf-8") as f:
        json.dump(review2, f, indent=2, ensure_ascii=False)
    print(f"[{time.time()-t0:7.1f}s] review#2: {R['review2_overall']}/10", flush=True)

    R["total_seconds"] = round(time.time() - t0, 1)
    with open(os.path.join(FOLDER, "l3_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(R, f, indent=2, ensure_ascii=False)
    print("DONE", flush=True)


main()
