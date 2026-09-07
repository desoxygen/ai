import { animFrame } from "../lib/anim.ts"
import { C } from "../theme.ts"

export function AsciiStage({ w, now, animated, height = 5 }: { w: number; now: number; animated: boolean; height?: number }) {
  const f = animFrame(animated ? now : 6_950, Math.max(30, w - 2), height)
  return (
    <box flexDirection="column" alignItems="center" height={height}>
      {f.lines.map((ln, i) => (
        <text key={i} selectable={false}>
          <span fg={f.accent.includes(i) ? C.primary : C.dim}>{ln}</span>
        </text>
      ))}
    </box>
  )
}
