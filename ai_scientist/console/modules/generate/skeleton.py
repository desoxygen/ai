"""generate/skeleton — AI-макет исследовательского проекта.

По пользовательскому описанию задачи LLM пишет каркас шаблона:
`experiment.py` (крошечный CPU-дружелюбный эксперимент с `--out_dir` и
`final_info.json`), `plot.py` и `prompt.json` + `seed_ideas.json`, затем
(опционально) прогоняет baseline `run_0`, чтобы проект был сразу runnable
в `pipeline/run`.

Внимание: код генерирует LLM и он же исполняется локально — запускайте в
изолированном окружении (см. README → Safety).
"""
import json
import os
import os.path as osp
import re
import subprocess
import sys

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,47}$")

MANIFEST = {
    "type": "generate",
    "description": "AI skeleton for a new research project (experiment.py + plot.py + baseline)",
    "options": {
        "NAME": {"required": True, "type": "str", "default": ""},
        "DESCRIPTION": {"required": True, "type": "str", "default": ""},
        "MODEL": {"required": False, "type": "str", "default": ""},
        "RUN_BASELINE": {"required": False, "type": "choice",
                         "choices": ["on", "off"], "default": "on"},
    },
}

SYSTEM = (
    "You are an experienced ML researcher building a starter template for an "
    "automated experiment pipeline. The code you write must run on CPU in a "
    "few minutes, be deterministic, and never download datasets from the "
    "internet — generate synthetic data inline with a fixed seed."
)

EXP_PROMPT = """Design a minimal but real research template for this project:
\"\"\"
{desc}
\"\"\"

Write ONE self-contained Python file `experiment.py` (Python 3.11+, numpy and
optionally torch are available; prefer plain numpy unless the task truly needs
torch). Requirements, STRICT:
- argparse with `--out_dir` (default "run_0"); create the directory
- fixed seed at the top (np.random.default_rng(0)) and a tiny CPU-friendly
  workload: total runtime well under 2 minutes
- train/eval loop over a few hyperparameter variants implied by the task
  (keep them tiny), with a small held-out split
- print a compact per-run summary to stdout
- write `<out_dir>/final_info.json` of the shape
  {{"<metric>": {{"means": <float>, "stds": <float>}}, ...}} with at least a
  `val_loss`/`test_loss`-style metric
Return ONLY the full file inside a single ```python fenced block."""

PLOT_PROMPT = """Now write `plot.py` for the same template (project: {desc}).
Requirements:
- plain matplotlib, non-interactive backend (Agg), no seaborn
- reads `run_*/final_info.json` relative to the script directory, skips unreadable runs
- saves one figure per metric into `figs/<metric>.png` (create figs/), also prints where it saved
- accepts an optional `--out_dir` but works without arguments
Return ONLY the full file inside a single ```python fenced block."""

FIX_PROMPT = """`python experiment.py --out_dir run_0` failed in the template dir with:
```
{err}
```
Fix {fname} (keep the same contract: --out_dir, final_info.json for experiment.py).
Return ONLY the corrected full file inside a single ```python fenced block."""


def _extract_code(text):
    m = re.search(r"```(?:python|py)?\s*\n(.*?)```", text, re.S)
    return m.group(1).strip() + "\n" if m else ""


def _llm(client, model, msg, system, max_tokens=8000):
    from ai_scientist.llm import get_response_from_llm
    out, _ = get_response_from_llm(msg, client=client, model=model,
                                   system_message=system, max_tokens=max_tokens)
    return out or ""


def _baseline_timeout():
    try:
        return max(60, int(float(os.environ.get("AISC_SKELETON_TIMEOUT_MIN", "20"))) * 60)
    except ValueError:
        return 1200


def _run(cmd, cwd, emit, timeout):
    emit("skeleton", "log", "$ " + " ".join(cmd))
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, f"timeout after {timeout}s"
    return p.returncode == 0, ((p.stdout or "") + "\n" + (p.stderr or ""))[-2500:]


