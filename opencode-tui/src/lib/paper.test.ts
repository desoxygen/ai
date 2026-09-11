import { expect, test } from "bun:test"
import { latestPaperJob, paperProgress, paperSectionStates } from "./paper.ts"
import type { AisEvent } from "./aiscientist.ts"

const ev = (o: Partial<AisEvent>): AisEvent => ({
  ts: "2026-09-10T20:00:00", run_id: "r", idea_id: "i1", module: "writeup/paper",
  stage: "writeup", status: "log", message: "", ...o,
})

test("paperSectionStates: phases advance, order is canonical", () => {
  const rows = paperSectionStates([
    ev({ detail: { section: "Title & Abstract", phase: "draft" } }),
    ev({ detail: { section: "Abstract", phase: "refine" } }),
    ev({ detail: { section: "Introduction", phase: "draft" } }),
    ev({ stage: "writeup", status: "done", detail: {} }),
  ])
  const get = (s: string) => rows.find((r) => r.section === s)
  expect(get("Title & Abstract")?.phase).toBe("done")
  expect(get("Introduction")?.phase).toBe("done")
  expect(get("Results")?.phase).toBe("pending")
  expect(rows[0].section).toBe("Title & Abstract")
})

test("paperSectionStates: fail marks unfinished sections", () => {
  const rows = paperSectionStates([
    ev({ detail: { section: "Method", phase: "refine" } }),
    ev({ status: "fail", message: "guard skip" }),
  ])
  expect(rows.find((r) => r.section === "Method")?.phase).toBe("failed")
  expect(rows.find((r) => r.section === "Results")?.phase).toBe("pending")
})

test("paperProgress: folder, stages, score and improve before/after", () => {
  const p = paperProgress([
    ev({ stage: "system", message: "resume folder: results/x/1_i", detail: { folder: "results/x/1_i" } }),
    ev({ stage: "writeup", status: "started" }),
    ev({ stage: "writeup", status: "done" }),
    ev({ stage: "review", status: "done", message: "review saved (score=5.5)" }),
    ev({ stage: "improve", status: "done", detail: { before: 5.5, after: 7 } }),
  ])
  expect(p.folder).toBe("results/x/1_i")
  expect(p.writeup).toBe("done")
  expect(p.review).toBe("done")
  expect(p.score).toBe(5.5)
  expect(p.beforeAfter).toBe("5.5/10 -> 7/10")
})

test("latestPaperJob: prefers writeup/paper module", () => {
  const jobs = [
    { id: 1, module: "pipeline/run", status: "done" },
    { id: 2, module: "writeup/paper", status: "running" },
    { id: 3, module: "pipeline/run", status: "done" },
  ]
  expect(latestPaperJob(jobs)?.id).toBe(2)
  expect(latestPaperJob([{ id: 9, module: "x", status: "y" }])?.id).toBe(9)
  expect(latestPaperJob([])).toBeUndefined()
})
