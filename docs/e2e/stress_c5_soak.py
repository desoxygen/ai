"""Stress C5: soak — repeated real runs + journal endurance.

A) 20 sequential playground baseline experiments in a sandbox copy:
   determinism (identical final_info across repeats), plot over 20 runs.
B) 15 rapid headless jobs against the same journal: id monotonicity,
   fold consistency, one events file per id, no zombie left, no mixing.

Usage: python docs/e2e/stress_c5_soak.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY = sys.executable
N_EXP = 20
N_JOBS = 15
fails = []


def main():
    tmp = Path(tempfile.mkdtemp(prefix="aisc_stress_c5_"))
    sandbox = tmp / "playground"
    shutil.copytree(ROOT / "templates" / "playground", sandbox)

    # --- A: 20 repeated baselines -------------------------------------------
    infos = []
    for i in range(N_EXP):
        r = subprocess.run([PY, "-X", "utf8", "experiment.py", "--out_dir", f"run_{i}"],
                           cwd=str(sandbox), capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=120)
        if r.returncode != 0:
            fails.append(f"A: experiment run_{i} exit={r.returncode}: {r.stderr[-200:]}")
            continue
        infos.append(json.loads((sandbox / f"run_{i}" / "final_info.json").read_text(encoding="utf-8")))
    if len(infos) == N_EXP:
        first = json.dumps({k: v["means"] for k, v in infos[0].items() if k != "total_train_time"},
                           sort_keys=True)
        drift = [i for i, x in enumerate(infos)
                 if json.dumps({k: v["means"] for k, v in x.items() if k != "total_train_time"},
                               sort_keys=True) != first]
        if drift:
            fails.append(f"A: non-deterministic runs: {drift}")
    r = subprocess.run([PY, "-X", "utf8", "plot.py"], cwd=str(sandbox),
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
    figs = list((sandbox / "figs").glob("*.png")) if (sandbox / "figs").exists() else []
    if r.returncode != 0 or not figs:
        fails.append(f"A: plot over {N_EXP} runs failed: rc={r.returncode} figs={len(figs)}")
    print(f"A) {len(infos)}/{N_EXP} baselines, deterministic={not any('non-determin' in f for f in fails)}, "
          f"figs={len(figs)} -> {'ok' if not fails else 'FAIL'}")

    # --- B: 15 rapid headless jobs ------------------------------------------
    env = dict(os.environ, AISC_RESULTS_DIR=str(tmp / "results"),
               OBSIDIAN_VAULT_PATH=str(tmp / "vault"),
               AISC_INTERACTIVE="no", AISC_HEADLESS_ON_LIMIT="skip")
    tpl = ROOT / "templates" / "stress_c5_paper"
    tpl.mkdir(parents=True, exist_ok=True)
    (tpl / "README.md").write_text("soak fixture\n", encoding="utf-8")
    procs = []
    try:
        for _ in range(N_JOBS):
            procs.append(subprocess.Popen(
                [PY, "-X", "utf8", "-m", "ai_scientist.console.cli", "-q", "--lang", "en",
                 "paper", "--template", "stress_c5_paper"],
                cwd=str(ROOT), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT))
            if len(procs) >= 4:  # batch so the dup guard has something to reject
                for p in procs:
                    p.wait()
                procs = []
        for p in procs:
            p.wait()
    finally:
        shutil.rmtree(tpl, ignore_errors=True)
    jobs_file = tmp / "results" / "jobs.jsonl"
    rows = [json.loads(l) for l in jobs_file.read_text(encoding="utf-8").splitlines() if l.strip()]
    latest = {}
    for r_ in rows:
        latest[r_["id"]] = r_
    ids = sorted(latest)
    if ids != list(range(1, len(ids) + 1)):
        fails.append(f"B: ids not monotonic 1..N: {ids}")
    live = [j for j in latest.values() if not j.get("deleted")]
    if len(live) != N_JOBS:
        fails.append(f"B: expected {N_JOBS} job records, got {len(live)}")
    for j in live:
        ev_path = tmp / "results" / "events" / f"{j['id']}.jsonl"
        if not ev_path.exists():
            fails.append(f"B: job {j['id']} lost its events file")
            continue
        evs = [json.loads(l) for l in ev_path.read_text(encoding="utf-8").splitlines() if l.strip()]
        if len({e.get("run_id") for e in evs}) > 1:
            fails.append(f"B: job {j['id']} events mix run_ids")
        if j["status"] == "running":
            fails.append(f"B: zombie survived soak: job {j['id']}")
    print(f"B) {N_JOBS} rapid jobs: ids=1..{max(ids) if ids else 0}, "
          f"records={len(live)}, events intact -> {'ok' if not fails else 'FAIL'}")

    print("C5 RESULT:", "FAIL\n - " + "\n - ".join(fails) if fails else "PASS")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
