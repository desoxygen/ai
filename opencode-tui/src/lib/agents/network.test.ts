import { describe, test, expect, beforeAll } from "bun:test"
import { createOrchestrator } from "../orchestrator.ts"
import { agentEvents, subscribeAgentEvents } from "./bus.ts"
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// all agent logs go to a throwaway dir so tests never touch results/agents
const agentsTmp = mkdtempSync(join(tmpdir(), "ais-agents-net-"))
beforeAll(() => {
  // assign here (not at module load): every test file shares one process, and
  // whichever file loads last would otherwise win for all of them
  process.env.AISC_AGENTS_DIR = agentsTmp
  return () => rmSync(agentsTmp, { recursive: true, force: true })
})

describe("agent network", () => {
  test("steer records clarification only on running tasks", () => {
    const o = createOrchestrator()
    const id = o.beginTask("summarize results")
    const w1 = o.steer(id, "focus on run 2")
    expect(w1).not.toBeNull()
    expect(w1!.clarifications).toEqual(["focus on run 2"])
    o.finishTask(id, "done")
    expect(o.steer(id, "too late")).toBeNull()
  })

  test("setResult + finishTask produce a replayable persisted log", () => {
    const o = createOrchestrator()
    const id = o.beginTask("scan templates")
    o.appendTaskLog(id, "working…")
    o.setResult(id, "2 templates found")
    o.finishTask(id, "done")
    const evs = agentEvents(id)
    expect(evs.some((e) => e.kind === "clarify" || e.kind === "log" || e.kind === "status")).toBe(true)
    expect(evs.some((e) => e.kind === "result" && e.text.includes("2 templates"))).toBe(true)
    const p = join(agentsTmp, `task-${id}.jsonl`)
    expect(existsSync(p)).toBe(true)
    const raw = readFileSync(p, "utf8").trim()
    expect(raw.split("\n").length).toBeGreaterThan(2)
  })

  test("restoreFromDisk rebuilds finished workers after a TUI restart", () => {
    const first = createOrchestrator()
    const doneId = first.beginTask("finished before restart")
    first.finishTask(doneId, "done")
    const lostId = first.beginTask("mid-flight when the TUI died")

    const second = createOrchestrator()
    second.start()
    const board = second.state(null)
    const done = board.workers.find((w) => w.id === doneId)
    expect(done?.status).toBe("done")
    const lost = board.workers.find((w) => w.id === lostId)
    expect(lost?.status).toBe("killed")
    expect(lost?.log.some((l) => l.text.includes("interrupted by TUI restart"))).toBe(true)
    second.dispose()
  })

  test("bus fans out events to subscribers", () => {
    const seen: { id: number; text: string }[] = []
    const un = subscribeAgentEvents((id, ev) => seen.push({ id, text: ev.text }))
    const o = createOrchestrator()
    const id = o.beginTask("notify test")
    un()
    expect(seen.some((s) => s.id === id && s.text.includes("notify test"))).toBe(true)
  })

  test("orchestrator state exposes clarifications on the board", () => {
    const o = createOrchestrator()
    const id = o.beginTask("long task")
    o.steer(id, "use nanoGPT_lite only")
    const st = o.state(null)
    const w = st.workers.find((x) => x.id === id)
    expect(w?.clarifications).toEqual(["use nanoGPT_lite only"])
    o.kill(id)
    expect(o.state(null).workers.find((x) => x.id === id)?.status).toBe("killed")
  })
})
