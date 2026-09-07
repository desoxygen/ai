import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PROJECT_ROOT } from "./aiscientist.ts"

export interface LabelDef {
  name: string
  hex: string
}

export const LABELS: LabelDef[] = [
  { name: "red", hex: "#f87171" },
  { name: "orange", hex: "#fb923c" },
  { name: "yellow", hex: "#facc15" },
  { name: "green", hex: "#4ade80" },
  { name: "cyan", hex: "#22d3ee" },
  { name: "blue", hex: "#60a5fa" },
  { name: "purple", hex: "#c084fc" },
  { name: "pink", hex: "#f472b6" },
]

export interface Note {
  path: string
  name: string
  title: string
  labels: string[]
  preview: string
  mtime: number
}

export function labelHex(name: string): string {
  return LABELS.find((l) => l.name === name)?.hex ?? "#888888"
}

let envCache: Record<string, string> | null = null

function dotEnv(): Record<string, string> {
  if (envCache) return envCache
  envCache = {}
  try {
    for (const line of readFileSync(join(PROJECT_ROOT, ".env"), "utf8").split(/\r?\n/)) {
      if (line.trim().startsWith("#")) continue
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (m) envCache[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  } catch {}
  return envCache
}

export function vaultAiRoot(): string {
  const vault = process.env.OBSIDIAN_VAULT_PATH || dotEnv().OBSIDIAN_VAULT_PATH
  if (!vault) throw new Error("OBSIDIAN_VAULT_PATH not set in .env")
  const sub = (process.env.AISC_OBSIDIAN_ROOT || dotEnv().AISC_OBSIDIAN_ROOT || "AI/AI-Scientist")
    .split(/[\\/]+/)
    .filter(Boolean)
  return join(vault, ...sub)
}

export function notesDir(): string {
  const direct = process.env.AIS_NOTES_DIR || dotEnv().AIS_NOTES_DIR
  const dir = direct ? direct : join(vaultAiRoot(), "Notes")
  mkdirSync(dir, { recursive: true })
  return dir
}

export function sanitizeName(name: string): string {
  const s = String(name)
    .replace(/[\\/:*?"<>|#^[\]]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
  return s.slice(0, 60) || "untitled"
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "")
}

function fmTags(block: string): string[] {
  const out: string[] = []
  const lines = block.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const inline = lines[i].match(/^tags:\s*\[(.*)\]\s*$/)
    if (inline) {
      out.push(...inline[1].split(",").map(unquote).filter(Boolean))
      continue
    }
    if (/^tags:\s*$/.test(lines[i])) {
      while (i + 1 < lines.length && /^\s+-\s+(.+)/.test(lines[i + 1])) {
        out.push(unquote(lines[i + 1].match(/^\s+-\s+(.+)/)![1]))
        i++
      }
    }
  }
  return out
}

function replaceTags(block: string, tags: string[]): string {
  const rest: string[] = []
  const lines = block.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (/^tags:/.test(lines[i])) {
      if (/^tags:\s*\[.*\]\s*$/.test(lines[i])) continue
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) i++
      continue
    }
    rest.push(lines[i])
  }
  const tagLines = tags.map((t) => (t.includes(" ") ? `  - "${t}"` : `  - ${t}`))
  return ["tags:", ...tagLines, ...rest].join("\n")
}

function cleanInline(s: string): string {
  return s
    .replace(/!\[\[[^\]]*\]\]/g, "(img)")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^[-*]\s+\[[ x-]\]\s+/g, "")
    .replace(/`{1,3}/g, "")
    .replace(/[*_~]{1,3}/g, "")
    .trim()
}

export function parseNote(path: string): Note {
  const raw = readFileSync(path, "utf8")
  const m = raw.match(FM_RE)
  const body = m ? raw.slice(m[0].length) : raw
  const tags = m ? fmTags(m[1]) : []
  const labels = tags.filter((t) => t.startsWith("label/")).map((t) => t.slice("label/".length))
  const lines = body.split(/\r?\n/)
  let title = ""
  const bodyLines: string[] = []
  for (const ln of lines) {
    if (!title && /^#\s+/.test(ln)) {
      title = cleanInline(ln.replace(/^#\s+/, ""))
      continue
    }
    const c = cleanInline(ln)
    if (c) bodyLines.push(c)
  }
  const name = path.split(/[\\/]/).pop()!.replace(/\.md$/i, "")
  return {
    path,
    name,
    title: title || name,
    labels,
    preview: bodyLines.join(" ").slice(0, 220),
    mtime: statSync(path).mtimeMs,
  }
}

export function readNoteBody(path: string): string {
  const raw = readFileSync(path, "utf8")
  const m = raw.match(FM_RE)
  return (m ? raw.slice(m[0].length) : raw).trimStart()
}

export function listNotes(): Note[] {
  const dir = notesDir()
  return readdirSync(dir)
    .filter((f) => /\.md$/i.test(f))
    .map((f) => {
      try {
        return parseNote(join(dir, f))
      } catch {
        return null
      }
    })
    .filter((n): n is Note => n !== null)
    .sort((a, b) => b.mtime - a.mtime)
}

export function createNote(title: string): Note {
  const dir = notesDir()
  const stem = sanitizeName(title)
  let path = join(dir, `${stem}.md`)
  let i = 2
  while (existsSync(path)) path = join(dir, `${stem} ${i++}.md`)
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ")
  const t = sanitizeName(title)
  writeFileSync(path, `---\ntags:\n  - note\ncreated: "${stamp}"\n---\n# ${t}\n\n`, "utf8")
  return parseNote(path)
}

export function deleteNote(path: string): void {
  rmSync(path, { force: true })
}

export function setLabels(path: string, labels: string[]): void {
  const uniq = [...new Set(labels.filter((l) => LABELS.some((L) => L.name === l)))]
  const tags = ["note", ...uniq.map((l) => `label/${l}`)]
  const raw = readFileSync(path, "utf8")
  const m = raw.match(FM_RE)
  const tagLines = tags.map((t) => `  - ${t}`).join("\n")
  const out = m ? `---\n${replaceTags(m[1], tags)}\n---\n${raw.slice(m[0].length)}` : `---\ntags:\n${tagLines}\n---\n${raw}`
  writeFileSync(path, out, "utf8")
}

export function toggleLabel(path: string, color: string): Note {
  const note = parseNote(path)
  const next = note.labels.includes(color) ? note.labels.filter((l) => l !== color) : [...note.labels, color]
  setLabels(path, next)
  return parseNote(path)
}

export function nextLabelColor(current: string[]): string {
  const free = LABELS.map((l) => l.name).find((n) => !current.includes(n))
  return free ?? current[current.length - 1] ?? "red"
}

export function fmtNoteTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
