// Session persistence: chat sessions survive TUI restarts. Sessions are
// stored as plain JSON (messages are plain objects) in results/sessions/.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { PROJECT_ROOT } from "./aiscientist.ts"

export interface StoredSession {
  id: number
  title: string
  createdAt: number
  messages: unknown[]
}

const dir = () => {
  const d = process.env.AISC_SESSIONS_DIR || join(PROJECT_ROOT, "results", "sessions")
  mkdirSync(d, { recursive: true })
  return d
}

const path = (id: number) => join(dir(), `session-${id}.json`)

export function saveSession(s: StoredSession): void {
  try {
    writeFileSync(path(s.id), JSON.stringify(s))
  } catch {}
}

export function loadSession(id: number): StoredSession | null {
  try {
    const p = path(id)
    if (!existsSync(p)) return null
    const s = JSON.parse(readFileSync(p, "utf8")) as StoredSession
    if (!Array.isArray(s.messages)) return null
    return s
  } catch {
    return null
  }
}

export function listSessions(): { id: number; title: string; createdAt: number }[] {
  try {
    return readdirSync(dir())
      .filter((f) => /^session-\d+\.json$/.test(f))
      .map((f) => {
        try {
          const s = JSON.parse(readFileSync(join(dir(), f), "utf8")) as StoredSession
          return { id: s.id, title: s.title || `session ${s.id}`, createdAt: s.createdAt || 0 }
        } catch {
          return null
        }
      })
      .filter((x): x is { id: number; title: string; createdAt: number } => x !== null)
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export function latestSessionId(): number | null {
  const all = listSessions()
  return all[0]?.id ?? null
}

export function deleteSession(id: number): void {
  try {
    if (existsSync(path(id))) unlinkSync(path(id))
  } catch {}
}
