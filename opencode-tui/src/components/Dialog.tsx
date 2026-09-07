import type { ReactNode } from "react"
import { C } from "../theme.ts"

export function Dialog({
  title,
  escHint = "esc close",
  width,
  children,
}: {
  title: ReactNode
  escHint?: string
  width: number
  children: ReactNode
}) {
  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={20}>
      <box position="absolute" top={0} left={0} width="100%" height="100%" backgroundColor="#000000" opacity={0.55} />
      <box position="absolute" top="15%" left={0} width="100%" alignItems="center">
        <box
          flexDirection="column"
          width={width}
          border
          borderStyle="rounded"
          borderColor={C.borderActive}
          backgroundColor={C.element}
          paddingLeft={1}
          paddingRight={1}
        >
          <box flexDirection="row" justifyContent="space-between" marginBottom={0}>
            <text>
              <b fg={C.text}>{title}</b>
            </text>
            <text>
              <span fg={C.faint}>{escHint}</span>
            </text>
          </box>
          {children}
        </box>
      </box>
    </box>
  )
}
