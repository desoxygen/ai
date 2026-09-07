import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { PROJECT_ROOT, type AisEvent, type AisJob } from "./aiscientist.ts"
import type { ProjectInfo } from "./project.ts"
import { appendAgentEvent, agentEvents, agentsDir } from "./agents/bus.ts"

export type WorkerStatus = "queued" | "running" | "done" | "failed" | "killed"

export interface LogLine {
  ts: number
  text: string
}

export interface Worker {
  id: number
  name: string
  task: string
  status: WorkerStatus
  /** 0..1 — known progress, -1 — indeterminate (streaming / external). */
  progress: number
  bornAt: number
  startedAt: number | null
  endedAt: number | null
  jobId: number | null
  kind: "job" | "delegate"
  log: LogLine[]
  /** Operator clarifications received while the task was running. */
  clarifications: string[]
  /** Final answer text of a delegate worker. */
  result: string | null
}

export interface OrchState {
  main: {
    status: "idle" | "watching" | "delegating"
    focus: string
    log: LogLine[]
  }
  workers: Worker[]
  now: number
}

export interface Orchestrator {
  state(project: ProjectInfo | null, now?: number): OrchState
  sync(project: ProjectInfo | null, jobs: AisJob[], eventsOf: (id: number) => AisEvent[]): void
  beginTask(task: string): number
  appendTaskLog(id: number, text: string): void
  /** Operator steering: record a clarification against a live task. */
  steer(id: number, clarification: string): Worker | null
  setResult(id: number, text: string): void
  finishTask(id: number, status: "done" | "failed" | "killed"): void
  kill(id: number): Worker | null
  start(): void
  tick(): void
  dispose(): void
  subscribe(fn: () => void): () => void
}

const TICK_MS = 1000
const REAP_AFTER_MS = 45_000
const MAX_JOB_WORKERS = 10
const MAX_DELEGATE_WORKERS = 6

function roleForStage(stage: string): string {
  if (stage === "ideas") return "idea_scout"
  if (stage === "novelty") return "novelty_checker"
  if (stage === "writeup") return "writer"
  if (stage === "review") return "reviewer"
  if (stage === "improve") return "improver"
  if (stage === "skeleton") return "skeleton_builder"
  return "exp_runner"
}

