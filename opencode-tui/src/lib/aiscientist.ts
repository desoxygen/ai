import { spawn } from "node:child_process"
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, unlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs"
import { join, resolve } from "node:path"

export interface AisEvent {
  ts: string
  run_id: string
  idea_id: string
  module: string
  stage: string
  status: "started" | "log" | "done" | "fail"
  message: string
  job_id?: number
  template?: string
  model?: string
  detail?: {
    error?: string; exit_code?: number; path?: string; summary?: unknown; aborted?: boolean
    section?: string; phase?: string; folder?: string; stages?: string[]
    before?: number; after?: number; min_score?: number; rounds?: number
  }
}

export interface AisJob {
  id: number
  run_id: string
  module: string
  template: string
  model: string
  idea: string
  status: "queued" | "running" | "done" | "failed" | "aborted"
  started_at: string
  finished_at: string
  pid?: number
}

function findRoot(): string {
  const up = resolve(import.meta.dir, "..", "..", "..")
  if (existsSync(join(up, "ai_scientist", "console"))) return up
  if (existsSync(join(process.cwd(), "ai_scientist", "console"))) return process.cwd()
  return up
}

export const PROJECT_ROOT = findRoot()
// results/ can be redirected for tests (AISC_RESULTS_DIR) - the same variable
// is honoured by ai_scientist/settings.py, so CLI spawns stay in sync.
export function getResultsDir(): string {
  return process.env.AISC_RESULTS_DIR || join(PROJECT_ROOT, "results")
}
export function getEventsDir(): string {
  return join(getResultsDir(), "events")
}
function getJobsFile(): string {
  return join(getResultsDir(), "jobs.jsonl")
}

export function parseJsonl<T>(text: string): T[] {
  const out: T[] = []
  for (const ln of text.split("\n")) {
    if (!ln.trim()) continue
    try {
      out.push(JSON.parse(ln) as T)
    } catch {}
  }
  return out
}

export function readJobs(jobsFile = getJobsFile()): AisJob[] {
  try {
    return parseJsonl<AisJob>(readFileSync(jobsFile, "utf8"))
  } catch {
    return []
  }
}

export function eventsPath(jobId: number, eventsDir = getEventsDir()): string {
  return join(eventsDir, `${jobId}.jsonl`)
}

export function readEvents(jobId: number, eventsDir = getEventsDir()): AisEvent[] {
  try {
    return parseJsonl<AisEvent>(readFileSync(eventsPath(jobId, eventsDir), "utf8"))
  } catch {
    return []
  }
}

