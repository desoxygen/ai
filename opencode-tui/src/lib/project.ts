import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { jobElapsed, jobStageMap, listTemplates, pidAlive, PROJECT_ROOT, readEvents, readJobs, type AisEvent, type AisJob } from "./aiscientist.ts"
import { vaultAiRoot } from "./notes.ts"
import { loadSettings } from "../theme.ts"
import type { Worker } from "./orchestrator.ts"

export const PIPELINE_STAGES = ["ideas", "novelty", "experiments", "writeup", "review"] as const

export type StageStatus = "done" | "running" | "fail" | "pending"

export interface StageState {
  key: string
  status: StageStatus
}

export interface AgentRow {
  jobId: number
  idea: string
  model: string
  status: AisJob["status"]
  stage: string
  elapsed: number
  last: string
}

export interface ProjectInfo {
  name: string
  description: string
  stages: StageState[]
  agents: AgentRow[]
  running: number
  totalRuns: number
  ideas: { total: number; byStatus: Record<string, number> } | null
  lastRunId: string | null
}

export function listProjects(): string[] {
  return listTemplates()
}

export function projectDescription(name: string): string {
  try {
    const raw = readFileSync(join(PROJECT_ROOT, "templates", name, "prompt.json"), "utf8")
    const p = JSON.parse(raw) as { task_description?: string; system?: string }
    const d = String(p.task_description ?? p.system ?? "").replace(/\s+/g, " ").trim()
    const first = d.split(/(?<=[.!?])\s+/)[0] ?? d
    return first
  } catch {
    return ""
  }
}

export function projectIdeaStatus(name: string): { total: number; byStatus: Record<string, number> } | null {
  try {
    const dir = join(vaultAiRoot(), "Ideas")
    if (!existsSync(dir)) return null
    const prefix = `${name}__`
    const byStatus: Record<string, number> = {}
    let total = 0
    for (const f of readdirSync(dir)) {
      if (!f.startsWith(prefix) || !f.endsWith(".md")) continue
      total++
      let st = "new"
      try {
        const m = readFileSync(join(dir, f), "utf8").slice(0, 2000).match(/^status:\s*"?([^"\n]*)"?\s*$/m)
        if (m && m[1].trim()) st = m[1].trim()
      } catch {}
      byStatus[st] = (byStatus[st] ?? 0) + 1
    }
    return total > 0 ? { total, byStatus } : null
  } catch {
    return null
  }
}

export interface IdeaCard {
  name: string
  title: string
  experiment: string
}

/** Ideas as stored by the pipeline in templates/<name>/ideas.json. */
export function projectIdeas(name: string, cap = 64): IdeaCard[] {
  return projectIdeasFull(name).slice(0, cap)
}

export interface IdeaFull extends IdeaCard {
  explanation: string
  interestingness: number
  novelty: number
  feasibility: number
  novel: boolean | null
  words: number
}

function score10(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v))
  return Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n))) : 0
}

/** Full idea records: scores + novelty verdict + body, for the Notes/ideas browser. */
export function projectIdeasFull(name: string): IdeaFull[] {
  try {
    const raw = JSON.parse(readFileSync(join(PROJECT_ROOT, "templates", name, "ideas.json"), "utf8")) as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((i): i is Record<string, unknown> => !!i && typeof (i as Record<string, unknown>).Name === "string")
      .map((i) => {
        const body = [String(i.Explanation ?? ""), String(i.Experiment ?? "")].join(" ").replace(/\s+/g, " ").trim()
        return {
          name: String(i.Name),
          title: String(i.Title ?? "").replace(/\s+/g, " ").trim(),
          experiment: String(i.Experiment ?? "").replace(/\s+/g, " ").trim(),
          explanation: String(i.Explanation ?? "").replace(/\s+/g, " ").trim(),
          interestingness: score10(i.Interestingness),
          novelty: score10(i.Novelty),
          feasibility: score10(i.Feasibility),
          novel: typeof i.novel === "boolean" ? i.novel : null,
          words: body ? body.split(/\s+/).length : 0,
        }
      })
  } catch {
    return []
  }
}

export function hasBaseline(name: string): boolean {
  return existsSync(join(PROJECT_ROOT, "templates", name, "run_0", "final_info.json"))
}

/** The idea worth showing on the dashboard: the one a job is running, else the first. */
export function selectedIdea(info: ProjectInfo, ideas: IdeaCard[]): IdeaCard | null {
  const running = info.agents.find((a) => a.status === "running" && a.idea && a.idea !== "full run")?.idea
  const recent = info.agents.find((a) => a.idea && a.idea !== "full run")?.idea
  const key = running ?? recent
  return (key ? ideas.find((i) => i.name === key) : undefined) ?? ideas[0] ?? null
}

