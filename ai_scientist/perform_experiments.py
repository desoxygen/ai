import json
import os
import os.path as osp
import shutil
import subprocess
import sys
import time
from subprocess import TimeoutExpired

from ai_scientist.loop_guard import StageGuard
from ai_scientist.research_quality import sanity_check, write_sanity

MAX_ITERS = 4
MAX_RUNS = 5
MAX_STDERR_OUTPUT = 1500

coder_prompt = """Your goal is to implement the following idea: {title}.
The proposed experiment is as follows: {idea}.
You are given a total of up to {max_runs} runs to complete the necessary experiments. You do not need to use all {max_runs}.

First, plan the list of experiments you would like to run. For example, if you are sweeping over a specific hyperparameter, plan each value you would like to test for each run.

Note that we already provide the vanilla baseline results, so you do not need to re-run it.

For reference, the baseline results are as follows:

{baseline_results}

After you complete each change, we will run the command `python experiment.py --out_dir=run_i' where i is the run number and evaluate the results.
YOUR PROPOSED CHANGE MUST USE THIS COMMAND FORMAT, DO NOT ADD ADDITIONAL COMMAND LINE ARGS.
You can then implement the next thing on your list."""


def _num_seeds() -> int:
    """How many seeds to run per experiment (AISC_EXP_SEEDS, default 1)."""
    try:
        return max(1, int(os.environ.get("AISC_EXP_SEEDS", "1")))
    except ValueError:
        return 1


def _aggregate_seeds(run_dir: str, dataset_results: list) -> dict:
    """Merge per-seed final_info dicts into one with means/stderrs."""
    if not dataset_results:
        return {}
    merged = {}
    for key in dataset_results[0]:
        vals, stderrs = [], []
        for res in dataset_results:
            entry = res.get(key)
            if isinstance(entry, dict):
                if "means" in entry:
                    vals.append(entry["means"])
                    stderrs.append(entry.get("stderrs", 0.0) or 0.0)
                else:
                    vals.append(entry)
            elif isinstance(entry, (int, float)):
                vals.append(entry)
        if not vals:
            continue
        n = len(vals)
        mean = sum(vals) / n
        var = sum((v - mean) ** 2 for v in vals) / max(1, n - 1) if n > 1 else 0.0
        stderr = (var / n) ** 0.5 if n > 1 else (sum(stderrs) / len(stderrs) if stderrs else 0.0)
        merged[key] = {"means": mean, "stderrs": stderr}
    return merged


# RUN EXPERIMENT
def run_experiment(folder_name, run_num, timeout=7200, deadline=0.0):
    cwd = osp.abspath(folder_name)
    # COPY CODE SO WE CAN SEE IT.
    shutil.copy(
        osp.join(folder_name, "experiment.py"),
        osp.join(folder_name, f"run_{run_num}.py"),
    )

    seeds = _num_seeds()
    per_seed_results = []

    for seed in range(seeds):
        if deadline and time.time() > deadline:
            print(f"Run {run_num}: idea budget exhausted before seed {seed}")
            break
        # LAUNCH COMMAND — always the pipeline's own interpreter: a bare
        # "python" resolves through PATH and may be a different install
        # without the experiment's dependencies
        env = dict(os.environ, AISC_SEED=str(seed))
        command = [
            sys.executable,
            "experiment.py",
            f"--out_dir=run_{run_num}",
        ]
        try:
            result = subprocess.run(
                command, cwd=cwd, stderr=subprocess.PIPE, text=True,
                timeout=timeout, env=env,
            )

            if result.stderr:
                print(result.stderr, file=sys.stderr)

            if result.returncode != 0:
                print(f"Run {run_num} failed with return code {result.returncode}")
                if osp.exists(osp.join(cwd, f"run_{run_num}")):
                    shutil.rmtree(osp.join(cwd, f"run_{run_num}"))
                print(f"Run failed with the following error {result.stderr}")
                stderr_output = result.stderr
                if len(stderr_output) > MAX_STDERR_OUTPUT:
                    stderr_output = "..." + stderr_output[-MAX_STDERR_OUTPUT:]
                next_prompt = f"Run failed with the following error {stderr_output}"
                return result.returncode, next_prompt

            with open(osp.join(cwd, f"run_{run_num}", "final_info.json"), "r", encoding="utf-8") as f:
                per_seed_results.append(json.load(f))
        except TimeoutExpired:
            print(f"Run {run_num} timed out after {timeout} seconds")
            if osp.exists(osp.join(cwd, f"run_{run_num}")):
                shutil.rmtree(osp.join(cwd, f"run_{run_num}"))
            next_prompt = f"Run timed out after {timeout} seconds"
            return 1, next_prompt

    if seeds > 1 and per_seed_results:
        # single aggregated final_info.json with means/stderrs across seeds
        merged = _aggregate_seeds(osp.join(cwd, f"run_{run_num}"), per_seed_results)
        if merged:
            with open(osp.join(cwd, f"run_{run_num}", "final_info.json"), "w") as f:
                json.dump(merged, f, indent=4)

    with open(osp.join(cwd, f"run_{run_num}", "final_info.json"), "r", encoding="utf-8") as f:
        results = json.load(f)
    results = {k: v["means"] for k, v in results.items()}

    next_prompt = f"""Run {run_num} completed. Here are the results:
{results}

Decide if you need to re-plan your experiments given the result (you often will not need to).

Someone else will be using `notes.txt` to perform a writeup on this in the future.
Please include *all* relevant information for the writeup on Run {run_num}, including an experiment description and the run number. Be as verbose as necessary.

Then, implement the next thing on your list.
We will then run the command `python experiment.py --out_dir=run_{run_num + 1}'.
YOUR PROPOSED CHANGE MUST USE THIS COMMAND FORMAT, DO NOT ADD ADDITIONAL COMMAND LINE ARGS.
If you are finished with experiments, respond with 'ALL_COMPLETED'."""
    return 0, next_prompt


