import { useMemo, type RefObject } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { MacOSScrollAccel, SyntaxStyle } from "@opentui/core"
import { C, SPINNERS } from "../theme.ts"
import { mixHex, scrambleAt } from "../lib/fx.ts"
import type { Msg, Segment } from "../types.ts"

const FADE = 14
const scrollAccel = new MacOSScrollAccel()
const syntaxStyle = SyntaxStyle.create()

const TOOL_ICONS: Record<string, string> = {
  read: "→",
  write: "←",
  edit: "←",
  bash: "$",
  grep: "✱",
  glob: "✱",
  webfetch: "%",
  websearch: "◈",
  store: "⚙",
  plan: "≡",
  task: "✓",
  compact: "▤",
  status: "▣",
  help: "?",
  error: "✗",
  info: "·",
  settings: "⚙",
}

export function toolIcon(label: string): string {
  return TOOL_ICONS[label] ?? "⚙"
}

export function fmtSec(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function UserMsg({ text, shell, agentColor, ts }: { text: string; shell: boolean; agentColor: string; ts?: number }) {
  return (
    <box flexDirection="row" marginX={1} marginTop={1} backgroundColor={C.element} paddingLeft={1} paddingRight={1} justifyContent="space-between">
      <text>
        <span fg={shell ? C.warn : agentColor}>{shell ? "$ " : "> "}</span>
        <b fg={C.text}>{text}</b>
      </text>
      {ts && (
        <text>
          <span fg={C.dim}>{new Date(ts).toTimeString().slice(0, 5)}</span>
        </text>
      )}
    </box>
  )
}

function FadeText({ text }: { text: string }) {
  const parts = useMemo(() => {
    if (text.length <= FADE) return null
    const tail = text.slice(-FADE)
    return { head: text.slice(0, -FADE), tail: tail.split("") }
  }, [text])
  if (!parts) {
    return (
      <text>
        <span fg={C.text}>{text}</span>
      </text>
    )
  }
  return (
    <text>
      <span fg={C.text}>{parts.head}</span>
      {parts.tail.map((ch, i) => (
        <span key={i} fg={mixHex(C.bg, C.text, Math.pow((i + 1) / FADE, 1.6))}>
          {ch}
        </span>
      ))}
    </text>
  )
}

function ToolLine({
  seg,
  tick,
  now,
  animations,
  verbose,
}: {
  seg: Extract<Segment, { kind: "tool" }>
  tick: number
  now: number
  animations: boolean
  verbose: boolean
}) {
  const running = seg.status === "running"
  const icon = running ? (animations ? SPINNERS[tick % SPINNERS.length] : "⋯") : seg.status === "error" ? "✗" : toolIcon(seg.label)
  const label = running && animations ? scrambleAt(seg.label, tick) : seg.label
  const elapsed = running ? ` ${fmtSec(Math.max(0, now - seg.bornAt))}` : seg.doneAt ? ` · ${fmtSec(seg.doneAt - seg.bornAt)}` : ""
  if (seg.label === "compact") {
    return (
      <box border={["top"]} borderColor={C.border} title=" Compaction " marginTop={1}>
        <text>
          <span fg={C.dim}>{seg.detail}</span>
        </text>
      </box>
    )
  }
  return (
    <box flexDirection="column">
      <text>
        <span fg={running ? C.tool : seg.status === "error" ? C.err : C.dim}>{`${icon} `}</span>
        <b fg={running ? C.tool : C.faint}>{label}</b>
        <span fg={C.text}>{seg.detail ? ` ${seg.detail}` : ""}</span>
        <span fg={C.dim}>{elapsed}</span>
      </text>
      {(verbose ? seg.output : seg.label === "bash" && !running ? seg.output?.slice(0, 3) : undefined)?.map((line, i) => (
        <text key={i}>
          <span fg={C.border}>{"  ↳ "}</span>
          <span fg={line.startsWith("+") ? C.ok : line.startsWith("─") || line.startsWith("@@") ? C.warn : C.dim}>{line}</span>
        </text>
      ))}
    </box>
  )
}

function ThinkingLine({
  seg,
  tick,
  now,
  animations,
}: {
  seg: Extract<Segment, { kind: "thinking" }>
  tick: number
  now: number
  animations: boolean
}) {
  if (seg.status === "running") {
    return (
      <text>
        <b fg={C.primary}>{animations ? `${SPINNERS[tick % SPINNERS.length]} ` : "∴ "}</b>
        <b fg={C.primary}>{`Thinking: ${seg.title}`}</b>
      </text>
    )
  }
  return (
    <text>
      <span fg={C.faint}>{"∴ "}</span>
      <span fg={C.faint}>{`Thought: ${seg.title}`}</span>
      <span fg={C.dim}>{` · ${fmtSec((seg.doneAt ?? now) - seg.bornAt)}`}</span>
    </text>
  )
}

function AssistantMsg({
  msg,
  tick,
  now,
  animations,
  verbose,
  agentColor,
}: {
  msg: Extract<Msg, { role: "assistant" }>
  tick: number
  now: number
  animations: boolean
  verbose: boolean
  agentColor: string
}) {
  const lastIdx = msg.segments.length - 1
  const meta = msg.meta
  return (
    <box flexDirection="column" marginTop={1} paddingLeft={1}>
      {msg.segments.map((s, idx) => {
        if (s.kind === "tool") {
          return <ToolLine key={s.id} seg={s} tick={tick} now={now} animations={animations} verbose={verbose} />
        }
        if (s.kind === "thinking") {
          return <ThinkingLine key={s.id} seg={s} tick={tick} now={now} animations={animations} />
        }
        const isGrowing = msg.streaming && idx === lastIdx
        if (s.md) {
          return <markdown key={s.id} content={s.text} streaming={isGrowing} syntaxStyle={syntaxStyle} />
        }
        if (isGrowing && animations) {
          return <FadeText key={s.id} text={s.text} />
        }
        return (
          <text key={s.id}>
            <span fg={C.text}>{s.text}</span>
          </text>
        )
      })}
      {msg.streaming && (
        <text>
          <b fg={agentColor}>{animations ? SPINNERS[tick % SPINNERS.length] : "⋯"}</b>
          <span fg={C.dim}>{"  "}</span>
          <span fg={agentColor}>{animations && tick % 2 !== 0 ? " " : "▋"}</span>
        </text>
      )}
      {!msg.streaming && meta && (
        <text>
          <b fg={agentColor}>{"▣ "}</b>
          <span fg={C.faint}>{meta.agent}</span>
          <span fg={C.dim}>{` · ${meta.model}`}</span>
          <span fg={C.dim}>{` · ${fmtSec(meta.ms)}`}</span>
          {meta.interrupted && <span fg={C.warn}>{" · interrupted"}</span>}
        </text>
      )}
    </box>
  )
}

export function ChatLog({
  messages,
  hiddenAbove = 0,
  onLoadEarlier,
  tick,
  now,
  animations,
  verbose,
  agentColor,
  scrollRef,
}: {
  messages: Msg[]
  hiddenAbove?: number
  onLoadEarlier?: () => void
  tick: number
  now: number
  animations: boolean
  verbose: boolean
  agentColor: string
  scrollRef: RefObject<ScrollBoxRenderable | null>
}) {
  const sb = scrollRef.current
  const atTop = sb ? sb.scrollTop <= 0 : false
  return (
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
      scrollY
      scrollAcceleration={scrollAccel}
      paddingLeft={1}
      paddingRight={1}
      scrollbarOptions={{
        trackOptions: {
          foregroundColor: mixHex(C.bg, C.text, 0.28),
          backgroundColor: "transparent",
        },
      }}
    >
      {hiddenAbove > 0 && (
        <text onMouseUp={() => onLoadEarlier?.()}>
          <span fg={atTop ? C.primary : C.dim}>{`▲ ${hiddenAbove} earlier message${hiddenAbove > 1 ? "s" : ""} — scroll to top`}</span>
        </text>
      )}
      {messages.map((m, i) => {
        // only the tail of the transcript is ever live: finished messages get
        // frozen clock props so the animation tick cannot re-render history
        const frozen = i < messages.length - 1
        const t = frozen ? 0 : tick
        const n = frozen ? 0 : now
        return m.role === "user" ? (
          <UserMsg key={m.id} text={m.text} shell={!!m.shell} agentColor={agentColor} ts={m.ts} />
        ) : (
          <AssistantMsg key={m.id} msg={m} tick={t} now={n} animations={animations} verbose={verbose} agentColor={agentColor} />
        )
      })}
    </scrollbox>
  )
}