export function listTemplates(): string[] {
  try {
    return readdirSync(join(PROJECT_ROOT, "templates"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

export function jobStageMap(events: AisEvent[]): Map<string, AisEvent["status"]> {
  const m = new Map<string, AisEvent["status"]>()
  for (const ev of events) m.set(ev.stage, ev.status)
  return m
}

export function jobElapsed(job: AisJob, now = Date.now()): number {
  if (!job.started_at) return 0
  const start = Date.parse(job.started_at)
  if (Number.isNaN(start)) return 0
  const end = job.status === "running" ? now : Date.parse(job.finished_at || "") || now
  return Math.max(0, end - start)
}

// ---------------------------------------------------------------- tailer

class Tailer {
  private fd = -1
  private offset = 0
  private rem = ""
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    public readonly jobId: number,
    private onEvent: (ev: AisEvent) => void,
    private dir: string = getEventsDir(),
  ) {}

  start(): void {
    const poke = () => this.poll()
    try {
      this.watcher = watch(this.path(), poke)
    } catch {}
    this.timer = setInterval(poke, 500)
    this.poll()
  }

  private path() {
    return eventsPath(this.jobId, this.dir)
  }

  poll(): void {
    try {
      if (this.fd < 0) {
        this.fd = openSync(this.path(), "r")
        this.offset = 0
        this.rem = ""
      }
      const size = fstatSync(this.fd).size
      if (size < this.offset) {
        this.offset = 0
        this.rem = ""
      }
      while (this.offset < size) {
        const buf = Buffer.alloc(Math.min(size - this.offset, 65536))
        const got = readSync(this.fd, buf, 0, buf.length, this.offset)
        if (got <= 0) break
        this.offset += got
        const text = this.rem + buf.toString("utf8", 0, got)
        const nl = text.lastIndexOf("\n")
        if (nl === -1) {
          this.rem = text
          break
        }
        this.rem = text.slice(nl + 1)
        for (const ev of parseJsonl<AisEvent>(text.slice(0, nl))) this.onEvent(ev)
      }
    } catch {
      if (this.fd >= 0) {
        try {
          closeSync(this.fd)
        } catch {}
        this.fd = -1
      }
    }
  }

  stop(): void {
    try {
      this.watcher?.close()
    } catch {}
    if (this.timer) clearInterval(this.timer)
    try {
      if (this.fd >= 0) closeSync(this.fd)
    } catch {}
    this.fd = -1
  }
}

// ---------------------------------------------------------------- store

type StoreListener = (kind: "jobs" | "event", jobId?: number) => void
const EVENTS_KEEP = 500

export interface AisStore {
  jobs: AisJob[]
  events: Map<number, AisEvent[]>
  rate: Map<number, number[]>
  start: () => void
  dispose: () => void
  subscribe: (fn: StoreListener) => () => void
  refresh: () => void
}

export function createStore(opts?: { jobsFile?: string; eventsDir?: string; resultsDir?: string }): AisStore {
  const jobsFile = opts?.jobsFile
  const eventsDir = opts?.eventsDir
  const resultsDir = opts?.resultsDir ?? getResultsDir()
  const jobs: { value: AisJob[] } = { value: [] }
  const events = new Map<number, AisEvent[]>()
  const rate = new Map<number, number[]>()
  const tailers = new Map<number, Tailer>()
  const listeners = new Set<StoreListener>()
  const rateWin = new Map<number, { win: number; count: number }>()
  let jobsWatcher: FSWatcher | null = null
  let pulseTimer: ReturnType<typeof setInterval> | null = null

  const notify = (kind: "jobs" | "event", jobId?: number) => {
    for (const fn of listeners) fn(kind, jobId)
  }

  const onEvent = (ev: AisEvent) => {
    const jid = ev.job_id ?? 0
    const list = events.get(jid) ?? []
    list.push(ev)
    if (list.length > EVENTS_KEEP) list.splice(0, list.length - EVENTS_KEEP)
    events.set(jid, list)
    const w = rateWin.get(jid)
    const now = Date.now()
    const r = rate.get(jid) ?? []
    if (!w || now - w.win > 1000) {
      rateWin.set(jid, { win: now, count: 1 })
      r.push(1)
    } else {
      w.count++
      if (r.length) r[r.length - 1] = w.count
    }
    if (r.length > 24) r.shift()
    rate.set(jid, r)
    notify("event", jid)
  }

  const syncTailers = () => {
    for (const j of jobs.value) {
      if (j.status === "running" && !tailers.has(j.id)) {
        const t = new Tailer(j.id, onEvent, eventsDir)
        t.start()
        tailers.set(j.id, t)
      }
    }
    for (const [id, t] of [...tailers.entries()]) {
      const j = jobs.value.find((x) => x.id === id)
      if (!j || j.status !== "running") {
        // drain whatever was appended after the last tick before stopping,
        // so the final stage events are never lost
        for (let i = 0; i < 3; i++) {
          t.poll()
          if (i < 2) awaitBurst()
        }
        t.stop()
        tailers.delete(id)
      }
    }
  }

  // tiny settle gap so a just-finished process can flush its last lines
  const awaitBurst = (): void => {
    const start = Date.now()
    while (Date.now() - start < 15) {
      /* busy-wait a few ms; called at most twice per finished job */
    }
  }

  let lastJobsJson = ""
  // jobs.jsonl is append-friendly garbage: a crashed run leaves "running"
  // forever. Reconcile against reality at read time â€” dead pid means the job
  // is over; the board must never show a worker that no longer exists.
  const reconcile = (fresh: AisJob[]): AisJob[] =>
    fresh.map((j) =>
      j.status === "running" && j.pid && !pidAlive(j.pid)
        ? { ...j, status: "aborted" as const, finished_at: j.finished_at || j.started_at }
        : j,
    )
  const refresh = () => {
    const fresh = reconcile(readJobs(jobsFile))
    const json = JSON.stringify(fresh)
    const changed = json !== lastJobsJson
    jobs.value = fresh
    syncTailers()
    // the 2s pulse must not re-render the whole app when nothing changed
    if (changed) {
      lastJobsJson = json
      notify("jobs")
    }
  }

  return {
    get jobs() {
      return jobs.value
    },
    events,
    rate,
    start() {
      refresh()
      try {
        jobsWatcher = watch(resultsDir, (_ev, file) => {
          if (file === "jobs.jsonl") refresh()
        })
      } catch {}
      pulseTimer = setInterval(refresh, 2000)
    },
    dispose() {
      try {
        jobsWatcher?.close()
      } catch {}
      if (pulseTimer) clearInterval(pulseTimer)
      for (const t of tailers.values()) t.stop()
      tailers.clear()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    refresh,
  }
}

// ---------------------------------------------------------------- run / stop

export interface RunHandle {
  child: ReturnType<typeof spawn>
  stop: () => void
}

export interface RunOptions {
  template: string
  model?: string
  idea?: string
  stages?: string
  numIdeas?: number
  /** "on:<minScore>:<rounds>" or "off" (settings.improve format). */
  improve?: string
}

export function runArgs(opts: RunOptions): string[] {
  const args = [
    "-m",
    "ai_scientist.console.cli",
    "-q",
    "run",
    "--template",
    opts.template,
    ...(opts.model ? ["--model", opts.model] : []),
    ...(opts.idea ? ["--idea", opts.idea] : []),
    ...(opts.stages ? ["--stages", opts.stages] : []),
    ...(opts.numIdeas ? ["--num-ideas", String(opts.numIdeas)] : []),
  ]
  const m = /^on:(\d+(?:\.\d+)?):(\d+)$/.exec(opts.improve ?? "off")
  if (m) args.push("--improve", "--min-score", m[1], "--rounds", m[2])
  return args
}

export function startRun(opts: RunOptions): RunHandle {
  const child = spawn(process.env.AISC_PYTHON || "python", runArgs(opts), {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  })
  // stderr is piped but not parsed - it MUST be drained, or a burst of
  // tracebacks fills the OS pipe buffer and deadlocks the pipeline.
  child.stderr?.resume()
  return { child, stop: () => killTree(child) }
}

export function skeletonArgs(opts: { name: string; description: string; model?: string; baseline?: boolean }): string[] {
  return [
    "-m",
    "ai_scientist.console.cli",
    "-q",
    "skeleton",
    "--name",
    opts.name,
    "--description",
    opts.description,
    ...(opts.model ? ["--model", opts.model] : []),
    ...(opts.baseline === false ? ["--no-baseline"] : []),
  ]
}

export function startSkeleton(opts: { name: string; description: string; model?: string; baseline?: boolean }): RunHandle {
  const child = spawn(process.env.AISC_PYTHON || "python", skeletonArgs(opts), {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  })
  child.stderr?.resume()
  return { child, stop: () => killTree(child) }
}

export interface PaperOptions {
  template: string
  folder?: string
  stages?: string
  model?: string
  planModel?: string
  codeModel?: string
  reviewModel?: string
  /** "on:<minScore>:<rounds>" or "off" (settings.improve format). */
  improve?: string
}

export function paperArgs(opts: PaperOptions): string[] {
  const args = [
    "-m",
    "ai_scientist.console.cli",
    "-q",
    "paper",
    "--template",
    opts.template,
    ...(opts.folder ? ["--folder", opts.folder] : []),
    ...(opts.stages ? ["--stages", opts.stages] : []),
    ...(opts.model ? ["--model", opts.model] : []),
    ...(opts.planModel ? ["--plan-model", opts.planModel] : []),
    ...(opts.codeModel ? ["--code-model", opts.codeModel] : []),
    ...(opts.reviewModel ? ["--review-model", opts.reviewModel] : []),
  ]
  const m = /^on:([\d.]+):(\d+)$/.exec(opts.improve ?? "off")
  if (m) args.push("--improve", "--min-score", m[1], "--rounds", m[2])
  return args
}

export function startPaper(opts: PaperOptions): RunHandle {
  const child = spawn(process.env.AISC_PYTHON || "python", paperArgs(opts), {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  })
  child.stderr?.resume()
  return { child, stop: () => killTree(child) }
}

export function waitJobId(prevMax: number, timeoutMs = 20000): Promise<number> {
  return new Promise((res) => {
    const iv = setInterval(() => {
      const fresh = readJobs().find((j) => j.id > prevMax)
      if (fresh) {
        clearInterval(iv)
        clearTimeout(to)
        res(fresh.id)
      }
    }, 300)
    const to = setTimeout(() => {
      clearInterval(iv)
      res(-1)
    }, timeoutMs)
  })
}

export function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return
  killPid(child.pid)
}

export function pidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

export function killPid(pid: number): void {
  if (!pid || pid <= 0) return
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
  } else {
    try {
      process.kill(pid, "SIGTERM")
      setTimeout(() => {
        try {
          process.kill(pid, "SIGKILL")
        } catch {}
      }, 5000)
    } catch {}
  }
}

function rewriteJobs(jobs: AisJob[], jobsFile = getJobsFile()): void {
  try {
    writeFileSync(jobsFile, jobs.map((j) => JSON.stringify(j)).join("\n") + "\n")
  } catch {}
}

export function markJobStatus(jobId: number, status: AisJob["status"], jobsFile = getJobsFile()): boolean {
  const jobs = readJobs(jobsFile)
  const j = jobs.find((x) => x.id === jobId)
  if (!j) return false
  j.status = status
  if (status === "done" || status === "failed" || status === "aborted") {
    j.finished_at = new Date().toISOString()
  }
  rewriteJobs(jobs, jobsFile)
  return true
}

export function deleteJobRecord(jobId: number, eventsDir: string = getEventsDir(), jobsFile = getJobsFile()): boolean {
  const jobs = readJobs(jobsFile)
  if (!jobs.some((j) => j.id === jobId)) return false
  rewriteJobs(jobs.filter((j) => j.id !== jobId), jobsFile)
  try {
    const p = eventsPath(jobId, eventsDir)
    if (existsSync(p)) unlinkSync(p)
  } catch {}
  return true
}
