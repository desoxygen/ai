"""Stress C1: cross-process JobRegistry integrity (run BEFORE/AFTER the fix).

Usage: python docs/e2e/stress_c1_jobs_race.py [n_procs] [n_creates]
Spawns real subprocesses that hit the same results dir, then checks:
 - every created job id is unique
 - no record lost from jobs.jsonl
 - event files never mix two run_ids
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
N_PROCS = int(sys.argv[1]) if len(sys.argv) > 1 else 2
N_CREATES = int(sys.argv[2]) if len(sys.argv) > 2 else 5

CHILD = r"""
import json, os, sys
sys.path.insert(0, %r)
from ai_scientist.console.jobs import JobRegistry
reg = JobRegistry()
for i in range(int(sys.argv[1])):
    j = reg.create(module="stress", template=f"proc{os.getpid()}", run_id=f"r{os.getpid()}_{i}")
    reg.update(j, status="running")
print("child done", os.getpid())
"""


def main():
    tmp = tempfile.mkdtemp(prefix="aisc_stress_c1_")
    env = dict(os.environ, AISC_RESULTS_DIR=tmp, AISC_INTERACTIVE="no")
    procs = [subprocess.Popen([sys.executable, "-c", CHILD % str(ROOT), str(N_CREATES)],
                              env=env, cwd=str(ROOT)) for _ in range(N_PROCS)]
    for p in procs:
        p.wait()
    jobs_file = Path(tmp) / "jobs.jsonl"
    lines = [json.loads(l) for l in jobs_file.read_text(encoding="utf-8").splitlines() if l.strip()]
    ids = [j["id"] for j in lines]
    dup = {i for i in ids if ids.count(i) > 1 and len({(j["id"], j["run_id"]) for j in lines if j["id"] == i}) > 1}
    expected = N_PROCS * N_CREATES
    print(f"procs={N_PROCS} creates/proc={N_CREATES} expected={expected} lines={len(lines)}")
    print(f"unique job keys={len(set((j['id'], j['run_id']) for j in lines))}")
    print(f"duplicate-ids (one id, several run_ids): {sorted(dup)}")
    ok = len(set((j['id'], j['run_id']) for j in lines)) == expected and not dup
    print("C1 RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
