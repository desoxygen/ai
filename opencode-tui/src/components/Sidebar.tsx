import { C, CONTEXT_WINDOW, SPARK, VERSION } from "../theme.ts"

export interface FileRow {
  path: string
  add: number
  del: number
}

export interface WorkingRow {
  glyph: string
  color: "warn" | "ok" | "info" | "dim"
  text: string
  sub?: string
}

function trunc(s: string, w: number): string {
  return s.length > w ? `${s.slice(0, w - 1)}…` : s
}

export function Sidebar({
  sessionTitle,
  ctxK,
  cost,
  spark,
  files,
  todos,
  filesOpen,
  todosOpen,
  cwd,
  branch,
  working,
  onToggleFiles,
  onToggleTodos,
}: {
  sessionTitle: string
  ctxK: number
  cost: number
  spark: number[]
  files: FileRow[]
  todos: { text: string; status: "pending" | "in_progress" | "done" }[]
  filesOpen: boolean
  todosOpen: boolean
  cwd: string
  branch: string | null
  working: WorkingRow[]
  onToggleFiles: () => void
  onToggleTodos: () => void
}) {
  const pct = Math.min(100, Math.round((ctxK / CONTEXT_WINDOW) * 100))
  const max = Math.max(1, ...spark)
  return (
    <box
      width={42}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={C.panel}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      border={["left"]}
      borderColor={C.borderSubtle}
    >
      <text>
        <b fg={C.text}>{sessionTitle}</b>
      </text>
      <box marginTop={0} border={["bottom"]} borderColor={C.borderSubtle} />

      <box marginTop={1}>
        <text>
          <b fg={C.primary}>{"▸ working on"}</b>
        </text>
      </box>
      {working.length === 0 && (
        <text>
          <span fg={C.dim}>{"  idle — /delegate or /run to start"}</span>
        </text>
      )}
      {working.slice(0, 4).map((w, i) => (
        <text key={i}>
          <span fg={w.color === "warn" ? C.warn : w.color === "ok" ? C.ok : w.color === "info" ? C.info : C.dim}>{`  ${w.glyph} `}</span>
          <span fg={w.color === "dim" ? C.dim : C.text}>{trunc(w.text, 32)}</span>
          {w.sub && <span fg={C.dim}>{` ${w.sub}`}</span>}
        </text>
      ))}

      <box marginTop={1}>
        <text>
          <b fg={C.faint}>{"Context"}</b>
        </text>
      </box>
      <text>
        <span fg={pct >= 80 ? C.warn : C.text}>{`${(ctxK / 1000).toFixed(1)}k tokens`}</span>
        <span fg={C.dim}>{` · ${pct}% used`}</span>
      </text>
      <text>
        <span fg={C.dim}>{`$${cost.toFixed(2)} spent`}</span>
      </text>
      <text>
        <span fg={C.primary}>{spark.map((v) => SPARK[Math.min(SPARK.length - 1, Math.round((v / max) * (SPARK.length - 1)))]).join("")}</span>
        <span fg={C.dim}>{" tok/s"}</span>
      </text>

      <box marginTop={1} onMouseUp={onToggleFiles}>
        <text>
          <b fg={C.faint}>{`${filesOpen ? "▼" : "▶"} Modified (${files.length})`}</b>
        </text>
      </box>
      {filesOpen &&
        (files.length === 0 ? (
          <text>
            <span fg={C.dim}>{"  nothing yet"}</span>
          </text>
        ) : (
          files.slice(0, 6).map((f) => (
            <text key={f.path}>
              <span fg={C.faint}>{f.path.length > 26 ? `…${f.path.slice(-25)}` : f.path.padEnd(26)}</span>
              <span fg={C.ok}>{` +${f.add}`}</span>
              <span fg={C.err}>{` -${f.del}`}</span>
            </text>
          ))
        ))}

      <box marginTop={1} onMouseUp={onToggleTodos}>
        <text>
          <b fg={C.faint}>{`${todosOpen ? "▼" : "▶"} Todo (${todos.filter((t) => t.status === "done").length}/${todos.length})`}</b>
        </text>
      </box>
      {todosOpen &&
        todos.slice(0, 8).map((t, i) => {
          const icon = t.status === "done" ? "✓" : t.status === "in_progress" ? "•" : " "
          const col = t.status === "done" ? C.dim : t.status === "in_progress" ? C.warn : C.faint
          return (
            <text key={i}>
              <span fg={col}>{`[${icon}] `}</span>
              <span fg={t.status === "done" ? C.dim : C.text}>{t.text}</span>
            </text>
          )
        })}

      <box flexGrow={1} />
      <box border={["top"]} borderColor={C.borderSubtle}>
        <text>
          <span fg={C.dim}>{`${cwd}${branch ? `:${branch}` : ""}`}</span>
        </text>
        <text>
          <span fg={C.primary}>{"⌗ "}</span>
          <span fg={C.dim}>{"opencode "}</span>
          <span fg={C.faint}>{VERSION}</span>
        </text>
      </box>
    </box>
  )
}
