"""Research quality gates for the AI-Scientist pipeline.

Deterministic (non-LLM) checks that keep the science honest:

* sanity_check      — compares an idea run against the baseline. Flags
                      too-good-to-be-true jumps and statistically
                      insignificant wins using the stderrs that the
                      experiment template already reports per seed.
* welch_z           — significance of a delta given two independent stderrs
                      (normal approximation, no scipy dependency).
* write_run_meta    — reproducibility snapshot written into every run folder
                      (model, seeds, package versions, code hash).
* append_learning   — project knowledge base: what was already tried and how
                      it turned out, so idea generation stops reinventing.
"""
import hashlib
import json
import os
import os.path as osp
import platform
import sys
import time
from datetime import datetime

# A metric that more than doubles (or flips sign far) beyond what the seeds
# justify is treated as suspect until re-run confirms it.
SUSPECT_GAIN = 1.0        # +100% relative to baseline
SUSPECT_DROP = 0.9        # -90% relative to baseline
Z_SUSPECT = 8.0           # |delta| / combined stderr above this = too clean
Z_INSIGNIFICANT = 2.0     # below this the "win" is noise


def _norm(final_info: dict) -> dict:
    """Normalize final_info.json to {metric: {"mean": float, "stderr": float}}.

    Templates store {metric: {"means": x, "stderrs": y}}; raw floats and
    {"mean": ...} shapes are accepted too.
    """
    out = {}
    if not isinstance(final_info, dict):
        return out
    for metric, v in final_info.items():
        try:
            if isinstance(v, dict):
                mean = v.get("means", v.get("mean"))
                stderr = v.get("stderrs", v.get("stderr", 0.0))
            elif isinstance(v, (int, float)):
                mean, stderr = float(v), 0.0
            else:
                continue
            mean = float(mean)
            stderr = max(0.0, float(stderr))
            if mean == mean and abs(mean) != float("inf"):  # not NaN/inf
                out[metric] = {"mean": mean, "stderr": stderr}
        except (TypeError, ValueError):
            continue
    return out


def welch_z(delta: float, se_a: float, se_b: float) -> float:
    """z-score of a delta under independent standard errors (normal approx)."""
    combined = (se_a * se_a + se_b * se_b) ** 0.5
    if combined <= 0:
        return float("inf") if delta != 0 else 0.0
    return abs(delta) / combined


def _metric_verdicts(baseline: dict, run: dict) -> list:
    verdicts = []
    for metric, r in run.items():
        b = baseline.get(metric)
        if not b:
            continue
        bm, bs = b["mean"], b["stderr"]
        rm, rs = r["mean"], r["stderr"]
        if bm == 0:
            rel = float("inf") if rm != 0 else 0.0
        else:
            rel = (rm - bm) / abs(bm)
        z = welch_z(rm - bm, rs, bs)
        flags = []
        if rel > SUSPECT_GAIN or rel < -SUSPECT_DROP:
            flags.append("huge-jump")
        if z >= Z_SUSPECT and abs(rel) > SUSPECT_GAIN:
            flags.append("too-clean")     # enormous gain with tiny noise
        if z < Z_INSIGNIFICANT and abs(rel) > 0.05:
            flags.append("insignificant")  # "win" within seed noise
        verdicts.append({
            "metric": metric, "baseline": bm, "run": rm,
            "relative_change": round(rel, 4), "z": round(min(z, 1e6), 2),
            "flags": flags,
        })
    return verdicts


