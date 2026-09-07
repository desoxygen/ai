import { C } from "../theme.ts"
import { fmtElapsed } from "../lib/project.ts"
import type { OrchState, Worker } from "../lib/orchestrator.ts"

function trunc(s: string, w: number): string {
  if (w <= 1) return "…"
  return s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s
}

function bar(p: number): string {
  if (p < 0) return "░⋯⋯⋯⋯░"
  const n = 8
  const f = Math.max(0, Math.min(n, Math.round(p * n)))
  return `${"█".repeat(f)}${"░".repeat(n - f)}`
}

function statusCol(w: Worker): string {
  if (w.status === "failed" || w.status === "killed") return C.err
  if (w.status === "running" || w.status === "done") return C.ok
  return C.dim
}

function statusGlyph(w: Worker): string {
  if (w.status === "queued") return "○"
  if (w.status === "running") return "●"
  if (w.status === "done") return "●"
  return "✗"
}

function stateWord(w: Worker): string {
  if (w.status === "queued") return "queued"
  if (w.status === "running") return "running"
  if (w.status === "done") return "done"
  return w.status
}

export function AgentsWorkspace({
  state,
  project,
  focus,
  availW,
  visibleHeight,
  prompt,
  promptMode,
  clarifyTarget,
  onSelect,
}: {
  state: OrchState
  project: string
  focus: number
  availW: number
  visibleHeight: number
  prompt: string | null
  promptMode?: "delegate" | "clarify" | "ask"
  clarifyTarget?: number | null
  onSelect?: (w: Worker) => void
}) {
  const workers = state.workers
  const running = workers.filter((w) => w.status === "running").length
  const dead = workers.filter((w) => w.status === "failed" || w.status === "killed").length
  const nameW = 16
  const taskW = Math.max(20, availW - 1 - 2 - nameW - 8 - 9 - 7 - 2 - 6 - 3)
  const main = state.main
  const logs = main.log.slice(-Math.min(4, Math.max(2, Math.floor(visibleHeight / 2))))
  const rowsH = Math.max(3, visibleHeight - (logs.length + 6) - (prompt ? 2 : 0) - 2)
  const start = Math.max(0, Math.min(focus - Math.floor(rowsH / 2), Math.max(0, workers.length - rowsH)))
  const win = workers.slice(start, start + rowsH)

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <text>
          <b fg={C.text}>{"⚇ agent board"}</b>
          <span fg={C.dim}>{` · ${project || "—"}`}</span>
        </text>
        <text>
          <span fg={C.ok}>{`●${running + workers.filter((w) => w.status === "done").length} ok`}</span>
          <span fg={C.dim}>{" · "}</span>
          <span fg={dead > 0 ? C.err : C.dim}>{`●${dead} dead`}</span>
        </text>
      </box>

      <box marginTop={1} flexDirection="column" border borderStyle="rounded" borderColor={main.status === "idle" ? C.border : C.primary} backgroundColor={C.panel} paddingLeft={1} paddingRight={1}>
        <text>
          <b fg={C.primary}>{"◉ main agent"}</b>
          <span fg={C.dim}>{" orchestrator "}</span>
          <b fg={main.status === "delegating" ? C.warn : main.status === "watching" ? C.ok : C.faint}>{`· ${main.status}`}</b>
        </text>
        <text>
          <span fg={C.dim}>{"focus  "}</span>
          <span fg={C.text}>{trunc(main.focus, availW - 12)}</span>
        </text>
        {logs.map((l, i) => (
          <text key={`${l.ts}-${i}`} selectable={false}>
            <span fg={C.faint}>{`       ${trunc(l.text, availW - 12)}`}</span>
          </text>
        ))}
        {logs.length === 0 && (
          <text>
            <span fg={C.faint}>{"       no decisions yet — delegate a task with d"}</span>
          </text>
        )}
      </box>

      {prompt !== null && (
        <box flexDirection="row" marginTop={1}>
          <text>
            <span fg={C.primary}>{"┃ "}</span>
            <b fg={C.text}>{promptMode === "clarify" ? "s" : "d"}</b>
            <span fg={C.text}>{prompt}</span>
            <span fg={C.primary}>{"▏"}</span>
            <span fg={C.dim}>
              {promptMode === "clarify"
                ? `  clarification for worker #${clarifyTarget ?? "—"} — enter restarts it with the new context`
                : promptMode === "ask"
                  ? `  follow-up for worker #${clarifyTarget ?? "—"} — enter dispatches with its result as context`
                  : "  task for the main agent — enter spawns a worker"}
            </span>
          </text>
        </box>
      )}

      <box flexDirection="row" marginTop={1}>
        <text>
          <span fg={C.dim}>{`    ${"worker".padEnd(16)}${"task".padEnd(taskW)}${"state".padEnd(9)}${"progress".padEnd(9)}time  src`}</span>
        </text>
      </box>
      {win.map((wk, i) => {
        const sel = start + i === focus
        const age = wk.endedAt ? wk.endedAt - wk.bornAt : Date.now() - wk.bornAt
        const time = wk.status === "running" && wk.kind !== "job" ? `${Math.floor(((Date.now() - (wk.startedAt ?? wk.bornAt)) / 1000))}s` : fmtElapsed(age)
        return (
          <box key={wk.id} flexDirection="row" backgroundColor={sel ? C.selected : "transparent"} onMouseUp={() => onSelect?.(wk)}>
            <text>
              <b fg={sel ? C.primary : C.dim}>{sel ? "❯ " : "  "}</b>
              <span fg={statusCol(wk)}>{`${statusGlyph(wk)} `}</span>
              <span fg={sel ? C.text : C.faint}>{`${wk.name.padEnd(nameW - 1)} `}</span>
              <span fg={C.faint}>{`${trunc(wk.task, taskW).padEnd(taskW)}`}</span>
              <span fg={statusCol(wk)}>{` ${stateWord(wk).padEnd(7)} `}</span>
              <span fg={wk.status === "running" ? C.warn : C.dim}>{`${bar(wk.progress)} `}</span>
              <span fg={C.dim}>{`${time.padEnd(6)}`}</span>
              <span fg={wk.kind === "job" ? C.info : C.border}>{wk.kind}</span>
            </text>
          </box>
        )
      })}
      {workers.length === 0 && prompt === null && (
        <text>
          <span fg={C.dim}>{"  no workers yet — the main agent spawns them on demand (d, or send a chat message)"}</span>
        </text>
      )}

      <box flexGrow={1} />
      <box border={["top"]} borderColor={C.border}>
        <text selectable={false}>
          <span fg={C.dim}>{"↑↓ select · enter log · d delegate · s clarify · a ask · x kill · r resync"}</span>
        </text>
      </box>
    </box>
  )
}
