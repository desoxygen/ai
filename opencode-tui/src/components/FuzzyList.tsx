import { useMemo } from "react"
import { C } from "../theme.ts"
import { highlight } from "../lib/fuzzy.ts"
import { Dialog } from "./Dialog.tsx"

export interface FuzzyRow {
  id: string
  name: string
  desc?: string
  hint?: string
  category?: string
  indices?: number[]
  prefix?: string
  nameColor?: string
}

type Line = { kind: "cat"; text: string } | { kind: "row"; row: FuzzyRow; sel: boolean }

export function FuzzyList({
  title,
  query,
  rows,
  index,
  maxVisible = 9,
  width,
  emptyText = "No results found",
}: {
  title: string
  query: string
  rows: FuzzyRow[]
  index: number
  maxVisible?: number
  width: number
  emptyText?: string
}) {
  const { lines, windowStart } = useMemo(() => {
    const ls: Line[] = []
    const dataAt: number[] = []
    let prevCat: string | undefined
    rows.forEach((r, i) => {
      if (r.category && r.category !== prevCat) {
        ls.push({ kind: "cat", text: r.category })
        prevCat = r.category
      }
      dataAt.push(ls.length)
      ls.push({ kind: "row", row: r, sel: i === index })
    })
    let start = 0
    const sel = dataAt[Math.min(index, dataAt.length - 1)] ?? 0
    if (sel > maxVisible - 2) start = sel - maxVisible + 2
    return { lines: ls.slice(start, start + maxVisible), windowStart: start }
  }, [rows, index, maxVisible])

  const hidden = Math.max(0, index - windowStart)
  const remaining = rows.length - (lines.filter((l) => l.kind === "row").length + hidden)

  // opentui flex-shrink wraps long descs *into* the name column ("nanoGPT_li/te"),
  // so truncate here and let every row render as exactly one line
  const fitDesc = (r: FuzzyRow) => {
    if (!r.desc) return r.desc
    // overhead: cursor box (2) + border+padding (4) + " " before name + safety (3)
    const used = 9 + (r.prefix ? 2 : 0) + r.name.length + 3 + (r.hint ? r.hint.length + 2 : 0)
    const avail = width - used
    if (avail < 8) return undefined
    if (r.desc.length <= avail) return r.desc
    let cut = r.desc.slice(0, avail + 1)
    // roll back only when the boundary chopped a word mid-way
    if (cut.length < r.desc.length && !/\s/.test(r.desc[cut.length])) {
      const w = cut.lastIndexOf(" ")
      if (w > avail * 0.6) cut = cut.slice(0, w)
    }
    return `${cut.trimEnd()}…`
  }

  return (
    <Dialog title={title} escHint="esc close" width={width}>
      <box flexDirection="row" marginBottom={0}>
        <text>
          <span fg={C.faint}>{"┃ "}</span>
          <b fg={C.faint}>{"Search "}</b>
          <span fg={C.text}>{query}</span>
          <span fg={C.primary}>{"▏"}</span>
        </text>
      </box>
      {lines.length === 0 && (
        <box flexDirection="row" paddingLeft={1}>
          <text>
            <span fg={C.faint}>{emptyText}</span>
          </text>
        </box>
      )}
      {lines.map((l, i) =>
        l.kind === "cat" ? (
          <text key={`c${i}`}>
            <span fg={C.faint}>{l.text}</span>
          </text>
        ) : (
          <box key={l.row.id} flexDirection="row" backgroundColor={l.sel ? C.primary : "transparent"} paddingLeft={0}>
            <box width={2}>
              <text>
                <b fg={l.sel ? C.bg : C.dim}>{l.sel ? "❯ " : "  "}</b>
              </text>
            </box>
            <text>
              {l.row.prefix && <span fg={l.sel ? C.bg : C.faint}>{`${l.row.prefix} `}</span>}
              {highlight(l.row.name, l.row.indices ?? []).map((s, j) =>
                s.hit ? (
                  <b key={j} fg={l.sel ? C.bg : C.text}>
                    {s.text}
                  </b>
                ) : (
                  <span key={j} fg={l.sel ? C.bg : (l.row.nameColor ?? C.faint)}>
                    {s.text}
                  </span>
                ),
              )}
            </text>
            {l.row.desc && (() => { const d = fitDesc(l.row); return d ? (
              <text>
                <span fg={l.sel ? C.bg : C.dim}>{`   ${d}`}</span>
              </text>
            ) : null })()}
            <box flexGrow={1} />
            {l.row.hint && (
              <text>
                <span fg={l.sel ? C.bg : C.dim}>{l.row.hint}</span>
              </text>
            )}
          </box>
        ),
      )}
      {remaining > 0 && (
        <text>
          <span fg={C.dim}>{`  … ${remaining} more`}</span>
        </text>
      )}
      <box border={["top"]} borderColor={C.borderSubtle} marginTop={0}>
        <text>
          <span fg={C.dim}>{"↑↓ navigate · enter select · type to filter"}</span>
        </text>
      </box>
    </Dialog>
  )
}
