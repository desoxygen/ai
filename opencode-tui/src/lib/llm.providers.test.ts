import { expect, test } from "bun:test"
import { pipelineModelStatus, providerKeyFor } from "./llm.ts"

// Mirrors ai_scientist/console/modules/auxiliary/env.py::provider_key_for —
// if the Python table changes, the doctor row in App.tsx goes stale.
test("providerKeyFor maps model prefixes to required API keys", () => {
  expect(providerKeyFor("openrouter/z-ai/glm-5.2:free")).toBe("OPENROUTER_API_KEY")
  expect(providerKeyFor("llama3.1-405b")).toBe("OPENROUTER_API_KEY")
  expect(providerKeyFor("ollama/qwen2.5-coder:7b-instruct-q4_K_M")).toBe("")
  expect(providerKeyFor("claude-3-5-sonnet-20241022")).toBe("ANTHROPIC_API_KEY")
  expect(providerKeyFor("bedrock/anthropic.claude-3-opus-20240229-v1:0")).toBe("ANTHROPIC_API_KEY")
  expect(providerKeyFor("vertex_ai/claude-3-haiku@20240307")).toBe("ANTHROPIC_API_KEY")
  expect(providerKeyFor("gemini-2.0-flash")).toBe("GEMINI_API_KEY")
  expect(providerKeyFor("deepseek-chat")).toBe("DEEPSEEK_API_KEY")
  expect(providerKeyFor("gpt-4o")).toBe("OPENAI_API_KEY")
  expect(providerKeyFor("o3-mini")).toBe("OPENAI_API_KEY")
  expect(providerKeyFor("")).toBe("")
  expect(providerKeyFor("some/other/model")).toBe("")
})

test("pipelineModelStatus: /doctor row strings", () => {
  const onlyOpenAI = (name: string) => name === "OPENAI_API_KEY"
  expect(pipelineModelStatus("", () => true)).toContain("not set")
  expect(pipelineModelStatus("gpt-4o", onlyOpenAI)).toContain("key OPENAI_API_KEY set")
  expect(pipelineModelStatus("gpt-4o", () => false)).toContain("WARNING")
  expect(pipelineModelStatus("ollama/qwen2.5-coder", () => false)).toContain("local Ollama server")
  expect(pipelineModelStatus("weird-model", () => false)).toContain("no key needed")
})
