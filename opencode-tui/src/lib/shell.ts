import { spawn } from "node:child_process"

export interface ShellResult {
  code: number
  output: string[]
}

export function runShell(cmd: string, cwd: string, timeoutMs = 15_000): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, windowsHide: true })
    let acc = ""
    const killTree = () => {
      // cmd.exe /bin/sh wrappers survive child.kill() — the whole tree must go,
      // or timed-out commands keep running as orphans.
      if (child.pid === undefined) return
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
      } else {
        try {
          child.kill("SIGKILL")
        } catch {}
      }
    }
    const kill = setTimeout(() => {
      killTree()
      finish(124)
    }, timeoutMs)
    let settled = false
    const finish = (code: number) => {
      if (settled) return
      settled = true
      clearTimeout(kill)
      resolve({ code, output: acc.split(/\r?\n/).filter((l) => l.length > 0).slice(0, 40) })
    }
    child.stdout?.on("data", (d) => (acc += d.toString()))
    child.stderr?.on("data", (d) => (acc += d.toString()))
    child.on("error", (err) => {
      acc += String((err as Error).message ?? err)
      finish(1)
    })
    child.on("close", (code) => finish(code ?? 0))
  })
}