# RUN PLOTTING
def run_plotting(folder_name, timeout=600):
    cwd = osp.abspath(folder_name)
    # LAUNCH COMMAND — same rule as run_experiment: always the pipeline's own
    # interpreter, a bare "python" may be a different install without
    # matplotlib/numpy on PATH (classic Windows venv breakage).
    command = [
        sys.executable,
        "plot.py",
    ]
    try:
        result = subprocess.run(
            command, cwd=cwd, stderr=subprocess.PIPE, text=True, timeout=timeout
        )

        if result.stderr:
            print(result.stderr, file=sys.stderr)

        if result.returncode != 0:
            print(f"Plotting failed with return code {result.returncode}")
            next_prompt = f"Plotting failed with the following error {result.stderr}"
        else:
            next_prompt = ""
        return result.returncode, next_prompt
    except TimeoutExpired:
        print(f"Plotting timed out after {timeout} seconds")
        next_prompt = f"Plotting timed out after {timeout} seconds"
        return 1, next_prompt


# PERFORM EXPERIMENTS
def perform_experiments(idea, folder_name, coder, baseline_results, deadline=0.0) -> bool:
    ## RUN EXPERIMENT
    guard = StageGuard(f"experiments:{idea.get('Name', '?')}")
    current_iter = 0
    run = 1
    sanity_note = ""
    next_prompt = coder_prompt.format(
        title=idea["Title"],
        idea=idea["Experiment"],
        max_runs=MAX_RUNS,
        baseline_results=baseline_results,
    )
    while run < MAX_RUNS + 1:
        if current_iter >= MAX_ITERS:
            print("Max iterations reached")
            break
        if deadline and time.time() > deadline:
            print("Idea wall-clock budget exhausted — stopping experiments")
            next_prompt = "Idea budget exhausted"
            current_iter = MAX_ITERS
            break
        coder_out = coder.run(next_prompt)
        print(coder_out)
        if "ALL_COMPLETED" in coder_out:
            break
        return_code, next_prompt = run_experiment(folder_name, run, deadline=deadline)
        if return_code == 0:
            # Sanity gate: deterministic comparison vs baseline. A suspect
            # verdict is fed back so the coder can double-check, and stored
            # for the writeup.
            try:
                with open(osp.join(folder_name, f"run_{run}", "final_info.json"), encoding="utf-8") as f:
                    run_info = json.load(f)
                verdict = sanity_check(baseline_results, run_info)
                write_sanity(folder_name, run, verdict)
                sanity_note = f"{verdict['verdict']}: {verdict['reason']}"
                print(f"Sanity check run {run}: {sanity_note}")
                if verdict["verdict"] == "suspect":
                    next_prompt = (
                        f"SANITY WARNING: the results of run {run} look implausible "
                        f"({verdict['reason']}). Before continuing, re-check the "
                        f"implementation for bugs (leakage, evaluation on training data, "
                        f"metric sign errors). If the result is real, justify it in notes.txt."
                    )
            except Exception as e:
                print(f"Sanity check skipped: {e}")
            run += 1
            current_iter = 0
            guard.success()
        else:
            current_iter += 1
            # Loop protection: the same error repeating means the coder is
            # going in circles — the guard will ask the user. The key must be
            # run-number-INDEPENDENT, otherwise the signature resets on every
            # new run and the identical error can never escalate.
            guard.check_repeat("run-error", next_prompt[:200])
    if current_iter >= MAX_ITERS:
        print("Not all experiments completed.")
        return False

    current_iter = 0
    next_prompt = """
Great job! Please modify `plot.py` to generate the most relevant plots for the final writeup. 

In particular, be sure to fill in the "labels" dictionary with the correct names for each run that you want to plot.

Only the runs in the `labels` dictionary will be plotted, so make sure to include all relevant runs.

We will be running the command `python plot.py` to generate the plots.
"""
    while True:
        _ = coder.run(next_prompt)
        return_code, next_prompt = run_plotting(folder_name)
        current_iter += 1
        if return_code == 0 or current_iter >= MAX_ITERS:
            break
    next_prompt = """
Please modify `notes.txt` with a description of what each plot shows along with the filename of the figure. Please do so in-depth.

Somebody else will be using `notes.txt` to write a report on this in the future.
"""
    coder.run(next_prompt)

    return True
