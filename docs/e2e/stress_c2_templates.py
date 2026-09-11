"""Stress C2: template contract failures must be clean and legible.

Creates throwaway templates under templates/stress_c2_*, drives them through
the headless runner (no live LLM calls needed - every case must fail BEFORE
any network stage succeeds) and asserts: exit!=0, job status=failed, a
human-readable fail event with no bare traceback, and no journal corruption.

Usage: python docs/e2e/stress_c2_templates.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TMP = tempfile.mkdtemp(prefix="aisc_stress_c2_")
PREFIX = "stress_c2_"

CASES = {
    "nobase": {  # prompt+ideas present, but no run_0 baseline:
        # BY DESIGN the guard policy skips the idea and the job completes
        # (exit 0) - the contract under test is the visible "baseline" reason.
        "files": {
            "prompt.json": {"system": "s", "task_description": "d"},
            "seed_ideas.json": [{"Name": "i", "Title": "t", "Experiment": "e",
                                 "Interestingness": 5, "Feasibility": 5, "Novelty": 5}],
            "ideas.json": [{"Name": "i", "Title": "t", "Experiment": "e", "status": "todo"}],
            "experiment.py": "raise SystemExit(0)\n",
            "plot.py": "print('x')\n",
        },
        "cmd": ["run", "--template", "{t}", "--stages", "experiments"],
        "expect": "baseline",
        "expect_status": "done",
    },
    "empty": {  # bare directory: ideas stage has nothing to read
        "files": {},
        "cmd": ["run", "--template", "{t}", "--stages", "ideas"],
        "expect": "seed_ideas",
    },
    "noprompt": {  # everything else in place, prompt.json missing
        "files": {
            "seed_ideas.json": [{"Name": "i", "Title": "t", "Experiment": "e",
                                 "Interestingness": 5, "Feasibility": 5, "Novelty": 5}],
            "experiment.py": "raise SystemExit(0)\n",
        },
        "cmd": ["run", "--template", "{t}", "--stages", "ideas"],
        "expect": "prompt",
    },
    "paper_noruns": {  # /paper on a template that never completed experiments
        "files": {
            "prompt.json": {"system": "s", "task_description": "d"},
            "experiment.py": "raise SystemExit(0)\n",
        },
        "cmd": ["paper", "--template", "{t}"],
        "expect": "notes.txt",
    },
    "brokenjson": {  # valid seeds, unparseable prompt.json
        "files": {
            "prompt.json": "{not json!!",
            "seed_ideas.json": [{"Name": "i", "Title": "t", "Experiment": "e",
                                 "Interestingness": 5, "Feasibility": 5, "Novelty": 5}],
            "experiment.py": "raise SystemExit(0)\n",
        },
        "cmd": ["run", "--template", "{t}", "--stages", "ideas"],
        "expect": "prompt",
    },
}


def main():
    env = dict(os.environ, AISC_RESULTS_DIR=TMP, OBSIDIAN_VAULT_PATH=str(Path(TMP) / "vault"),
               AISC_INTERACTIVE="no", AISC_HEADLESS_ON_LIMIT="skip")
    jobs_file = Path(TMP) / "jobs.jsonl"
    results = []
    try:
        for name, case in CASES.items():
            tname = PREFIX + name
            tdir = ROOT / "templates" / tname
            tdir.mkdir(parents=True, exist_ok=True)
            for fname, content in case["files"].items():
                p = tdir / fname
                if isinstance(content, dict) and fname.endswith(".json"):
                    p.write_text(json.dumps(content), encoding="utf-8")
                elif isinstance(content, list):
                    p.write_text(json.dumps(content), encoding="utf-8")
                else:
                    p.write_text(str(content), encoding="utf-8")
            cmd = [sys.executable, "-X", "utf8", "-m", "ai_scientist.console.cli",
                   "-q", "--lang", "en"] + [a.replace("{t}", tname) for a in case["cmd"]]
            proc = subprocess.run(cmd, cwd=str(ROOT), env=env, capture_output=True,
                                  text=True, encoding="utf-8", errors="replace", timeout=180)
            rows = [json.loads(l) for l in jobs_file.read_text(encoding="utf-8").splitlines() if l.strip()]
            # append-only: the last line is the final record of the last job
            latest = rows[-1]
            events = [json.loads(l) for l in
                      (Path(TMP) / "events" / f"{latest['id']}.jsonl").read_text(encoding="utf-8").splitlines()
                      if l.strip()]
            fails = [e for e in events if e["status"] == "fail"]
            want_status = case.get("expect_status", "failed")
            pool = " ".join(e["message"] for e in events).lower()
            readable = all("Traceback" not in e["message"] and "[Errno" not in e["message"]
                           for e in events)
            if want_status == "failed":
                msg = fails[-1]["message"] if fails else ""
                ok = (proc.returncode != 0 and latest["status"] == "failed" and msg
                      and case["expect"] in msg.lower() and readable)
            else:
                ok = (proc.returncode == 0 and latest["status"] == want_status
                      and case["expect"] in pool and readable)
            results.append((tname, ok, proc.returncode, latest["status"],
                            (fails[-1]["message"] if fails else
                             next((e["message"] for e in reversed(events)
                                   if case["expect"] in e["message"].lower()), ""))[:120]))
    finally:
        for name in CASES:
            shutil.rmtree(ROOT / "templates" / (PREFIX + name), ignore_errors=True)
    failed = [r for r in results if not r[1]]
    for name, ok, rc, status, msg in results:
        print(f"{'PASS' if ok else 'FAIL'} {name:<18} exit={rc} job={status:<8} msg={msg!r}")
    # journal integrity after a storm of failures
    rows = [json.loads(l) for l in jobs_file.read_text(encoding="utf-8").splitlines() if l.strip()]
    seen = {}
    for r in rows:
        seen[r["id"]] = r
    ids = sorted(seen)
    assert len(ids) == len(set(ids)) == len(CASES), f"expected {len(CASES)} jobs, got {ids}"
    print(f"journal: {len(ids)} records, ids={ids}, C2 RESULT:", "FAIL" if failed else "PASS")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
