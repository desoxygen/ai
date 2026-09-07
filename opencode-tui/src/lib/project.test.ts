import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AisEvent, AisJob } from "./aiscientist.ts"
import { currentProjectName, defaultProject, fmtElapsed, projectIdeaStatus, projectInfo, workboard } from "./project.ts"

const vault = mkdtempSync(join(tmpdir(), "ais-proj-"))
process.env.OBSIDIAN_VAULT_PATH = vault
process.env.AISC_OBSIDIAN_ROOT = "vaultroot"

afterAll(() => {
  rmSync(vault, { recursive: true, force: true })
  delete process.env.OBSIDIAN_VAULT_PATH
  delete process.env.AISC_OBSIDIAN_ROOT
})

function job(over: Partial<AisJob>): AisJob {
  return { id: 1, run_id: "r1", module: "pipeline/run", template: "tpl", model: "", idea: "", status: "running", started_at: "", finished_at: "", ...over }
}

function ev(over: Partial<AisEvent>): AisEvent {
  return { ts: "2026-09-04T00:00:00+00:00", run_id: "r1", idea_id: "", module: "pipeline/run", stage: "ideas", status: "started", message: "m", job_id: 1, template: "tpl", ...over }
}

test("projectInfo aggregates stages and agents from jobs + events", () => {
  const jobs = [job({ id: 1, status: "running", model: "openrouter/z-ai/glm-5.2", idea: "idea_one" })]
  const events = [
    ev({ stage: "run", status: "started", message: "job 1 started" }),
    ev({ stage: "ideas", status: "started" }),
    ev({ stage: "ideas", status: "done" }),
    ev({ stage: "novelty", status: "started", message: "novelty check for 2 ideas" }),
  ]
  const info = projectInfo("tpl", jobs, () => events)
  expect(info.stages.map((s) => s.status)).toEqual(["done", "running", "pending", "pending", "pending"])
  expect(info.agents.length).toBe(1)
  expect(info.agents[0].model).toBe("z-ai/glm-5.2")
  expect(info.agents[0].stage).toBe("novelty")
  expect(info.running).toBe(1)
  expect(info.lastRunId).toBe("r1")
})

test("stage of a finished job is never shown as running", () => {
  const jobs = [job({ id: 2, status: "aborted", template: "tpl" })]
  const events = [ev({ stage: "experiments", status: "started" })]
  const info = projectInfo("tpl", jobs, () => events)
  const exp = info.stages.find((s) => s.key === "experiments")
  expect(exp?.status).toBe("fail")
  expect(info.stages.find((s) => s.key === "ideas")?.status).toBe("pending")
})

test("jobs from other templates are ignored", () => {
  const jobs = [job({ id: 3, template: "other" })]
  const info = projectInfo("tpl", jobs, () => [])
  expect(info.agents.length).toBe(0)
  expect(info.totalRuns).toBe(0)
  expect(info.stages.every((s) => s.status === "pending")).toBe(true)
})

test("projectIdeaStatus counts vault idea notes by frontmatter status", () => {
  const dir = join(vault, "vaultroot", "Ideas")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "tpl__alpha.md"), '---\ntags:\n  - idea\nstatus: "experiments"\n---\n# Alpha\n', "utf8")
  writeFileSync(join(dir, "tpl__beta.md"), "---\ntags:\n  - idea\nstatus: \"reviewed\"\n---\n# Beta\n", "utf8")
  writeFileSync(join(dir, "tpl__gamma.md"), "# No frontmatter\n", "utf8")
  writeFileSync(join(dir, "other__zeta.md"), '---\nstatus: "done"\n---\n', "utf8")
  const st = projectIdeaStatus("tpl")
  expect(st?.total).toBe(3)
  expect(st?.byStatus).toEqual({ experiments: 1, reviewed: 1, new: 1 })
  expect(projectIdeaStatus("nothing_here")).toBe(null)
})

test("defaultProject only attaches to a job with a live pid; never auto-picks templates", () => {
  const jobs = [job({ id: 1, template: "a", status: "done" }), job({ id: 2, template: "b", status: "running", pid: 0 })]
  expect(defaultProject(jobs, ["a", "b", "c"])).toBe("")
  expect(defaultProject([job({ id: 1, template: "a", status: "done" })], ["a", "c"])).toBe("")
  expect(defaultProject([], ["x", "y"])).toBe("")
  expect(defaultProject([], [])).toBe("")
})

test("currentProjectName returns nothing without an explicit choice or a live run", () => {
  expect(currentProjectName(["a", "b"], [job({ template: "a", status: "done" })])).toBe("")
})

test("fmtElapsed", () => {
  expect(fmtElapsed(9_500)).toBe("9s")
  expect(fmtElapsed(75_000)).toBe("1m15s")
  expect(fmtElapsed(3_720_000)).toBe("1h02m")
})

test("workboard splits stages into done/doing/planned", () => {
  const jobs = [job({ id: 1, template: "tpl", status: "running" })]
  const events = [
    ev({ stage: "ideas", status: "started" }),
    ev({ stage: "ideas", status: "done" }),
    ev({ stage: "novelty", status: "started" }),
  ]
  const info = projectInfo("tpl", jobs, () => events)
  const wb = workboard(info, [])
  expect(wb.done.some((l) => l.includes("✓ ideas"))).toBe(true)
  expect(wb.doing.some((l) => l.includes("▶ novelty"))).toBe(true)
  expect(wb.doing.some((l) => l.includes("run #1"))).toBe(true)
  expect(wb.planned.some((l) => l.includes("writeup"))).toBe(true)
  expect(wb.planned.some((l) => l.includes("review"))).toBe(true)
})
