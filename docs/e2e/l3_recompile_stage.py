"""L3 stage 2 (foreground): recompile the improved template, re-review, save metrics."""
import json
import os
import sys
import time

sys.path.insert(0, ".")
from ai_scientist.console import ensure_utf8_stdio
ensure_utf8_stdio()
from ai_scientist import settings
settings.load_dotenv()

FOLDER = "results/e2e_grok/20260910_182605_cosine_lr_schedule"
PDF = os.path.join(FOLDER, "cosine_lr_schedule.pdf")
REVIEWER = "openrouter/nvidia/nemotron-3-super-120b-a12b:free"

t0 = time.time()
from ai_scientist.perform_writeup import compile_latex
compile_latex(os.path.join(FOLDER, "latex"), PDF, timeout=240)
size = os.path.getsize(PDF) if os.path.exists(PDF) else 0
print(f"[{time.time()-t0:6.1f}s] recompiled: {size} bytes", flush=True)
assert size > 0

from ai_scientist.llm import create_client
from ai_scientist.perform_review import load_paper, perform_review
client, model = create_client(REVIEWER)
t = time.time()
review2 = perform_review(load_paper(PDF), model=model, client=client, num_reflections=5,
                         num_fs_examples=1, num_reviews_ensemble=1, temperature=0.1)
r2_secs = round(time.time() - t, 1)
with open(os.path.join(FOLDER, "review2.txt"), "w", encoding="utf-8") as f:
    json.dump(review2, f, indent=2, ensure_ascii=False)
score2 = review2.get("Overall")

mpath = os.path.join(FOLDER, "l3_metrics.json")
R = json.load(open(mpath, encoding="utf-8")) if os.path.exists(mpath) else {}
review1 = json.load(open(os.path.join(FOLDER, "review.txt"), encoding="utf-8"))
R.update({
    "review1_overall": review1.get("Overall"),
    "review1_weaknesses": (review1.get("Weaknesses") or [])[:3],
    "improve_seconds": 212.6,
    "recompiled": size,
    "review2_seconds": r2_secs,
    "review2_overall": score2,
    "pdf_pages": len(__import__("pypdf").PdfReader(PDF).pages),
})
json.dump(R, open(mpath, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"[{time.time()-t0:6.1f}s] review#2: {score2}/10 in {r2_secs}s (was {R.get('review1_overall')})", flush=True)
print("PAGES:", R["pdf_pages"], "| L3 STAGE2 DONE")
