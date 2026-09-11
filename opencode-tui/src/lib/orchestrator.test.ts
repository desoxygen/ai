import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { AisEvent, AisJob } from "./aiscientist.ts"
import { createOrchestrator } from "./orchestrator.ts"

let t = 0
const clock = () => t

function makeJob(over: Partial<AisJob> = {}): AisJob {
  return { id: 5, run_id: "r", module: "pipeline/run", template: "tpl", model: "", idea: "one", status: "running", started_at: new Date(t).toISOString(), finished_at: "", pid: 4242, ...over }
}

function makeEvents(): AisEvent[] {
  return [
    { ts: "", run_id: "r", idea_id: "", module: "m", stage: "ideas", status: "done", message: "gen" },
    { ts: "", run_id: "r", idea_id: "", module: "m", stage: "novelty", status: "started", message: "checking" },
  ]
}

test("sync binds a running job to a worker and mirrors stage", () => {
  t = 1000
  const o = createOrchestrator({ now: clock })
  o.sync(null, [makeJob()], makeEvents)
  const st = o.state(null)
  expect(st.workers.length).toBe(1)
  const w = st.workers[0]
  expect(w.kind).toBe("job")
  expect(w.name).toBe("novelty_checker")
  expect(w.status).toBe("running")
  expect(w.progress).toBeCloseTo(0.2)
})

test("job completion flips the worker to done; failure to failed", () => {
  t = 1000
  const o = createOrchestrator({ now: clock })
  const job = makeJob()
  o.sync(null, [job], makeEvents)
  job.status = "failed"
  job.finished_at = new Date(t).toISOString()
  o.sync(null, [job], makeEvents)
  expect(o.state(null).workers[0].status).toBe("failed")

  const o2 = createOrchestrator({ now: clock })
  const job2 = makeJob({ id: 6 })
  o2.sync(null, [job2], makeEvents)
  job2.status = "done"
  job2.finished_at = new Date(t).toISOString()
  o2.sync(null, [job2], makeEvents)
  const w = o2.state(null).workers.find((x) => x.jobId === 6)
  expect(w?.status).toBe("done")
  expect(w?.progress).toBe(1)
})

test("beginTask creates a real running worker with indeterminate progress; finishTask closes it", () => {
  t = 0
  const o = createOrchestrator({ now: clock })
  const wid = o.beginTask("write the related-work section")
  const st = o.state(null)
  const w = st.workers.find((x) => x.id === wid)
  expect(w?.status).toBe("running")
  expect(w?.kind).toBe("delegate")
  expect(w?.progress).toBe(-1)
  expect(st.main.status).toBe("delegating")

  o.appendTaskLog(wid, "line one\nline two")
  expect(o.state(null).workers.find((x) => x.id === wid)?.log.map((l) => l.text)).toContain("line one")

  o.finishTask(wid, "done")
  const done = o.state(null).workers.find((x) => x.id === wid)
  expect(done?.status).toBe("done")
  expect(done?.progress).toBe(1)
})

test("kill marks a worker killed; finishTask after kill is a no-op; done delegate workers are reaped after 45s", () => {
  t = 0
  const o = createOrchestrator({ now: clock })
  const wid = o.beginTask("scan the forest")
  o.kill(wid)
  expect(o.state(null).workers[0].status).toBe("killed")
  o.finishTask(wid, "done")
  expect(o.state(null).workers[0].status).toBe("killed")

  const wid2 = o.beginTask("another task")
  o.finishTask(wid2, "done")
  expect(o.state(null).workers.find((x) => x.id === wid2)?.status).toBe("done")
  t += 46_000
  o.tick()
  expect(o.state(null).workers.find((x) => x.id === wid2)).toBeUndefined()
})

test("no simulated routine workers ever appear", () => {
  t = 0
  // start() restores persisted workers from disk — isolate from the shared
  // agents dir so only genuine pipeline/delegate work counts
  const isolated = mkdtempSync(join(tmpdir(), "ais-orch-empty-"))
  process.env.AISC_AGENTS_DIR = isolated
  const o = createOrchestrator({ now: clock })
  o.start()
  o.tick()
  t += 26_000
  o.tick()
  t += 26_000
  o.tick()
  expect(o.state(null).workers.length).toBe(0)
  o.dispose()
  rmSync(isolated, { recursive: true, force: true })
})

test("rename assigns a forged role to a live worker", () => {
  t = 1000
  const o = createOrchestrator({ now: clock })
  const id = o.beginTask("compare lr schedules")
  expect(o.state(null).workers.find((w) => w.id === id)?.name).toBe("assistant")
  o.rename(id, "ablation_statistician")
  expect(o.state(null).workers.find((w) => w.id === id)?.name).toBe("ablation_statistician")
  o.rename(id, "   ")
  expect(o.state(null).workers.find((w) => w.id === id)?.name).toBe("ablation_statistician")
})
