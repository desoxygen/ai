import { C } from "../theme.ts"
import { workboard, type ProjectInfo, type StageState } from "../lib/project.ts"
import type { Worker } from "../lib/orchestrator.ts"

function trunc(s: string, w: number): string {
  if (w <= 1) return "…"
  return s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s
}

function StageItem({ s, first }: { s: StageState; first: boolean }) {
  const glyph = s.status === "done" ? "✓" : s.status === "running" ? "▶" : s.status === "fail" ? "✗" : "·"
  const col = s.status === "done" ? C.ok : s.status === "running" ? C.warn : s.status === "fail" ? C.err : C.dim
  return (
    <span>
      {!first && <span fg={C.border}>{" → "}</span>}
      <span fg={col}>{`${glyph} ${s.key}`}</span>
    </span>
  )
}

export function workerDot(w: Worker): { glyph: string; col: string } {
  if (w.status === "running") return { glyph: "●", col: C.ok }
  if (w.status === "done") return { glyph: "●", col: C.ok }
  if (w.status === "failed" || w.status === "killed") return { glyph: "●", col: C.err }
  return { glyph: "○", col: C.dim }
}

function WorkerPill({ w }: { w: Worker }) {
  const { glyph, col } = workerDot(w)
  const pct = w.kind === "job" ? "" : w.progress < 0 ? " ⋯" : ` ${Math.round(w.progress * 100)}%`
  return (
    <span>
      <span fg={col}>{glyph}</span>
      <span fg={w.status === "running" ? C.text : C.faint}>{` ${w.name}${pct}`}</span>
    </span>
  )
}

export function ProjectPanel({
  info,
  w,
  projectsCount,
  workers,
  onPick,
  onContinue,
}: {
  info: ProjectInfo | null
  w: number
  projectsCount: number
  workers: Worker[]
  onPick: () => void
  onContinue?: () => void
}) {
  if (!info) {
    return (
      <box
        width={w}
        marginTop={1}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={C.warn}
        backgroundColor={C.panel}
        paddingLeft={1}
        paddingRight={1}
        onMouseUp={onPick}
      >
        <text>
          <b fg={C.warn}>{"no project"}</b>
          <span fg={C.dim}>{" — P opens an existing one, N creates a new project from the wizard"}</span>
        </text>
      </box>
    )
  }
  const inner = w - 4
  const wb = workboard(info, workers)
  const colW = Math.max(14, Math.floor((inner - 4) / 3))
  const board = [wb.done, wb.doing, wb.planned]
  const heads = ["done", "doing", "planned"]
  const headCols = [C.ok, C.warn, C.dim]
  const active = workers.filter((x) => x.status === "running" || x.status === "queued")
  const rightBits = `${info.totalRuns} run${info.totalRuns === 1 ? "" : "s"}${info.lastRunId ? ` · ${info.lastRunId}` : ""} · ${onContinue ? "click to continue" : "/project"} · ${projectsCount} total`
  const leftBudget = Math.max(8, inner - rightBits.length - 8)
  const ideaBits = info.ideas
    ? `${info.ideas.total} ideas · ${Object.entries(info.ideas.byStatus).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(" · ")}`
    : "not tracked yet"

  return (
    <box
      width={w}
      marginTop={1}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={C.border}
      backgroundColor={C.panel}
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={onContinue}
    >
      <box flexDirection="row" justifyContent="space-between" onMouseUp={onPick}>
        <text>
          <span fg={C.dim}>{"research ▸ "}</span>
          <b fg={C.primary}>{info.name}</b>
          {info.running > 0 && <b fg={C.warn}>{`  ⚇${info.running}`}</b>}
        </text>
        <text>
          <span fg={C.faint}>{trunc(info.description, Math.max(8, inner - info.name.length - 22))}</span>
        </text>
      </box>
      <box flexDirection="row">
        <text>
          <span fg={C.dim}>{"stage  "}</span>
          {info.stages.map((s, i) => (
            <StageItem key={s.key} s={s} first={i === 0} />
          ))}
        </text>
      </box>
      <box flexDirection="row" marginTop={0}>
        {heads.map((h, i) => (
          <box key={h} width={colW}>
            <text selectable={false}>
              <b fg={headCols[i]}>{trunc(h, colW)}</b>
            </text>
          </box>
        ))}
      </box>
      {Array.from({ length: Math.max(wb.done.length, wb.doing.length, wb.planned.length) }).map((_, row) => (
        <box key={row} flexDirection="row">
          {board.map((col, ci) => (
            <box key={ci} width={colW}>
              <text selectable={false}>
                <span fg={ci === 0 ? C.faint : ci === 1 ? C.text : C.dim}>{trunc(col[row] ?? "", colW)}</span>
              </text>
            </box>
          ))}
        </box>
      ))}
      <box flexDirection="row" justifyContent="space-between">
        <text selectable={false}>
          <span fg={C.dim}>{"ideas  "}</span>
          <span fg={C.faint}>{trunc(ideaBits, leftBudget)}</span>
        </text>
        <text selectable={false}>
          <span fg={C.dim}>{trunc(rightBits, Math.max(10, inner - leftBudget - 8))}</span>
        </text>
      </box>
      <box flexDirection="row">
        <text>
          <span fg={C.dim}>{"agents "}</span>
          {active.length === 0 && <span fg={C.faint}>{"idle — open 5 Agents to delegate"}</span>}
          {active.slice(0, 4).map((wk, i) => (
            <span key={wk.id}>
              {i > 0 && <span fg={C.border}>{" · "}</span>}
              <WorkerPill w={wk} />
            </span>
          ))}
          {active.length > 4 && <span fg={C.dim}>{` +${active.length - 4}`}</span>}
        </text>
      </box>
    </box>
  )
}
