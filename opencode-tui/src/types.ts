export type ToolStatus = "running" | "done" | "error"

export type Segment =
  | { kind: "text"; id: string; text: string; md?: boolean }
  | {
      kind: "tool"
      id: string
      label: string
      detail: string
      status: ToolStatus
      bornAt: number
      doneAt?: number
      output?: string[]
    }
  | { kind: "thinking"; id: string; title: string; status: ToolStatus; bornAt: number; doneAt?: number }

export interface AssistantMeta {
  agent: string
  model: string
  ms: number
  interrupted?: boolean
}

export type Msg =
  | { id: number; role: "user"; text: string; shell?: boolean; ts?: number }
  | {
      id: number
      role: "assistant"
      segments: Segment[]
      streaming: boolean
      meta?: AssistantMeta
    }

export interface Session {
  id: number
  title: string
  msgs: Msg[]
  createdAt: number
}
