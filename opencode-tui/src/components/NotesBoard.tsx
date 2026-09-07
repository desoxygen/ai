import { useEffect, useMemo, useRef, type RefObject } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { C } from "../theme.ts"
import { fmtNoteTime, labelHex, notesDir, readNoteBody, type Note } from "../lib/notes.ts"
import { GlowView } from "./GlowView.tsx"

export interface NotePrompt {
  mode: "filter" | "create"
  text: string
}

function trunc(s: string, w: number): string {
  if (w <= 1) return "…"
  return s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s
}

function NoteRow({ n, selected, w }: { n: Note; selected: boolean; w: number }) {
  const color = n.labels[0] ? labelHex(n.labels[0]) : null
  const name = trunc(n.title, Math.max(8, w - 14))
  return (
    <box flexDirection="row" backgroundColor={selected ? C.selected : "transparent"} paddingLeft={1}>
      <text>
        <b fg={selected ? C.primary : C.dim}>{selected ? "❯ " : "  "}</b>
        {color ? (
          <span fg={color}>{"● "}</span>
        ) : (
          <span fg={C.faint}>{"○ "}</span>
        )}
        <span fg={selected ? C.text : C.faint}>{name}</span>
        <span fg={C.dim}>{`  ${fmtNoteTime(n.mtime)}`}</span>
      </text>
    </box>
  )
}

export function NotesBoard({
  notes,
  total,
  cursor,
  visibleHeight,
  availW,
  prompt,
  delArmed,
  error,
  previewRef,
  previewTick,
  onSelect,
}: {
  notes: Note[]
  total: number
  cursor: number
  visibleHeight: number
  availW: number
  prompt: NotePrompt | null
  delArmed: string | null
  error: string | null
  previewRef: RefObject<ScrollBoxRenderable | null>
  previewTick: number
  onSelect?: (index: number) => void
}) {
  let where: string | null = null
  try {
    where = notesDir()
  } catch {}

  const listW = Math.max(36, Math.floor(availW * 0.42) - 2)
  const detailW = Math.max(30, availW - listW - 6)
  const vh = Math.max(4, visibleHeight)
  const sel = notes[Math.min(cursor, Math.max(0, notes.length - 1))] ?? null

  const body = useMemo(() => {
    if (!sel) return ""
    try {
      return readNoteBody(sel.path)
    } catch {
      return ""
    }
    // previewTick forces a re-read after the editor closes
  }, [sel?.path, previewTick])

  const selPath = sel?.path ?? null
  const scrollResetRef = useRef(selPath)
  useEffect(() => {
    // a new note must start reading from the top, not inherit j/k scroll
    if (scrollResetRef.current !== selPath) {
      scrollResetRef.current = selPath
      previewRef.current?.scrollTo({ x: 0, y: 0 })
    }
  }, [selPath, previewRef])

  const start = Math.max(0, Math.min(cursor - Math.floor(vh / 2), Math.max(0, notes.length - vh)))
  const win = notes.slice(start, start + vh)

  if (error) {
    return (
      <box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center" paddingLeft={2}>
        <text>
          <b fg={C.err}>{"notes: vault unavailable"}</b>
        </text>
        <text>
          <span fg={C.faint}>{trunc(error, 70)}</span>
        </text>
        <text>
          <span fg={C.dim}>{"set OBSIDIAN_VAULT_PATH in .env · r to retry"}</span>
        </text>
      </box>
    )
  }

  const selColor = sel?.labels[0] ? labelHex(sel.labels[0]) : C.primary

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" flexGrow={1}>
        {/* left: title + prompt + note list */}
        <box width={listW} flexDirection="column">
          <box flexDirection="row" justifyContent="space-between" border={["bottom"]} borderColor={C.border}>
            <text>
              <b fg={C.primary}>{"Notes"}</b>
              {where && <span fg={C.dim}>{trunc(` · ${where}`, Math.max(12, listW - 12))}</span>}
            </text>
            <text>
              <span fg={C.dim}>{`${notes.length} / ${total}`}</span>
            </text>
          </box>
          {prompt && (
            <box flexDirection="row" border={["bottom"]} borderColor={C.border} paddingLeft={1}>
              <text>
                <span fg={C.primary}>{"┃ "}</span>
                <b fg={C.text}>{prompt.mode === "create" ? "n" : "/"}</b>
                <span fg={C.text}>{prompt.text}</span>
                <span fg={C.primary}>{"▏"}</span>
              </text>
            </box>
          )}
          {win.map((n, i) => {
            const abs = start + i
            return (
              <box key={n.path} onMouseUp={() => onSelect?.(abs)}>
                <NoteRow n={n} selected={abs === cursor} w={listW} />
              </box>
            )
          })}
          {!prompt && notes.length === 0 && (
            <box flexDirection="column" flexGrow={1} justifyContent="center">
              <text>
                <b fg={C.dim}>{"no notes yet"}</b>
              </text>
              <text>
                <span fg={C.faint}>{`press n to create the first note`}</span>
              </text>
            </box>
          )}
          <box flexGrow={1} />
          <box border={["top"]} borderColor={C.border}>
            {delArmed ? (
              <text>
                <b fg={C.warn}>{`⚠ x again deletes «${trunc(delArmed, Math.max(8, listW - 26))}»`}</b>
              </text>
            ) : (
              <text>
                <span fg={C.dim}>{"↑↓ select · n new · l color · L clear · enter edit · x del · / filter"}</span>
              </text>
            )}
          </box>
        </box>

        {/* right: glow-style preview of the selected note */}
        <box
          flexDirection="column"
          width={detailW}
          marginLeft={2}
          border
          borderStyle="rounded"
          borderColor={sel ? selColor : C.border}
          backgroundColor={C.panel}
          paddingTop={1}
        >
          {sel ? (
            <>
              <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} flexShrink={0}>
                <text>
                  <b fg={selColor}>{trunc(sel.title, Math.max(10, detailW - 22))}</b>
                </text>
                <text>
                  {sel.labels.map((l, i) => (
                    <span key={l} fg={labelHex(l)}>
                      {`${i > 0 ? " " : ""}■${l}`}
                    </span>
                  ))}
                </text>
              </box>
              <box border={["bottom"]} borderColor={C.borderSubtle} marginX={2} flexShrink={0} />
              <scrollbox
                ref={previewRef}
                flexGrow={1}
                scrollY
                paddingRight={1}
                scrollbarOptions={{
                  trackOptions: {
                    foregroundColor: selColor,
                    backgroundColor: C.panel,
                  },
                }}
              >
                <GlowView md={body} colW={Math.max(28, detailW - 4)} />
                <text>
                  <span fg={C.dim}>{" "}</span>
                </text>
              </scrollbox>
              <box border={["top"]} borderColor={C.borderSubtle} height={1} flexShrink={0}>
                <text>
                  <span fg={C.dim}>{" j/k scroll preview · enter edit in $EDITOR"}</span>
                </text>
              </box>
            </>
          ) : (
            <box flexGrow={1} justifyContent="center" alignItems="center">
              <text>
                <span fg={C.faint}>{"выберите заметку ↑↓ — превью появится здесь"}</span>
              </text>
            </box>
          )}
        </box>
      </box>
    </box>
  )
}