def run(options, job, emit, stop_event=None):
    from ai_scientist import openrouter
    from ai_scientist.llm import create_client

    name = (options.get("NAME") or "").strip()
    desc = (options.get("DESCRIPTION") or "").strip()
    model = (options.get("MODEL") or "").strip() or openrouter.default_model()
    run_baseline = str(options.get("RUN_BASELINE") or "on").lower() != "off"
    if not NAME_RE.match(name):
        raise ValueError("NAME: lowercase latin letters/digits/_/-, 2-48 chars")
    base_dir = osp.join("templates", name)
    if osp.exists(osp.join(base_dir, "experiment.py")):
        raise ValueError(f"templates/{name} already has experiment.py — refusing to overwrite")
    if not desc:
        raise ValueError("DESCRIPTION is required")

    client, client_model = create_client(model)
    os.makedirs(base_dir, exist_ok=True)
    emit("skeleton", "started", f"AI-макет «{name}» ({client_model})", detail={"path": base_dir})
    files = {}
    try:
        for fname, prompt in (("experiment.py", EXP_PROMPT.format(desc=desc)),
                              ("plot.py", PLOT_PROMPT.format(desc=desc[:200]))):
            if stop_event is not None and stop_event.is_set():
                raise KeyboardInterrupt("stopped")
            code = ""
            for attempt in range(2):
                text = _llm(client, client_model, prompt, SYSTEM)
                code = _extract_code(text)
                if code:
                    break
                prompt = (prompt + "\n\nYour last answer had no runnable ```python block. "
                          "Return ONLY the fenced file.")
            if not code:
                raise RuntimeError(f"LLM не вернула код для {fname}")
            with open(osp.join(base_dir, fname), "w", encoding="utf-8") as f:
                f.write(code)
            files[fname] = code
            emit("skeleton", "log", f"написан {fname} ({len(code.splitlines())} строк)")

        pj = osp.join(base_dir, "prompt.json")
        if not osp.exists(pj):  # /skeleton on an existing project must not clobber it
            with open(pj, "w", encoding="utf-8") as f:
                json.dump({"system": SYSTEM, "task_description": desc}, f,
                          ensure_ascii=False, indent=2)
                f.write("\n")
        seed = {"Name": f"{name}_seed_1",
                "Title": desc.split("\n")[0][:160],
                "Experiment": desc[:1200],
                "Interestingness": 6, "Feasibility": 6, "Novelty": 5}
        sj = osp.join(base_dir, "seed_ideas.json")
        if not osp.exists(sj):
            with open(sj, "w", encoding="utf-8") as f:
                json.dump([seed], f, ensure_ascii=False, indent=2)
                f.write("\n")
        files.update({osp.basename(pj): "", osp.basename(sj): ""})

        baseline_ok = None
        if run_baseline:
            py = os.environ.get("AISC_PYTHON") or sys.executable
            ok, out = _run([py, "experiment.py", "--out_dir", "run_0"],
                           base_dir, emit, _baseline_timeout())
            if not ok and "experiment.py" in files:
                emit("skeleton", "log", "baseline упал — прошу LLM починить experiment.py")
                fixed = _extract_code(_llm(
                    client, client_model,
                    FIX_PROMPT.format(err=out, fname="experiment.py"), SYSTEM))
                if fixed:
                    with open(osp.join(base_dir, "experiment.py"), "w", encoding="utf-8") as f:
                        f.write(fixed)
                    ok, out = _run([py, "experiment.py", "--out_dir", "run_0"],
                                   base_dir, emit, _baseline_timeout())
            if ok and osp.exists(osp.join(base_dir, "run_0", "final_info.json")):
                _run([py, "plot.py"], base_dir, emit, 180)
                baseline_ok = True
                emit("skeleton", "done",
                     f"макет «{name}» готов: baseline run_0 прогнан",
                     detail={"path": base_dir, "files": sorted(files), "baseline": True})
            else:
                baseline_ok = False
                emit("skeleton", "done",
                     f"макет «{name}» записан, но baseline не прошёл — "
                     f"почини experiment.py и повтори `/skeleton-baseline {name}`",
                     detail={"path": base_dir, "files": sorted(files), "baseline": False,
                             "error": out[-500:]})
        else:
            emit("skeleton", "done", f"макет «{name}» записан (baseline выключен)",
                 detail={"path": base_dir, "files": sorted(files), "baseline": None})
        return {"ok": True, "path": base_dir, "files": sorted(files),
                "baseline_ok": baseline_ok}
    except Exception as e:
        emit("skeleton", "fail", str(e)[:300], detail={"error": str(e)[:300]})
        return {"ok": False, "path": base_dir, "error": str(e)[:300]}
