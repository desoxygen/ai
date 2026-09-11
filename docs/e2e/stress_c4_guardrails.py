"""Stress C4: guardrails under real multi-process abuse.

A) 8 simultaneous failing `paper` spawns -> unique ids, clean events, no
   journal corruption (the F1 race under production spawn pattern).
B) a live LLM-retrying job is KILLED mid-run -> its journal record must be
   recognized as a zombie (dead pid) and reaped by purge.
C) the duplicate-run guard refuses a second runner for the same module+template.

No real API credits: an invalid key produces fast 401 retries.

Usage: python docs/e2e/stress_c4_guardrails.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY = sys.executable


def spawn(args, env):
    return subprocess.Popen([PY, "-X", "utf8", "-m", "ai_scientist.console.cli",
                             "-q", "--lang", "en", *args],
                            cwd=str(ROOT), env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)


def fold(jobs_file):
    rows = [json.loads(l) for l in jobs_file.read_text(encoding="utf-8").splitlines() if l.strip()]
    latest = {}
    for r in rows:
        latest[r["id"]] = r
    return [r for r in latest.values() if not r.get("deleted")], rows


def main():
    tmp = tempfile.mkdtemp(prefix="aisc_stress_c4_")
    env = dict(os.environ, AISC_RESULTS_DIR=tmp, OBSIDIAN_VAULT_PATH=str(Path(tmp) / "vault"),
               AISC_INTERACTIVE="no", AISC_HEADLESS_ON_LIMIT="skip",
               OPENROUTER_API_KEY="sk-or-invalid-for-stress", AISC_LLM_MAX_TRIES="2",
               AISC_DEFAULT_MODEL="openrouter/test/model:free")
    jobs_file = Path(tmp) / "jobs.jsonl"
    fails = []

    # --- A: 8 simultaneous failing paper spawns -----------------------------
    dup_hits = [0]
    tpl = ROOT / "templates" / "stress_c4_paper"
    tpl.mkdir(parents=True, exist_ok=True)
    (tpl / "README.md").write_text("stress fixture: template with no runs\n", encoding="utf-8")
    procs = [spawn(["paper", "--template", "stress_c4_paper"], env) for _ in range(8)]
    for p in procs:
        p.wait()
    shutil.rmtree(tpl, ignore_errors=True)
    live, rows = fold(jobs_file)
    ids = [r["id"] for r in live]
    if len(ids) != 8 or len(set(ids)) != 8:
        fails.append(f"A: ids not unique/complete: {sorted(ids)}")
    if any(r["status"] != "failed" for r in live):
        fails.append("A: some paper jobs did not end 'failed'")
    for jid in ids:
        ev = Path(tmp) / "events" / f"{jid}.jsonl"
        if not ev.exists():
            fails.append(f"A: job {jid} has no events file")
            continue
        events = [json.loads(l) for l in ev.read_text(encoding="utf-8").splitlines() if l.strip()]
        runs = {e.get("run_id") for e in events}
        if len(runs) != 1:
            fails.append(f"A: job {jid} events mix {len(runs)} run_ids (race!)")
        msgs = " ".join(e["message"] for e in events)
        # first spawn hits the missing-run-folder error; the rest are refused
        # by the duplicate guard — both are legible outcomes
        if "notes.txt" not in msgs and "duplicate" not in msgs:
            fails.append(f"A: job {jid} lost the legible reason: {msgs[:100]}")
        elif "duplicate" in msgs:
            dup_hits[0] += 1
    print(f"A) 8 simultaneous paper fails: records={len(ids)} unique={len(set(ids))} "
          f"dup-guard blocked {dup_hits[0]}/7 -> {'ok' if not fails else 'FAIL'}")

    # --- B: kill a live job mid-run, expect zombie reaping -------------------
    b_start = len(fails)
    p = spawn(["run", "--template", "playground", "--stages", "ideas", "--num-ideas", "1"], env)
    deadline = time.time() + 30
    running_rec = None
    while time.time() < deadline and running_rec is None:
        time.sleep(0.4)
        live2, _ = fold(jobs_file)
        for r in live2:
            if r["id"] > max(ids) and r["status"] == "running" and r.get("pid"):
                running_rec = r
                break
    if running_rec is None:
        fails.append("B: job never reached 'running' to be killed")
        p.kill()
    else:
        zpid = running_rec["pid"]
        subprocess.run(["taskkill", "/pid", str(zpid), "/T", "/F"], capture_output=True)
        p.wait()
        time.sleep(1.0)
        live3, _ = fold(jobs_file)
        zrec = [r for r in live3 if r["id"] == running_rec["id"]]
        if not zrec:
            fails.append("B: zombie record vanished without being closed")
        else:
            from ai_scientist import settings
            settings.RESULTS_DIR = Path(tmp)
            from ai_scientist.console.jobs import _pid_alive, JobRegistry
            if _pid_alive(zrec[0]["pid"]):
                fails.append("B: killed pid still considered alive")
            removed = JobRegistry().purge(template="playground")  # scope: no collateral
            if running_rec["id"] not in removed:
                fails.append(f"B: purge did not reap zombie {running_rec['id']}")
            live4, _ = fold(jobs_file)
            if any(r["id"] == running_rec["id"] for r in live4):
                fails.append("B: zombie still in journal after purge")
            if len(live4) != len(live3) - 1:
                fails.append("B: purge collateral damage")
        print(f"B) kill live job #{running_rec['id']} (pid {zpid}) -> "
              f"{'reaped' if len(fails) == b_start else 'FAIL'}")

    # --- C: duplicate guard (unit-level via python, deterministic) ----------
    sys.path.insert(0, str(ROOT))
    from ai_scientist import settings
    settings.RESULTS_DIR = Path(tmp) / "c"
    (Path(tmp) / "c").mkdir(exist_ok=True)
    from ai_scientist.console import runner
    from ai_scientist.console.jobs import JobRegistry

    reg = JobRegistry()
    live_job = reg.create(module="pipeline/run", template="dupx")
    reg.update(live_job, status="running", pid=os.getpid())

    class Mod:
        name = "pipeline/run"

        @staticmethod
        def run(options, job, emit, stop_event=None):
            return {"ok": True}

    code = runner.execute_job(Mod(), {"TEMPLATE": "dupx"}, reg, printer=None)
    if code != 1:
        fails.append(f"C: duplicate execute_job returned {code}, expected 1")
    else:
        cjobs, _ = fold(Path(tmp) / "c" / "jobs.jsonl")
        blocked = [j for j in cjobs if j["id"] != live_job.id][0]
        if blocked["status"] != "failed":
            fails.append("C: duplicate job not marked failed")
        print("C) duplicate run refused: ok")

    print("C4 RESULT:", "FAIL\n - " + "\n - ".join(fails) if fails else "PASS")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
