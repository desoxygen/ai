import { useMemo } from "react"
import { SyntaxStyle } from "@opentui/core"
import { C } from "../theme.ts"
import { parseMarkdown, wrapBlocks, type Block, type Inline } from "../lib/articles.ts"

// shared syntax style for fenced code blocks (tree-sitter when available)
const codeStyle = SyntaxStyle.create()

function Seg({ s, base }: { s: Inline; base: string }) {
  if (s.c) {
    return (
      <span fg={C.tool}>
        <b>{s.t}</b>
      </span>
    )
  }
  if (s.l) {
    return <span fg={C.info}>{s.t}</span>
  }
  if (s.b) {
    return <b fg={C.text}>{s.t}</b>
  }
  if (s.i) {
    return <span fg={C.faint}>{s.t}</span>
  }
  return <span fg={base}>{s.t}</span>
}

function blockText(b: Block): string {
  return b.segs.map((s) => s.t).join("")
}

type Render = { kind: "b"; b: Block } | { kind: "code"; lines: string[] }

// glow-style: consecutive code lines collapse into one padded background block.
function groupCode(blocks: Block[]): Render[] {
  const out: Render[] = []
  for (const b of blocks) {
    if (b.kind === "code") {
      const last = out[out.length - 1]
      const line = blockText(b)
      if (last && last.kind === "code") last.lines.push(line)
      else out.push({ kind: "code", lines: [line] })
    } else {
      out.push({ kind: "b", b })
    }
  }
  return out
}

function GlowBlock({ b, colW }: { b: Block; colW: number }) {
  if (b.kind === "blank") return <text> </text>
  if (b.kind === "hr") return <box border={["top"]} borderColor={C.border} marginY={1} />
  if (b.kind === "h1") {
    return (
      <box flexDirection="column" marginTop={1}>
        <text>
          <b fg={C.text}>{`  ${blockText(b)}`}</b>
        </text>
        <text>
          <span fg={C.border}>{"─".repeat(Math.max(8, colW - 2))}</span>
        </text>
      </box>
    )
  }
  if (b.kind === "h2") {
    return (
      <text>
        <b fg={C.primary}>{`  ${blockText(b)}`}</b>
      </text>
    )
  }
  if (b.kind === "h3") {
    return (
      <text>
        <b fg={C.info}>{`    ${blockText(b)}`}</b>
      </text>
    )
  }
  if (b.kind === "h4") {
    return (
      <text>
        <span fg={C.faint}>{`    ${blockText(b)}`}</span>
      </text>
    )
  }
  if (b.kind === "quote") {
    return (
      <text>
        <span fg={C.dim}>{"  "}</span>
        <span fg={C.borderActive}>{"▏ "}</span>
        <span fg={C.dim}>{b.segs[1]?.t ?? ""}</span>
        <span fg={C.faint}>{blockText({ ...b, segs: b.segs.slice(2) })}</span>
      </text>
    )
  }
  if (b.kind === "bullet") {
    return (
      <text>
        <span fg={C.primary}>{b.segs[0]?.t ?? ""}</span>
        {b.segs.slice(1).map((s, i) => (
          <Seg key={i} s={s} base={C.text} />
        ))}
      </text>
    )
  }
  return (
    <text>
      <span fg={C.text}>{"  "} </span>
      {b.segs.map((s, i) => (
        <Seg key={i} s={s} base={C.text} />
      ))}
    </text>
  )
}

// Native glow-style markdown renderer — pure TypeScript, rendered with
// OpenTUI primitives. No external binary involved.
export function GlowView({ md, colW }: { md: string; colW: number }) {
  const blocks = useMemo(() => groupCode(wrapBlocks(parseMarkdown(md), colW - 6)), [md, colW])
  return (
    <>
      {blocks.map((r, i) =>
        r.kind === "code" ? (
          <box key={i} flexDirection="column" backgroundColor={C.element} paddingLeft={2} marginY={1}>
            <code
              content={r.lines.map((l) => (l.length > colW - 8 ? `${l.slice(0, colW - 9)}…` : l)).join("\n")}
              filetype="python"
              syntaxStyle={codeStyle}
            />
          </box>
        ) : (
          <GlowBlock key={i} b={r.b} colW={colW} />
        ),
      )}
    </>
  )
}
