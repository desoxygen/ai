import type { RefObject } from "react"
import type { InputRenderable } from "@opentui/core"
import { C, SPINNERS } from "../theme.ts"

export function PromptInput({
  inputRef,
  focused,
  busy,
  agentLabel,
  agentColor,
  model,
  provider,
  variant,
  usage,
  thinking,
  elapsed,
  animations,
  tick,
  shellMode,
  onSend,
  onValueChange,
}: {
  inputRef: RefObject<InputRenderable | null>
  focused: boolean
  busy: boolean
  agentLabel: string
  agentColor: string
  model: string
  provider: string
  variant: string | null
  usage: string
  thinking: string | null
  elapsed: number
  animations: boolean
  tick: number
  shellMode: boolean
  onSend: (text: string) => void
  onValueChange: (value: string) => void
}) {
  return (
    <box flexDirection="column" marginLeft={1} marginRight={1} marginTop={1} flexShrink={0}>
      <box
        border
        borderStyle="rounded"
        borderColor={busy ? C.primary : shellMode ? C.warn : C.borderActive}
        backgroundColor={C.element}
        paddingLeft={1}
        paddingRight={1}
      >
        <input
          ref={inputRef}
          focused={focused}
          placeholder={shellMode ? "!ls -la" : 'Ask anything... "what should we try next?"'}
          placeholderColor={C.dim}
          textColor={C.text}
          cursorColor={shellMode ? C.warn : agentColor}
          backgroundColor={C.element}
          onInput={(v: string) => onValueChange(v)}
          onSubmit={(e: unknown) => onSend(typeof e === "string" ? e : (inputRef.current?.value ?? ""))}
        />
      </box>
      <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text>
          {busy && <b fg={C.primary}>{animations ? SPINNERS[tick % SPINNERS.length] : "⋯"}</b>}
          {busy && thinking !== null && <span fg={C.faint}>{`${thinking}… ${elapsed.toFixed(1)}s`}</span>}
          {busy && <span fg={C.dim}>{"  esc — остановить и уточнить"}</span>}
          {!busy && shellMode && <b fg={C.warn}>{"Shell · ! commands run locally"}</b>}
          {!busy && !shellMode && <span fg={C.dim}>{"@ files · ! shell · / commands"}</span>}
        </text>
        <text>
          {!shellMode && <b fg={agentColor}>{agentLabel}</b>}
          {!shellMode && <span fg={C.dim}>{" · "}</span>}
          {!shellMode && <span fg={C.faint}>{model}</span>}
          {!shellMode && provider && <span fg={C.dim}>{` ${provider}`}</span>}
          {!shellMode && variant && <span fg={C.warn}>{` [${variant}]`}</span>}
          {usage !== "" && <span fg={C.dim}>{` · ${usage}`}</span>}
          {!busy && <span fg={C.dim}>{" · ctrl+p"}</span>}
        </text>
      </box>
    </box>
  )
}
