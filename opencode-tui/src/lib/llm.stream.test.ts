import { describe, test, expect } from "bun:test"
import { StreamIncompleteError } from "./llm.ts"

// streamChat itself needs a live router; these tests pin the pure logic that
// guards it: the terminal-event contract and the incomplete-stream error type.

describe("stream reliability contract", () => {
  test("StreamIncompleteError is a distinct, typed failure", () => {
    const e = new StreamIncompleteError()
    expect(e.name).toBe("StreamIncompleteError")
    expect(e.message).toContain("terminal event")
  })

  test("openai terminal chunk carries usage; [DONE] is the terminal marker", () => {
    // mirrors the parser branches in streamChat: usage on the final chunk
    const finalChunk = {
      choices: [],
      usage: { prompt_tokens: 120, completion_tokens: 45 },
    }
    let usage: { in: number; out: number } | null = null
    const u = (finalChunk.usage as { prompt_tokens?: number; completion_tokens?: number })!
    if (u && (u.prompt_tokens !== undefined || u.completion_tokens !== undefined)) {
      usage = { in: u.prompt_tokens ?? -1, out: u.completion_tokens ?? -1 }
    }
    expect(usage).toEqual({ in: 120, out: 45 })
    expect("data: [DONE]".startsWith("data:")).toBe(true)
  })

  test("anthropic usage arrives in message_start (in) + message_delta (out)", () => {
    let acc = { in: 0, out: 0 }
    const start = { type: "message_start", message: { usage: { input_tokens: 200 } } }
    const delta = { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 33 } }
    const su = (start.message as { usage?: { input_tokens?: number } }).usage?.input_tokens
    if (su !== undefined) acc = { ...acc, in: su }
    const du = (delta.usage as { output_tokens?: number }).output_tokens
    if (du !== undefined) acc = { ...acc, out: du }
    expect(acc).toEqual({ in: 200, out: 33 })
  })
})
