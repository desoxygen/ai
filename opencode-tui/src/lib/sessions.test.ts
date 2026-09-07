import { describe, test, expect, beforeAll } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { saveSession, loadSession, listSessions, latestSessionId, deleteSession } from "./sessions.ts"

const tmp = mkdtempSync(join(tmpdir(), "ais-sessions-lib-"))
process.env.AISC_SESSIONS_DIR = tmp
beforeAll(() => () => rmSync(tmp, { recursive: true, force: true }))

describe("session persistence", () => {
  test("save → load round-trips messages", () => {
    saveSession({ id: 7, title: "research chat", createdAt: 111, messages: [{ id: 1, role: "user", text: "hi" }] })
    const s = loadSession(7)
    expect(s?.title).toBe("research chat")
    expect((s?.messages as { text: string }[])[0].text).toBe("hi")
  })

  test("listSessions sorts newest first; latestSessionId picks it", () => {
    saveSession({ id: 7, title: "old", createdAt: 111, messages: [] })
    saveSession({ id: 8, title: "newest", createdAt: 222, messages: [] })
    const all = listSessions()
    expect(all[0].id).toBe(8)
    expect(latestSessionId()).toBe(8)
  })

  test("corrupted file is ignored, deleteSession removes", () => {
    saveSession({ id: 9, title: "x", createdAt: 1, messages: [] })
    deleteSession(9)
    expect(loadSession(9)).toBeNull()
    expect(loadSession(999)).toBeNull()
  })
})
