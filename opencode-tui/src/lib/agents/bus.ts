// Agent network event bus: every worker/main-agent decision is appended to
// results/agents/task-<id>.jsonl (persisted, replayable) and fanned out to
// in-memory subscribers so the TUI never polls.
import { mkdirSync, appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PROJECT_ROOT } from "../aiscientist.ts"

export type AgentLogKind = "log" | "status" | "clarify" | "result"

export interface AgentLogEvent {
  ts: number
  kind: AgentLogKind
  text: string
}

const MAX_INMEM = 200

export function agentsDir(): string {
  return process.env.AISC_AGENTS_DIR || join(PROJECT_ROOT, "results", "agents")
}

const dir = () => {
  const d = agentsDir()
  mkdirSync(d, { recursive: true })
  return d
}

const path = (id: number) => join(dir(), `task-${id}.jsonl`)

// the cache must follow the active agents dir: two orchestrators writing to
// different dirs (parallel tests, AISC_AGENTS_DIR switch) reuse small ids —
// keying by id alone made one session resurrect another's final statuses
const inmem = new Map<string, AgentLogEvent[]>()
const cacheKey = (id: number) => `${agentsDir()}|${id}`
const subs = new Set<(id: number, ev: AgentLogEvent) => void>()

export function agentEvents(id: number): AgentLogEvent[] {
  const key = cacheKey(id)
  let list = inmem.get(key)
  if (!list) {
    list = []
    const p = path(id)
    if (existsSync(p)) {
      try {
        for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
          if (!line.trim()) continue
          try {
            list.push(JSON.parse(line) as AgentLogEvent)
          } catch {}
        }
      } catch {}
    }
    inmem.set(key, list)
  }
  return list
}

export function appendAgentEvent(id: number, kind: AgentLogKind, text: string): AgentLogEvent {
  const ev: AgentLogEvent = { ts: Date.now(), kind, text }
  const list = agentEvents(id)
  list.push(ev)
  if (list.length > MAX_INMEM) list.splice(0, list.length - MAX_INMEM)
  try {
    appendFileSync(path(id), `${JSON.stringify(ev)}\n`, "utf8")
  } catch {}
  for (const fn of subs) fn(id, ev)
  return ev
}

export function subscribeAgentEvents(fn: (id: number, ev: AgentLogEvent) => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}