export function createOrchestrator(opts?: { now?: () => number }): Orchestrator {
  const clock = opts?.now ?? Date.now
  let counter = 0
  const workers = new Map<number, Worker>()
  const mainLog: LogLine[] = []
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  let lastDelegateAt = 0
  let dirty = false

  const notify = () => {
    for (const fn of listeners) fn()
  }

  const log = (text: string) => {
    mainLog.push({ ts: clock(), text })
    if (mainLog.length > 40) mainLog.shift()
  }

  const pushWorkerLog = (w: Worker, text: string) => {
    w.log.push({ ts: clock(), text })
    if (w.log.length > 30) w.log.shift()
    // job workers are projections of jobs.jsonl — only delegate task logs are
    // worth persisting to results/agents
    if (w.kind === "delegate") appendAgentEvent(w.id, "log", text)
  }

  function addWorker(partial: Omit<Worker, "id" | "log" | "clarifications" | "result">): Worker {
    // ids must never collide with workers restored from a previous session:
    // a reused id would append to someone else's persisted task log
    let id = ++counter
    while (workers.has(id) || existsSync(join(agentsDir(), `task-${id}.jsonl`))) id = ++counter
    counter = id
    const w: Worker = { ...partial, id, log: [], clarifications: [], result: null }
    workers.set(w.id, w)
    if (w.kind === "delegate") appendAgentEvent(w.id, "status", `spawned: ${w.task}`)
    if (w.kind === "delegate") {
      const delegates = [...workers.values()].filter((x) => x.kind === "delegate")
      if (delegates.length > MAX_DELEGATE_WORKERS) {
        const reapable = delegates.filter((x) => x.status === "done" || x.status === "failed" || x.status === "killed")
        reapable.sort((a, b) => (a.endedAt ?? a.bornAt) - (b.endedAt ?? b.bornAt))
        if (reapable[0]) workers.delete(reapable[0].id)
      }
    }
    return w
  }

  function jobProgressOf(job: AisJob, evs: AisEvent[]): { stage: string; progress: number } {
    const stages = ["ideas", "novelty", "experiments", "writeup", "review"]
    const done = new Set<string>()
    let lastStage = "run"
    for (const e of evs) {
      if (e.stage !== "run") lastStage = e.stage
      if (e.status === "done" && stages.includes(e.stage)) done.add(e.stage)
    }
    return { stage: lastStage, progress: Math.min(0.95, done.size / stages.length) }
  }

  let pendingSync: { project: ProjectInfo | null; jobs: AisJob[]; eventsOf: (id: number) => AisEvent[] } | null = null

  function applySync(): void {
    const s = pendingSync
    if (!s) return
    const now = clock()
    let changed = false
    const liveJobs = new Map<number, AisJob>()
    for (const j of s.jobs) liveJobs.set(j.id, j)
    for (const j of s.jobs.slice(-MAX_JOB_WORKERS)) {
      const existing = [...workers.values()].find((w) => w.jobId === j.id)
      const evs = s.eventsOf(j.id)
      const { stage, progress } = jobProgressOf(j, evs)
      const finalStatus: WorkerStatus | null =
        j.status === "done" ? "done" : j.status === "failed" ? "failed" : j.status === "aborted" ? "killed" : null
      if (!existing) {
        if (j.status !== "queued") {
          const w = addWorker({
            name: roleForStage(stage),
            task: `${j.template}${j.idea ? ` · ${j.idea}` : ""} — pipeline job #${j.id}`,
            status: j.status === "running" ? "running" : (finalStatus ?? "running"),
            progress: finalStatus ? 1 : progress,
            bornAt: Date.parse(j.started_at) || now,
            startedAt: Date.parse(j.started_at) || now,
            endedAt: finalStatus ? Date.parse(j.finished_at) || now : null,
            jobId: j.id,
            kind: "job",
          })
          pushWorkerLog(w, `attached to live job #${j.id} [${stage}]`)
          log(`bound worker #${w.id} (${w.name}) to job #${j.id}`)
          changed = true
        }
        continue
      }
      const nextProgress = finalStatus ? 1 : progress
      const nextStatus: WorkerStatus = finalStatus ?? (j.status === "queued" ? "queued" : "running")
      if (existing.status !== nextStatus || existing.progress !== nextProgress || existing.name !== roleForStage(stage)) {
        existing.status = nextStatus
        existing.progress = nextProgress
        existing.name = roleForStage(stage)
        if (finalStatus && !existing.endedAt) {
          existing.endedAt = Date.parse(j.finished_at) || now
          pushWorkerLog(existing, `job #${j.id} → ${j.status}`)
          log(`job #${j.id} ${j.status} — worker #${existing.id} ${nextStatus}`)
        }
        changed = true
      }
    }

    for (const w of [...workers.values()]) {
      if (w.kind === "job" && !liveJobs.has(w.jobId ?? -1)) {
        workers.delete(w.id)
        changed = true
      }
    }
    if (changed) dirty = true
  }

  function reap(): void {
    const now = clock()
    for (const w of [...workers.values()]) {
      if ((w.status === "done" || w.status === "failed" || w.status === "killed") && w.endedAt !== null && now - w.endedAt > REAP_AFTER_MS && w.kind !== "job") {
        workers.delete(w.id)
        dirty = true
      }
    }
    if (dirty) {
      dirty = false
      notify()
    }
  }

  /**
   * Delegate workers lived only in memory — a TUI restart silently forgot
   * them. Their decision logs are persisted in results/agents/, so rebuild
   * the board from there: finished tasks keep their status, anything that
   * was mid-flight is marked killed (the process is gone with the TUI).
   */
  function restoreFromDisk(): void {
    let dir: string
    try {
      dir = agentsDir()
      if (!existsSync(dir)) return
    } catch {
      return
    }
    const now = clock()
    let restored = 0
    for (const f of readdirSync(dir)) {
      const m = f.match(/^task-(\d+)\.jsonl$/)
      if (!m) continue
      const id = +m[1]
      if (workers.has(id)) continue
      let evs: { ts: number; kind: string; text: string }[] = []
      try {
        evs = agentEvents(id)
      } catch {
        continue
      }
      if (evs.length === 0) continue
      const spawnEv = evs.find((e) => e.kind === "status" && e.text.startsWith("spawned: "))
      const task = spawnEv ? spawnEv.text.slice("spawned: ".length) : f.replace(/^task-|\.jsonl$/g, "")
      // legacy debris: projections of pipeline jobs were once persisted too —
      // they belong to jobs.jsonl, not here
      if (task.includes("pipeline job #")) continue
      const statusEv = [...evs].reverse().find((e) => e.kind === "status" && ["done", "failed", "killed"].includes(e.text))
      const final: WorkerStatus = statusEv ? (statusEv.text as WorkerStatus) : "killed"
      const w: Worker = {
        id,
        name: "assistant",
        task: task.slice(0, 72),
        status: final,
        progress: final === "done" ? 1 : 0,
        bornAt: evs[0].ts || now,
        startedAt: evs[0].ts || now,
        endedAt: statusEv?.ts ?? now,
        jobId: null,
        kind: "delegate",
        log: [],
        clarifications: [],
        result: null,
      }
      if (!statusEv) pushWorkerLog(w, "interrupted by TUI restart — re-delegate if still needed")
      else pushWorkerLog(w, "restored from previous session")
      workers.set(w.id, w)
      counter = Math.max(counter, id)
      restored++
    }
    if (restored > 0) {
      log(`restored ${restored} worker${restored > 1 ? "s" : ""} from the previous session`)
      dirty = true
      notify()
    }
  }

  return {
    state(project, now = clock()): OrchState {
      const running = [...workers.values()].filter((w) => w.status === "running")
      const stage = project?.stages.find((s) => s.status === "running")
      const delegating = now - lastDelegateAt < 5000
      return {
        main: {
          status: delegating ? "delegating" : running.length > 0 ? "watching" : "idle",
          focus: project
            ? `project ${project.name}${stage ? ` · stage ${stage.key}` : running[0] ? ` · ${running.length} worker${running.length > 1 ? "s" : ""} active` : " · all quiet"}`
            : "no project selected",
          log: mainLog,
        },
        workers: [...workers.values()].sort((a, b) => a.bornAt - b.bornAt),
        now,
      }
    },
    sync(project, js, eventsOf) {
      pendingSync = { project, jobs: js, eventsOf }
      applySync()
      if (dirty) {
        dirty = false
        notify()
      }
    },
    beginTask(task: string): number {
      const now = clock()
      const clean = task.replace(/\s+/g, " ").trim().slice(0, 72) || "unspecified task"
      const w = addWorker({
        name: "assistant",
        task: clean,
        status: "running",
        progress: -1,
        bornAt: now,
        startedAt: now,
        endedAt: null,
        jobId: null,
        kind: "delegate",
      })
      pushWorkerLog(w, "task accepted by the main agent")
      log(`user request delegated → #${w.id} assistant`)
      lastDelegateAt = now
      dirty = true
      notify()
      return w.id
    },
    appendTaskLog(id: number, text: string) {
      const w = workers.get(id)
      if (!w) return
      for (const ln of text.split("\n")) {
        if (ln.trim()) pushWorkerLog(w, ln.trim().slice(0, 140))
      }
      dirty = true
      notify()
    },
    steer(id, clarification) {
      const w = workers.get(id)
      if (!w || w.status !== "running") return null
      const clean = clarification.replace(/\s+/g, " ").trim().slice(0, 300)
      if (!clean) return null
      w.clarifications.push(clean)
      pushWorkerLog(w, `clarification: ${clean}`)
      if (w.kind === "delegate") appendAgentEvent(id, "clarify", clean)
      log(`operator clarified worker #${id}`)
      dirty = true
      notify()
      return w
    },
    setResult(id: number, text: string) {
      const w = workers.get(id)
      if (!w) return
      w.result = text.slice(0, 4000)
      if (w.kind === "delegate") appendAgentEvent(id, "result", w.result)
    },
    finishTask(id: number, status: "done" | "failed" | "killed") {
      const w = workers.get(id)
      if (!w || w.status === "done" || w.status === "failed" || w.status === "killed") return
      w.status = status
      w.progress = status === "done" ? 1 : w.progress
      w.endedAt = clock()
      pushWorkerLog(w, status === "done" ? "finished — result posted to chat" : status === "killed" ? "killed by operator" : "failed")
      if (w.kind === "delegate") appendAgentEvent(id, "status", status)
      log(`worker #${id} ${status}`)
      dirty = true
      notify()
    },
    kill(id: number) {
      const w = workers.get(id)
      if (!w || w.status === "done" || w.status === "failed" || w.status === "killed") return null
      w.status = "killed"
      w.endedAt = clock()
      pushWorkerLog(w, "killed by operator")
      if (w.kind === "delegate") appendAgentEvent(w.id, "status", "killed")
      log(`operator killed worker #${id}`)
      dirty = true
      notify()
      return w
    },
    start() {
      if (timer) return
      timer = setInterval(reap, TICK_MS)
      restoreFromDisk()
    },
    tick() {
      reap()
    },
    dispose() {
      if (timer) clearInterval(timer)
      timer = null
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
