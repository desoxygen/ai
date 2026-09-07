import { readFile } from "node:fs/promises"
import { join } from "node:path"

export async function gitBranch(root: string): Promise<string | null> {
  try {
    const head = await readFile(join(root, ".git", "HEAD"), "utf8")
    const m = head.match(/^ref: refs\/heads\/(.+)$/m)
    if (m) return m[1].trim()
    const detached = head.trim().slice(0, 7)
    return detached || null
  } catch {
    return null
  }
}
