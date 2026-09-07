import { C } from "../theme.ts"
import type { IdeaFull } from "../lib/project.ts"

function wrapText(s: string, w: number, maxLines: number): string[] {
  const words = (s || "").trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ""
  for (const word of words) {
    if (cur && cur.length + 1 + word.length > w) {
      lines.push(cur)
      cur = word
    } else {
      cur = cur ? `${cur} ${word}` : word
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, "")}…`
  }
  return lines
}

function ScoreBar({ label, v }: { label: string; v: number }) {
  const bar = "▓".repeat(v) + "░".repeat(10 - v)
  return (
    <text>
      <span fg={C.dim}>{`${label.padEnd(17)}`}</span>
      <span fg={C.info}>{bar}</span>
      <span fg={C.dim}>{` ${v}/10`}</span>
    </text>
  )
}

export function IdeasBrowser({
  ideas,
  total,
  project,
  cursor,
  visibleHeight,
  filterActive,
  filterQuery,
  availW,
  onSelect,
}: {
  ideas: IdeaFull[]
  total: number
  project: string
  cursor: number
  visibleHeight: number
  filterActive: boolean
  filterQuery: string
  availW: number
  onSelect?: (index: number) => void
}) {
  const listW = Math.max(40, Math.floor(availW * 0.48) - 2)
  const detailW = Math.max(30, availW - listW - 5)
  const vh = Math.max(4, visibleHeight)
  const start = Math.max(0, Math.min(cursor - Math.floor(vh / 2), Math.max(0, ideas.length - vh)))
  const win = ideas.slice(start, start + vh)
  const sel = ideas[Math.min(cursor, Math.max(0, ideas.length - 1))] ?? null

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" flexGrow={1}>
        {/* left: filter + list */}
        <box width={listW} flexDirection="column">
          <box flexDirection="row" justifyContent="space-between" border={["bottom"]} borderColor={C.border}>
            <text>
              <b fg={C.primary}>{"Ideas"}</b>
              {project && <span fg={C.dim}>{` · ${project}`}</span>}
            </text>
            <text>
              <span fg={C.dim}>{`${ideas.length} / ${total} ideas`}</span>
            </text>
          </box>
          <box flexDirection="row" border={["bottom"]} borderColor={C.border} paddingLeft={1}>
            <text>
              {filterActive ? (
                <>
                  <span fg={C.primary}>{"┃ "}</span>
                  <b fg={C.text}>{"/"}</b>
                  <span fg={C.text}>{filterQuery}</span>
                  <span fg={C.primary}>{"▏"}</span>
                </>
              ) : (
                <span fg={C.faint}>{"filter by name or title...  ( / )"}</span>
              )}
            </text>
          </box>
          {win.map((it, i) => {
            const abs = start + i
            const selected = abs === cursor
            const name = it.name.length > listW - 12 ? `${it.name.slice(0, listW - 13)}…` : it.name
            return (
              <box key={it.name} flexDirection="row" backgroundColor={selected ? C.selected : "transparent"} paddingLeft={1} onMouseUp={() => onSelect?.(abs)}>
                <text>
                  <b fg={selected ? C.primary : C.dim}>{selected ? "❯ " : "  "}</b>
                  <span fg={selected ? C.text : C.faint}>{name}</span>
                  <span fg={it.novel === true ? C.ok : it.novel === false ? C.err : C.warn}>
                    {it.novel === true ? " ●" : it.novel === false ? " ✗" : " ○"}
                  </span>
                  <span fg={C.dim}>{` Σ ${it.words}`}</span>
                </text>
              </box>
            )
          })}
          {ideas.length === 0 && (
            <text>
              <span fg={C.dim}>{filterQuery ? "no matches" : project ? "— пусто: /run сгенерирует идеи" : "— нет проекта: P — открыть"}</span>
            </text>
          )}
          <box flexGrow={1} />
          <box border={["top"]} borderColor={C.border}>
            <text>
              <span fg={C.dim}>{'↑↓ select · / filter · t — заметки · e — ideas.json'}</span>
            </text>
          </box>
        </box>

        {/* right: detail */}
        <box
          flexDirection="column"
          width={detailW}
          marginLeft={2}
          border
          borderStyle="rounded"
          borderColor={C.border}
          backgroundColor={C.panel}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
        >
          <text>
            <span fg={C.dim}>{"— Detail"}</span>
          </text>
          {sel ? (
            <>
              <text> </text>
              <text>
                <b fg={C.primary}>{sel.name}</b>
              </text>
              {wrapText(sel.title, detailW - 6, 2).map((l, i) => (
                <text key={`t${i}`}>
                  <b fg={C.text}>{l}</b>
                </text>
              ))}
              <text> </text>
              <ScoreBar label="Interestingness" v={sel.interestingness} />
              <ScoreBar label="Novelty" v={sel.novelty} />
              <ScoreBar label="Feasibility" v={sel.feasibility} />
              <text> </text>
              <text>
                {sel.novel === true ? (
                  <>
                    <span fg={C.ok}>{"● "}</span>
                    <b fg={C.ok}>{"marked novel"}</b>
                  </>
                ) : sel.novel === false ? (
                  <>
                    <span fg={C.err}>{"✗ "}</span>
                    <b fg={C.err}>{"not novel"}</b>
                  </>
                ) : (
                  <>
                    <span fg={C.warn}>{"○ "}</span>
                    <span fg={C.dim}>{"novelty not checked"}</span>
                  </>
                )}
              </text>
              <text> </text>
              {wrapText(sel.explanation || sel.experiment, detailW - 6, 24).map((l, i) => (
                <text key={`b${i}`}>
                  <span fg={C.text}>{l}</span>
                </text>
              ))}
            </>
          ) : (
            <text>
              <span fg={C.faint}>{"нет выбранной идеи"}</span>
            </text>
          )}
        </box>
      </box>
    </box>
  )
}
