import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

export interface ExNode {
  name: string
  path: string
  dir: boolean
  depth: number
  expanded: boolean
  loaded: boolean
  children: ExNode[] | null
}

export interface ExRow {
  node: ExNode
}

const IGNORE = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "target", "__pycache__", ".pytest_cache"])

export function makeRoot(path: string, name: string): ExNode {
  return { name, path, dir: true, depth: 0, expanded: true, loaded: false, children: null }
}

export function loadChildren(node: ExNode): void {
  if (!node.dir || node.loaded) return
  let entries: { name: string; dir: boolean }[] = []
  try {
    entries = readdirSync(node.path, { withFileTypes: true })
      .filter((e) => !IGNORE.has(e.name) && !(e.name.startsWith(".") && e.name !== "."))
      .map((e) => ({ name: e.name, dir: e.isDirectory() }))
  } catch {
    entries = []
  }
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
  node.children = entries.map((e) => ({ name: e.name, path: join(node.path, e.name), dir: e.dir, depth: node.depth + 1, expanded: false, loaded: false, children: null }))
  node.loaded = true
}

export function flatten(root: ExNode, out: ExNode[] = []): ExNode[] {
  out.push(root)
  if (root.dir && root.expanded) {
    if (!root.loaded) loadChildren(root)
    for (const c of root.children ?? []) flatten(c, out)
  }
  return out
}

export function findNode(root: ExNode, path: string): ExNode | null {
  if (root.path === path) return root
  for (const c of root.children ?? []) {
    const hit = findNode(c, path)
    if (hit) return hit
  }
  return null
}

export function fileLabel(path: string): { size: string; mtime: string } {
  try {
    const st = statSync(path)
    const kb = st.size / 1024
    return {
      size: kb > 1024 ? `${(kb / 1024).toFixed(1)}M` : `${kb.toFixed(1)}K`,
      mtime: st.mtime.toTimeString().slice(0, 5),
    }
  } catch {
    return { size: "?", mtime: "" }
  }
}

export interface Preview {
  lines: string[]
  children: string[]
  note: string
}

/** Lazy text preview for the explorer right pane: first lines of a file, or child names of a dir. */
export function readPreview(path: string, dir: boolean, maxLines = 300, maxBytes = 64_000): Preview {
  try {
    if (dir) {
      let children: string[] = []
      try {
        children = readdirSync(path, { withFileTypes: true })
          .filter((e) => !IGNORE.has(e.name) && !(e.name.startsWith(".") && e.name !== "."))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort((a, b) => Number(b.endsWith("/")) - Number(a.endsWith("/")) || a.localeCompare(b))
      } catch {}
      return { lines: [], children, note: `${children.length} entries` }
    }
    const st = statSync(path)
    if (st.size === 0) return { lines: [], children: [], note: "empty" }
    const len = Math.min(st.size, maxBytes)
    const fd = openSync(path, "r")
    const buf = Buffer.alloc(len)
    try {
      readSync(fd, buf, 0, len, 0)
    } finally {
      closeSync(fd)
    }
    const text = buf.toString("utf8")
    const kb = st.size / 1024
    const size = kb > 1024 ? `${(kb / 1024).toFixed(1)}M` : `${kb.toFixed(1)}K`
    if (text.includes("\u0000")) return { lines: [], children: [], note: `binary · ${size}` }
    const all = text.split(/\r?\n/).map((l) => l.replace(/\t/g, "  ").replace(/\r$/, ""))
    const shown = all.slice(0, maxLines)
    const extra = st.size > maxBytes ? " · head" : all.length > maxLines ? ` · 1-${maxLines}/${all.length}` : ` · ${all.length} ln`
    return { lines: shown, children: [], note: `${size}${extra}` }
  } catch {
    return { lines: [], children: [], note: "unreadable" }
  }
}

export type ExAction = { type: "toggle" } | { type: "collapse-to-parent" } | { type: "edit"; path: string } | { type: "none" }

export function primaryAction(row: ExNode): ExAction {
  if (row.dir) return { type: "toggle" }
  return { type: "edit", path: row.path }
}
