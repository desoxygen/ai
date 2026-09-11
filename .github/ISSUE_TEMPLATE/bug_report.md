---
name: Bug report
about: Something crashes, hangs or misbehaves
title: "[bug] "
labels: bug
---

## What happened

## Steps to reproduce

## /doctor output

Paste the full `environment:` block from the TUI `/doctor` (keys are masked —
this is safe to share).

## Job digest

Run `/report <jobId>` in the TUI (or `aiscientist -q logs -j <id>` on the
headless runner) and paste it. Redact anything sensitive.

## Environment

- OS: (Windows / Linux / WSL / Docker)
- Python: (`python --version`)
- Bun: (`bun --version`)
- Commit/tag: (`git rev-parse --short HEAD` or release tag)

## Dashboard log tail

The last ~40 lines from the Dashboard (or `results/events/<job_id>.jsonl`).