function stageStates(latest: AisJob | undefined, evs: AisEvent[]): StageState[] {
  const sm = jobStageMap(evs)
  return PIPELINE_STAGES.map((s): StageState => {
    const st = sm.get(s)
    if (st === "done") return { key: s, status: "done" }
    if (st === "fail") return { key: s, status: "fail" }
    if (st === "started" || st === "log") {
      if (latest?.status === "running") return { key: s, status: "running" }
      return { key: s, status: latest?.status === "aborted" ? "fail" : "done" }
    }
    return { key: s, status: "pending" }
  })
}

/**
 * Boot-time project. Only a job whose process is actually alive counts —
 * stale "running" records in jobs.jsonl must not decide what the user sees,
 * and nothing ever auto-picks the first template. Everything else is the
 * explicit choice of the user (settings.project) or the doom menu.
 */
export function defaultProject(jobs: AisJob[] = readJobs(), projects: string[] = listProjects()): string {
  const running = jobs.findLast((j) => j.status === "running" && j.template && j.pid && pidAlive(j.pid) && projects.includes(j.template))
  return running?.template ?? ""
}

export function currentProjectName(projects: string[] = listProjects(), jobs: AisJob[] = readJobs()): string {
  const saved = loadSettings().project
  if (saved && projects.includes(saved)) return saved
  return defaultProject(jobs, projects)
}

export function projectInfo(name: string, jobs?: AisJob[], eventsOf?: (id: number) => AisEvent[]): ProjectInfo {
  const all = jobs ?? readJobs()
  const getEvents = eventsOf ?? ((id: number) => readEvents(id))
  const mine = all.filter((j) => j.template === name)
  const latest = mine[mine.length - 1]
  const recent = [...mine].reverse().slice(0, 3)
  const agents: AgentRow[] = recent.map((j) => {
    const evs = getEvents(j.id)
    const lastEv = [...evs].reverse().find((e) => e.stage !== "run")
    return {
      jobId: j.id,
      idea: j.idea || "full run",
      model: (j.model || "").replace(/^openrouter\//, "") || "default",
      status: j.status,
      stage: lastEv?.stage ?? "run",
      elapsed: jobElapsed(j),
      last: lastEv?.message ?? "queued",
    }
  })
  return {
    name,
    description: projectDescription(name),
    stages: stageStates(latest, latest ? getEvents(latest.id) : []),
    agents,
    running: mine.filter((j) => j.status === "running").length,
    totalRuns: mine.length,
    ideas: projectIdeaStatus(name),
    lastRunId: latest?.run_id ?? null,
  }
}

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`
}

export interface Workboard {
  done: string[]
  doing: string[]
  planned: string[]
}

export function workboard(info: ProjectInfo, workers: Worker[] = [], cap = 3): Workboard {
  const done: string[] = []
  const doing: string[] = []
  const planned: string[] = []
  for (const s of info.stages) {
    if (s.status === "done") done.push(`✓ ${s.key}`)
    else if (s.status === "running") doing.push(`▶ ${s.key}`)
    else if (s.status === "fail") done.push(`✗ ${s.key} retry`)
    else planned.push(`· ${s.key}`)
  }
  if (info.ideas) {
    const reviewed = info.ideas.byStatus["reviewed"] ?? 0
    const written = info.ideas.byStatus["writeup"] ?? 0
    const exp = info.ideas.byStatus["experiments"] ?? 0
    if (reviewed) done.push(`✓ ${reviewed} idea${reviewed > 1 ? "s" : ""} reviewed`)
    if (written) doing.push(`▶ ${written} in writeup`)
    if (exp) doing.push(`▶ ${exp} in experiments`)
  }
  for (const a of info.agents) {
    if (a.status === "running") doing.push(`▶ run #${a.jobId} ${a.idea}`)
    else if (a.status === "done") done.push(`✓ run #${a.jobId} finished`)
    else if (a.status === "failed" || a.status === "aborted") planned.push(`· retry run #${a.jobId}`)
  }
  for (const w of workers) {
    if (w.kind === "job") continue
    if (w.status === "running" || w.status === "queued") doing.push(`▶ ${w.name} ${Math.round(w.progress * 100)}%`)
    else if (w.status === "done") done.push(`✓ ${w.name}`)
    else if (w.status === "failed" || w.status === "killed") planned.push(`· respawn ${w.name}`)
  }
  if (done.length === 0) done.push("— nothing yet")
  if (doing.length === 0) doing.push("— idle")
  if (planned.length === 0) planned.push(`· /run ${info.name}`)
  return { done: done.slice(0, cap), doing: doing.slice(0, cap), planned: planned.slice(0, cap) }
}
