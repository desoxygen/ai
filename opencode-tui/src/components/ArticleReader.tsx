import { useMemo, type RefObject } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { C } from "../theme.ts"
import { GlowView } from "./GlowView.tsx"

export function ArticleReader({
  title,
  subtitle,
  md,
  scrollRef,
  availW,
  availH,
}: {
  title: string
  subtitle: string
  md: string
  scrollRef: RefObject<ScrollBoxRenderable | null>
  availW: number
  availH: number
}) {
  // glow-style reading column: max ~96 cells; the row centers it via justifyContent.
  const colW = Math.max(40, Math.min(96, availW - 6))
  const firstH1 = useMemo(() => md.split("\n").findIndex((l) => /^#\s+/.test(l)), [md])
  const body = useMemo(
    () => (firstH1 === 0 ? md.slice(md.indexOf("\n") + 1).replace(/^\s+/, "") : md),
    [md, firstH1],
  )

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={C.bg}>
      <box flexDirection="column" flexShrink={0} paddingLeft={2} paddingRight={1} paddingTop={1} paddingBottom={1} border={["bottom"]} borderColor={C.border}>
        <text>
          <b fg={C.primary}>{`▍ ${title}`}</b>
        </text>
        <text>
          <span fg={C.dim}>{subtitle}</span>
        </text>
      </box>

      <box flexDirection="row" flexGrow={1} justifyContent="center">
        <scrollbox
          ref={scrollRef}
          width={colW + 2}
          flexGrow={0}
          scrollY
          paddingLeft={0}
          paddingRight={1}
          scrollbarOptions={{
            trackOptions: {
              foregroundColor: C.primary,
              backgroundColor: C.panel,
            },
          }}
        >
          <GlowView md={body} colW={colW} />
          <text>
            <span fg={C.dim}>{" "}</span>
          </text>
        </scrollbox>
      </box>

      <box flexDirection="row" justifyContent="space-between" flexShrink={0} paddingLeft={2} paddingRight={2} border={["top"]} borderColor={C.border} height={2}>
        <text>
          <b fg={C.text}>{"↑↓/j-k"}</b>
          <span fg={C.dim}>{" line   "}</span>
          <b fg={C.text}>{"PgUp/PgDn/space"}</b>
          <span fg={C.dim}>{" page   "}</span>
          <b fg={C.text}>{"g/G"}</b>
          <span fg={C.dim}>{" top/bottom   "}</span>
          <b fg={C.text}>{"esc/a"}</b>
          <span fg={C.dim}>{" back to dashboard"}</span>
        </text>
        <text>
          <span fg={C.faint}>{`glow-native · ${colW}c`}</span>
        </text>
      </box>
    </box>
  )
}