def sanity_check(baseline: dict, run: dict) -> dict:
    """Deterministic verdict comparing a run against the baseline."""
    b, r = _norm(baseline), _norm(run)
    if not b or not r:
        return {"verdict": "unknown", "reason": "no comparable metrics",
                "metrics": []}
    metrics = _metric_verdicts(b, r)
    if not metrics:
        return {"verdict": "unknown", "reason": "no shared metrics",
                "metrics": []}
    hard = [m for m in metrics if "huge-jump" in m["flags"] or "too-clean" in m["flags"]]
    soft = [m for m in metrics if "insignificant" in m["flags"]]
    if hard:
        return {"verdict": "suspect",
                "reason": "implausible improvement — re-run with more seeds before trusting",
                "metrics": metrics}
    if soft and len(soft) == len(metrics):
        return {"verdict": "insignificant",
                "reason": "all gains are within seed noise",
                "metrics": metrics}
    return {"verdict": "ok", "reason": "within plausible bounds",
            "metrics": metrics}


def write_sanity(folder_name: str, run_num: int, verdict: dict) -> str:
    """Persist the sanity verdict into the run folder and notes.txt."""
    path = osp.join(folder_name, "sanity.json")
    payload = {"run": run_num, "checked_at": datetime.now().isoformat(), **verdict}
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        notes = osp.join(folder_name, "notes.txt")
        with open(notes, "a", encoding="utf-8") as f:
            f.write(f"\n## Sanity check (run {run_num})\n")
            f.write(f"Verdict: {verdict['verdict']} — {verdict['reason']}\n")
            for m in verdict.get("metrics", []):
                f.write(f"- {m['metric']}: {m['baseline']} -> {m['run']} "
                        f"({m['relative_change']:+.1%}, z={m['z']}) {','.join(m['flags']) or 'ok'}\n")
    except Exception:
        pass
    return path


def _sha256(path: str) -> str:
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()[:16]
    except Exception:
        return ""


def write_run_meta(folder_name: str, *, model: str, run_id: str,
                   idea_name: str, seeds: int = 1) -> str:
    """Reproducibility snapshot: everything needed to re-run this folder."""
    meta = {
        "created_at": datetime.now().isoformat(),
        "run_id": run_id,
        "idea": idea_name,
        "model": model,
        "seeds_requested": seeds,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "experiment_sha256_16": _sha256(osp.join(folder_name, "experiment.py")),
        "env": {k: os.environ.get(k, "") for k in (
            "AISC_SEED", "AISC_EXP_SEEDS", "AISC_IDEA_BUDGET_MINUTES",
            "AISC_REVIEW_MIN_SCORE", "AISC_REVIEW_FIX_ITER") if os.environ.get(k)},
    }
    # Package versions via importlib.metadata — works in venvs WITHOUT pip
    # (uv-created envs have no pip module; shelling out silently produced an
    # empty pip_freeze and killed reproducibility snapshots).
    try:
        from importlib.metadata import distributions
        meta["pip_freeze"] = sorted(
            f"{d.metadata['Name']}=={d.version}"
            for d in distributions() if d.metadata and d.metadata["Name"])
    except Exception:
        pass
    path = osp.join(folder_name, "run_meta.json")
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
    except Exception:
        pass
    return path


def append_learning(template: str, idea_name: str, status: str,
                    detail: str = "") -> str:
    """Project knowledge base: what was tried, how it ended.

    Read back by generate_ideas so new ideas stop repeating dead ends.
    """
    path = osp.join("templates", template, "learnings.md")
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    line = f"- {stamp} · **{idea_name}** → {status}"
    if detail:
        line += f": {detail[:300]}"
    try:
        os.makedirs(osp.dirname(path), exist_ok=True)
        if not osp.exists(path):
            with open(path, "w", encoding="utf-8") as f:
                f.write("# Learnings — what was already tried\n\n")
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass
    return path


def load_learnings(template: str) -> str:
    path = osp.join("templates", template, "learnings.md")
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()[:6000]
    except Exception:
        return ""


def idea_budget_deadline() -> float:
    """Wall-clock budget per idea (minutes, 0 = off) → absolute deadline."""
    minutes = float(os.environ.get("AISC_IDEA_BUDGET_MINUTES", "0") or 0)
    return time.time() + minutes * 60 if minutes > 0 else 0.0
