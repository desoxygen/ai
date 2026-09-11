"""Contract check for the CI/offline canary.

Validates that <run_dir>/final_info.json matches the flat shape the pipeline
parses: {metric: {"means": float, "stderrs": float}}.
Usage: python check_run.py run_ci
"""
import json
import sys

run_dir = sys.argv[1] if len(sys.argv) > 1 else "run_ci"
with open(f"{run_dir}/final_info.json", encoding="utf-8") as f:
    data = json.load(f)
assert data, "final_info.json is empty"
baseline = {k: v["means"] for k, v in data.items()}  # pipeline.py parses exactly this way
assert all(isinstance(v, float) for v in baseline.values()), baseline
print("final_info.json OK:", json.dumps(baseline))
