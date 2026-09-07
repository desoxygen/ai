import { basename } from "node:path"
import { C } from "../theme.ts"
import { fileLabel, readPreview, type ExNode } from "../lib/explorer.ts"

function LineStyle({ line }: { line: string }) {
  const t = line.trimStart()
  if (/^#{1,4}\s/.test(t)) return C.primary
  if (/^(\/\/|\*|#|--|%|;)\s?\*/.test(t) || /^\s*#(?!include|!|define)/.test(line) || /^\/\//.test(t)) return C.dim
  if (/^(export async function|async function|function|class|def|pub |func |import |from |const |let |export )/.test(t)) return C.info
  if (/^[-*▸•]\s/.test(t) || /^[}>]\s/.test(t)) return C.faint
  return C.text
}

function PreviewPane({ node, w, h }: { node: ExNode | null; w: number; h: number }) {
  if (!node) {
    return (
      <box width={w} flexDirection="column" border={["left"]} borderColor={C.border} paddingLeft={1}>
        <text>
          <span fg={C.dim}>{"nothing selected"}</span>
        </text>
      </box>
    )
  }
  const info = !node.dir ? fileLabel(node.path) : null
  const prev = readPreview(node.path, node.dir, Math.max(6, h - 4))
  const inner = w - 6
  return (
    <box width={w} flexDirection="column" border={["left"]} borderColor={C.border} paddingLeft={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text>
          <b fg={C.text}>{node.name}</b>
          {node.dir && <span fg={C.info}>{" /"}</span>}
        </text>
        <text>
          <span fg={C.faint}>{prev.note}{info?.mtime ? ` · ${info.mtime}` : ""}</span>
        </text>
      </box>
      {node.dir ? (
        <>
          {prev.children.length === 0 && (
            <text>
              <span fg={C.faint}>{"— пусто —"}</span>
            </text>
          )}
          {prev.children.slice(0, Math.max(1, h - 4)).map((c, i) => (
            <text key={i}>
              <span fg={c.endsWith("/") ? C.info : C.faint}>{c}</span>
            </text>
          ))}
          {prev.children.length > h - 4 && (
            <text>
              <span fg={C.dim}>{`… +${prev.children.length - (h - 4)}`}</span>
            </text>
          )}
        </>
      ) : (
        prev.lines.slice(0, Math.max(1, h - 4)).map((ln, i) => (
          <text key={i}>
            <span fg={C.border}>{`${String(i + 1).padStart(3)} `}</span>
            <span fg={LineStyle({ line: ln })}>{ln.length > inner ? `${ln.slice(0, inner - 1)}…` : ln || " "}</span>
          </text>
        ))
      )}
    </box>
  )
}

export function Explorer({
  root,
  rows,
  cursor,
  visibleHeight,
  filterActive,
  filterQuery,
  filterHits,
  filterIdx,
  availW = 120,
}: {
  root: string
  rows: ExNode[]
  cursor: number
  visibleHeight: number
  filterActive: boolean
  filterQuery: string
  filterHits: string[]
  filterIdx: number
  availW?: number
}) {
  const vh = Math.max(3, visibleHeight)

  if (filterActive) {
    const fStart = Math.max(0, Math.min(filterIdx - Math.floor(vh / 2), filterHits.length - vh))
    const win = filterHits.slice(fStart, fStart + vh)
    return (
      <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
        <box flexDirection="row">
          <text>
            <span fg={C.primary}>{"┃ "}</span>
            <b fg={C.text}>{"/"}</b>
            <span fg={C.text}>{filterQuery}</span>
            <span fg={C.primary}>{"▏"}</span>
          </text>
        </box>
        {win.map((path, i) => {
          const abs = fStart + i
          const name = path.split(/[\\/]/).pop() ?? path
          const m = name.toLowerCase().indexOf(filterQuery.toLowerCase())
          return (
            <box key={path} flexDirection="row" backgroundColor={abs === filterIdx ? C.selected : "transparent"} paddingLeft={0}>
              <text>
                <b fg={abs === filterIdx ? C.primary : C.dim}>{abs === filterIdx ? "❯ " : "  "}</b>
                <span fg={C.info}>{path.slice(0, path.length - name.length)}</span>
                {m >= 0 ? (
                  <>
                    <span fg={C.faint}>{name.slice(0, m)}</span>
                    <b fg={C.text}>{name.slice(m, m + filterQuery.length)}</b>
                    <span fg={C.faint}>{name.slice(m + filterQuery.length)}</span>
                  </>
                ) : (
                  <span fg={C.faint}>{name}</span>
                )}
              </text>
            </box>
          )
        })}
        {filterHits.length === 0 && (
          <text>
            <span fg={C.dim}>{"no matches"}</span>
          </text>
        )}
        <box flexGrow={1} />
        <box border={["top"]} borderColor={C.border}>
          <text>
            <span fg={C.dim}>{"type to filter · enter open in $EDITOR · esc back to tree"}</span>
          </text>
        </box>
      </box>
    )
  }

  const start = Math.max(0, Math.min(cursor - Math.floor(vh / 2), rows.length - vh))
  const win = rows.slice(start, start + vh)
  const cur = rows[Math.min(cursor, rows.length - 1)] ?? null
  const treeW = Math.max(28, Math.min(46, Math.floor((availW - 3) * 0.36)))
  const prevW = Math.max(24, availW - 2 - treeW - 2)

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text>
          <b fg={C.text}>{`⇄ ${basename(root)}`}</b>
          <span fg={C.dim}>{` — ${rows.length} items visible`}</span>
        </text>
        <text>
          <span fg={C.dim}>{`${start + 1}–${Math.min(rows.length, start + vh)} of ${rows.length}`}</span>
        </text>
      </box>
      <box flexDirection="row" flexGrow={1}>
        <box width={treeW} flexDirection="column">
          {win.map((n, i) => {
            const abs = start + i
            const sel = abs === cursor
            const icon = n.dir ? (n.expanded ? "▾ " : "▸ ") : "· "
            const label = `${icon}${n.name}`
            const maxLabel = treeW - 3 - n.depth * 2 - 6
            return (
              <box key={n.path} flexDirection="row" backgroundColor={sel ? C.selected : "transparent"}>
                <text>
                  <b fg={sel ? C.primary : C.dim}>{sel ? "❯ " : "  "}</b>
                  <span fg={C.dim}>{"  ".repeat(n.depth)}</span>
                  <span fg={n.dir ? C.info : sel ? C.text : C.faint}>{label.length > maxLabel ? `${label.slice(0, maxLabel - 1)}…` : label}</span>
                  {n.dir && n.children && n.children.length > 0 && (
                    <span fg={C.dim}>{`   ${n.children.length}`}</span>
                  )}
                </text>
              </box>
            )
          })}
        </box>
        <PreviewPane node={cur} w={prevW} h={vh} />
      </box>
      <box border={["top"]} borderColor={C.border}>
        <box flexDirection="row" justifyContent="space-between">
          <text>
            <span fg={C.dim}>{'↑↓ move · → open · ← up · enter: edit · d: diff run_N · "/" search'}</span>
          </text>
          <text>
            <span fg={C.faint}>{cur ? cur.path.replace(/\\/g, "/").split("/").slice(-2).join("/") : ""}</span>
          </text>
        </box>
      </box>
    </box>
  )
}
