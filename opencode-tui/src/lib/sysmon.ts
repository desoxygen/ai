// Process metrics sampler for the Dashboard RES panel.
// Tracks ONLY the processes this app actually owns: the TUI itself, the
// aiscientist pipeline jobs from results/jobs.jsonl, and any spawned agent
// workers. No system-wide probes — the panel answers "what do WE consume".
// Best-effort: any failure degrades to "—" and never throws.
import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import * as os from "node:os"

export interface ProcUsage {
  pid: number
  label: string
  cpu: number
  memMb: number
}

export type ProcSample = ProcUsage[]

export interface SysStats {
  procs: ProcSample
}

export const EMPTY_SYS: SysStats = { procs: [] }

let snap: SysStats = { ...EMPTY_SYS }
const subs = new Set<(s: SysStats) => void>()

let prevCpu: Map<number, number> | null = null
let prevAt = 0
let timer: ReturnType<typeof setInterval> | null = null
let pidProvider: () => { pid: number; label: string }[] = () => []

const isWin = process.platform === "win32"
const isLinux = process.platform === "linux"

function run(cmd: string, args: string[], ms = 3000): Promise<string> {
  return new Promise((res) => {
    execFile(cmd, args, { windowsHide: true, timeout: ms, maxBuffer: 4 << 20 }, (err, stdout) => {
      res(err ? "" : stdout)
    })
  })
}

async function sample(): Promise<void> {
  const wanted = pidProvider().slice()
  const pids = [...new Set([process.pid, ...wanted.map((w) => w.pid)])].filter((p) => Number.isFinite(p) && p > 0)
  if (pids.length === 0) {
    snap = { procs: [] }
    emit()
    return
  }
  const now = Date.now()
  const dt = prevAt ? (now - prevAt) / 1000 : 0
  const rows: ProcUsage[] = []
  // cumulative CPU counters (seconds on Windows, jiffies on Linux) for diffing
  const raw = new Map<number, number>()

  if (isWin) {
    const out = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,CPU | ConvertTo-Csv -NoTypeInformation`])
    const ws = new Map<number, number>()
    for (const line of out.split("\n").slice(1)) {
      const c = line.match(/^"?(\d+)"?,"?(\d+)"?,"?([\d.,]+)"?/)
      if (!c) continue
      const pid = +c[1]
      ws.set(pid, +c[2])
      const t = parseFloat(c[3].replace(",", "."))
      if (Number.isFinite(t)) raw.set(pid, t)
    }
    for (const pid of pids) {
      const mem = ws.get(pid)
      if (mem === undefined) continue
      const prev = prevCpu?.get(pid)
      const cpu = prev !== undefined && raw.has(pid) && dt > 0 ? Math.min(999, Math.max(0, Math.round(((raw.get(pid)! - prev) / dt) * 100))) : 0
      rows.push({ pid, label: labelOf(pid, wanted), cpu, memMb: Math.round(mem / 1024 / 1024) })
    }
  } else if (isLinux) {
    const HZ = 100
    for (const pid of pids) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
        const close = stat.lastIndexOf(")")
        const f = stat.slice(close + 2).trim().split(/\s+/)
        const jif = (+f[11] || 0) + (+f[12] || 0)
        raw.set(pid, jif)
        const prev = prevCpu?.get(pid)
        const cpu = prev !== undefined && dt > 0 ? Math.min(999, Math.max(0, Math.round(((jif - prev) / HZ / dt) * 100))) : 0
        let rssKb = 0
        try {
          const status = readFileSync(`/proc/${pid}/status`, "utf8")
          rssKb = +(/^VmRSS:\s*(\d+)/m.exec(status)?.[1] ?? 0)
        } catch {}
        rows.push({ pid, label: labelOf(pid, wanted), cpu, memMb: Math.round(rssKb / 1024) })
      } catch {}
    }
  } else {
    return
  }

  prevCpu = raw
  prevAt = now
  snap = { procs: rows.sort((a, b) => b.cpu - a.cpu) }
  emit()
}

function labelOf(pid: number, wanted: { pid: number; label: string }[]): string {
  if (pid === process.pid) return "tui"
  return wanted.find((w) => w.pid === pid)?.label ?? `pid ${pid}`
}

function emit(): void {
  for (const fn of subs) fn(snap)
}

export function subscribeProcs(provider: () => { pid: number; label: string }[], fn: (s: SysStats) => void): () => void {
  pidProvider = provider
  subs.add(fn)
  fn(snap)
  if (!timer) {
    timer = setInterval(() => void sample(), 2000)
    void sample()
  }
  return () => {
    subs.delete(fn)
    if (subs.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}
