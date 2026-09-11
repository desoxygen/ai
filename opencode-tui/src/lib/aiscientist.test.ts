import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, appendFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStore, deleteJobRecord, jobStageMap, markJobStatus, parseJsonl, pidAlive, readEvents, readJobs, runArgs, skeletonArgs, type AisEvent, type AisJob } from "./aiscientist.ts"
import { sortPanels, type DashPanel } from "../components/Dashboard.tsx"

const dir = mkdtempSync(join(tmpdir(), "ais-broker-"))
const eventsDir = join(dir, "events")
mkdirSync(eventsDir, { recursive: true })
const jobsFile = join(dir, "jobs.jsonl")

const job = (over: Partial<AisJob>): AisJob => ({
  id: 1,
  run_id: "20260904_120000",
  module: "pipeline/run",
  template: "nanoGPT_lite",
  model: "",
  idea: "",
  status: "running",
  started_at: new Date().toISOString(),
  finished_at: "",
  ...over,
})

test("parseJsonl skips junk lines instead of throwing", () => {
  const r = parseJsonl<{ a: number }>('{ "a": 1 }\nnot json\n\n{"a": 2}\n')
  expect(r.length).toBe(2)
})

test("readJobs / readEvents roundtrip against fixture dir", () => {
  appendFileSync(jobsFile, JSON.stringify(job({})) + "\n")
  appendFileSync(join(eventsDir, "1.jsonl"), JSON.stringify({ ts: "x", run_id: "r", idea_id: "", module: "m", stage: "ideas", status: "done", message: "ok", job_id: 1 }) + "\n")
  expect(readJobs(jobsFile).length).toBe(1)
  expect(readEvents(1, eventsDir)[0].stage).toBe("ideas")
})

test("jobStageMap keeps the LAST status per stage", () => {
  const evs = [
    { stage: "experiments", status: "started" },
    { stage: "experiments", status: "log" },
    { stage: "experiments", status: "done" },
    { stage: "writeup", status: "started" },
  ] as AisEvent[]
  const m = jobStageMap(evs)
  expect(m.get("experiments")).toBe("done")
  expect(m.get("writeup")).toBe("started")
})

test("sortPanels puts running first, then newest id", () => {
  const mk = (id: number, status: AisJob["status"]): DashPanel => ({ id, title: "", status, elapsed: 0, model: "", chips: [], last: "", rate: [] })
  const sorted = sortPanels([mk(1, "done"), mk(5, "running"), mk(3, "failed"), mk(4, "done")])
  expect(sorted.map((p) => p.id)).toEqual([5, 4, 3, 1])
})

test("store tails a growing events file and reports rate", async () => {
  appendFileSync(jobsFile, JSON.stringify(job({ id: 2 })) + "\n")
  const store = createStore({ jobsFile, eventsDir, resultsDir: dir })
  const got: AisEvent[] = []
  const un = store.subscribe((kind, jobId) => {
    if (kind === "event" && jobId === 2) got.push(...(store.events.get(2) ?? []).slice(got.length))
  })
  store.start()
  appendFileSync(join(eventsDir, "2.jsonl"), JSON.stringify({ ts: "y", run_id: "r", idea_id: "i", module: "m", stage: "ideas", status: "done", message: "m1", job_id: 2 }) + "\n")
  await Bun.sleep(900)
  store.dispose()
  un()
  expect(store.events.get(2)?.some((e) => e.message === "m1")).toBe(true)
  expect((store.rate.get(2) ?? []).length).toBeGreaterThan(0)
})

test("markJobStatus rewrites the record in place", () => {
  appendFileSync(jobsFile, JSON.stringify(job({ id: 3, status: "running", pid: 4242 })) + "\n")
  expect(markJobStatus(3, "aborted", jobsFile)).toBe(true)
  const j3 = readJobs(jobsFile).find((x) => x.id === 3)
  expect(j3?.status).toBe("aborted")
  expect(j3?.finished_at).not.toBe("")
  expect(markJobStatus(999, "aborted", jobsFile)).toBe(false)
})

test("deleteJobRecord removes the line and the events file", () => {
  appendFileSync(jobsFile, JSON.stringify(job({ id: 4 })) + "\n")
  appendFileSync(join(eventsDir, "4.jsonl"), "{}\n")
  expect(deleteJobRecord(4, eventsDir, jobsFile)).toBe(true)
  expect(readJobs(jobsFile).some((x) => x.id === 4)).toBe(false)
  expect(existsSync(join(eventsDir, "4.jsonl"))).toBe(false)
  expect(deleteJobRecord(4, eventsDir, jobsFile)).toBe(false)
})

test("pidAlive detects this process and rejects garbage", () => {
  expect(pidAlive(process.pid)).toBe(true)
  expect(pidAlive(0)).toBe(false)
  expect(pidAlive(2 ** 30)).toBe(false)
})

test("readJobs folds append-only history: last record per id wins", () => {
  const f = join(dir, "fold.jsonl")
  appendFileSync(f, JSON.stringify(job({ id: 7, status: "running" })) + "\n")
  appendFileSync(f, JSON.stringify(job({ id: 7, status: "running" })) + "\n") // dup create (the old race)
  appendFileSync(f, JSON.stringify(job({ id: 7, status: "failed" })) + "\n")
  appendFileSync(f, JSON.stringify(job({ id: 8 })) + "\n")
  const jobs = readJobs(f)
  expect(jobs.length).toBe(2)
  expect(jobs.find((j) => j.id === 7)?.status).toBe("failed")
})

test("tombstone hides a job and markJobStatus never rewrites history", () => {
  appendFileSync(jobsFile, JSON.stringify(job({ id: 9, status: "running" })) + "\n")
  const before = readFileSync(jobsFile, "utf8").split("\n").filter(Boolean).length
  expect(markJobStatus(9, "done", jobsFile)).toBe(true)
  const after = readFileSync(jobsFile, "utf8").split("\n").filter(Boolean).length
  expect(after).toBe(before + 1) // append-only, not a rewrite
  expect(deleteJobRecord(9, eventsDir, jobsFile)).toBe(true)
  expect(readJobs(jobsFile).some((j) => j.id === 9)).toBe(false)
  // the tombstone stays in the file (id watermark), append-only again
  expect(readFileSync(jobsFile, "utf8").split("\n").filter(Boolean).length).toBe(after + 1)
})

test("runArgs wires --improve flags for the CLI", () => {
  const plain = runArgs({ template: "nanoGPT_lite" }).join(" ")
  expect(plain).not.toContain("--improve")
  const off = runArgs({ template: "t", improve: "off" }).join(" ")
  expect(off).not.toContain("--improve")
  const on = runArgs({ template: "t", improve: "on:6:2" })
  expect(on.slice(on.indexOf("--improve"))).toEqual(["--improve", "--min-score", "6", "--rounds", "2"])
})

test("skeletonArgs builds the console CLI skeleton command", () => {
  const a = skeletonArgs({ name: "my_proj", description: "study X" })
  expect(a.slice(0, 6)).toEqual(["-m", "ai_scientist.console.cli", "-q", "skeleton", "--name", "my_proj"])
  expect(a.join(" ")).toContain("--description study X")
  expect(a.join(" ")).not.toContain("--no-baseline")
  expect(skeletonArgs({ name: "p", description: "d", baseline: false }).join(" ")).toContain("--no-baseline")
})

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
})
