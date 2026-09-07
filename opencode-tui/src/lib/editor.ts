import { spawn } from "node:child_process"
import type { CliRenderer } from "@opentui/core"

export function editorCommand(): string[] {
  const env = (process.env.EDITOR || process.env.VISUAL || "").trim()
  if (env) return env.split(/\s+/)
  // nvim is the natural default in a terminal, but on stock Windows nothing
  // terminal-native exists — notepad does.
  return process.platform === "win32" ? ["notepad"] : ["nvim"]
}

export async function openInEditor(renderer: CliRenderer, file: string): Promise<{ ok: boolean; error?: string }> {
  const [cmd, ...prefix] = editorCommand()
  renderer.suspend()
  let err: string | undefined
  try {
    await new Promise<void>((res) => {
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(cmd, [...prefix, file], { stdio: "inherit", cwd: process.cwd(), windowsHide: false })
      } catch (e) {
        err = String((e as Error).message ?? e)
        res()
        return
      }
      let closed = false
      child.on("error", (e) => {
        err = String(e.message ?? e)
        if (!closed) {
          closed = true
          res()
        }
      })
      child.on("close", () => {
        if (!closed) {
          closed = true
          res()
        }
      })
    })
  } finally {
    renderer.resume()
    renderer.requestRender()
  }
  return err ? { ok: false, error: err } : { ok: true }
}
