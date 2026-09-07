import { readdir } from "node:fs/promises"
import { join, relative } from "node:path"

const IGNORE = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "target", ".next", ".opencode", "__pycache__", "review_iclr_bench", "example_papers", "results"])
const MAX_FILES = 4000
const MAX_DEPTH = 5

export async function scanFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  while (stack.length && out.length < MAX_FILES) {
    const { dir, depth } = stack.pop()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) break
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH && !IGNORE.has(e.name) && !e.name.startsWith(".")) stack.push({ dir: full, depth: depth + 1 })
      } else if (e.isFile() && !e.name.startsWith(".")) {
        out.push(relative(root, full).replace(/\\/g, "/"))
      }
    }
  }
  return out.sort()
}
