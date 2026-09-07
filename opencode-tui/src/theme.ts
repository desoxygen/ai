import type { ThemeTokens } from "./themes.ts"

export { C, applyTheme, isTheme, loadSettings, patchSettings, resetSettings, settings, THEME_NAMES, themeOf } from "./themes.ts"
export type { ThemeTokens, AppSettings } from "./themes.ts"

export const SPINNERS = [0x280b, 0x2819, 0x2839, 0x2838, 0x283c, 0x2834, 0x2826, 0x2827, 0x2807, 0x280f].map((cp) => String.fromCodePoint(cp))

export const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

export const TICK_MS = 30

export const CONTEXT_WINDOW = 200000

export const VERSION = "0.1-beta1"

export interface ModelInfo {
  id: string
  provider: string
  ctx: string
  variants: string[]
}

// Curated catalog — every OpenRouter id verified against https://openrouter.ai/api/v1/models.
// The full live list is merged at runtime (see App ALL_MODELS); this is the offline-safe shortlist.
export const MODELS: ModelInfo[] = [
  { id: "default (.env)", provider: "OpenRouter", ctx: "auto", variants: ["none", "thinking"] },
  // Anthropic
  { id: "anthropic/claude-sonnet-4.5", provider: "Anthropic", ctx: "200k", variants: ["none", "thinking"] },
  { id: "anthropic/claude-opus-4.5", provider: "Anthropic", ctx: "200k", variants: ["none", "thinking"] },
  { id: "anthropic/claude-haiku-4.5", provider: "Anthropic", ctx: "200k", variants: ["none"] },
  // OpenAI
  { id: "openai/gpt-5.1", provider: "OpenAI", ctx: "256k", variants: ["none", "low", "medium", "high"] },
  { id: "openai/gpt-5", provider: "OpenAI", ctx: "256k", variants: ["none", "low", "medium", "high"] },
  { id: "openai/gpt-5-mini", provider: "OpenAI", ctx: "256k", variants: ["none", "low", "medium", "high"] },
  { id: "openai/gpt-5.1-codex", provider: "OpenAI", ctx: "256k", variants: ["none", "low", "medium", "high"] },
  { id: "openai/o4-mini", provider: "OpenAI", ctx: "200k", variants: ["none", "low", "medium", "high"] },
  // Google
  { id: "google/gemini-3-flash-preview", provider: "Google", ctx: "1M", variants: ["none", "thinking"] },
  { id: "google/gemini-2.5-pro", provider: "Google", ctx: "1M", variants: ["none", "thinking"] },
  { id: "google/gemini-2.5-flash", provider: "Google", ctx: "1M", variants: ["none"] },
  { id: "google/gemini-2.5-flash-lite", provider: "Google", ctx: "1M", variants: ["none"] },
  // DeepSeek
  { id: "deepseek/deepseek-chat", provider: "DeepSeek", ctx: "164k", variants: ["none"] },
  { id: "deepseek/deepseek-v3.2", provider: "DeepSeek", ctx: "164k", variants: ["none", "thinking"] },
  { id: "deepseek/deepseek-r1", provider: "DeepSeek", ctx: "64k", variants: ["none"] },
  // Qwen / Alibaba
  { id: "qwen/qwen3-coder", provider: "Qwen", ctx: "262k", variants: ["none"] },
  { id: "qwen/qwen3-max", provider: "Qwen", ctx: "262k", variants: ["none", "thinking"] },
  { id: "qwen/qwen3.7-max", provider: "Qwen", ctx: "1M", variants: ["none"] },
  // Z.ai (GLM)
  { id: "z-ai/glm-4.6", provider: "Z.ai", ctx: "205k", variants: ["none"] },
  { id: "z-ai/glm-5.2", provider: "Z.ai", ctx: "1M", variants: ["none", "thinking"] },
  { id: "z-ai/glm-5.2:free", provider: "Z.ai", ctx: "256k", variants: ["none"] },
  // Moonshot
  { id: "moonshotai/kimi-k2.6", provider: "Moonshot", ctx: "262k", variants: ["none"] },
  { id: "moonshotai/kimi-k3", provider: "Moonshot", ctx: "1M", variants: ["none", "thinking"] },
  // MiniMax
  { id: "minimax/minimax-m2.7", provider: "MiniMax", ctx: "205k", variants: ["none"] },
  { id: "minimax/minimax-m3", provider: "MiniMax", ctx: "1M", variants: ["none", "thinking"] },
  // xAI
  { id: "x-ai/grok-4.3", provider: "xAI", ctx: "1M", variants: ["none"] },
  // Meta
  { id: "meta-llama/llama-4-maverick", provider: "Meta", ctx: "1M", variants: ["none"] },
  { id: "meta-llama/llama-4-scout", provider: "Meta", ctx: "10M", variants: ["none"] },
  // Mistral
  { id: "mistralai/mistral-large", provider: "Mistral", ctx: "128k", variants: ["none"] },
]

export interface AgentInfo {
  id: "build" | "plan" | "advisor"
  label: string
  desc: string
  tokenColor: "primary" | "info"
}

export const AGENTS: AgentInfo[] = [
  { id: "build", label: "Build", desc: "read, edit and run code", tokenColor: "primary" },
  { id: "plan", label: "Plan", desc: "proposes a numbered plan first, then executes", tokenColor: "info" },
  { id: "advisor", label: "Advisor", desc: "start-menu consultant — advises on projects and research, never runs anything", tokenColor: "info" },
]

export const TIPS = [
  "Type @ followed by a filename to fuzzy search and attach files",
  "Start a message with ! to run shell commands (e.g. !ls -la)",
  "Run /init to auto-generate project rules based on your codebase",
  "ctrl+r opens a fuzzy reverse-search over your prompt history",
  "Press ctrl+x and wait — the which-key panel lists every leader binding",
  "tab cycles between Build and Plan agents",
]
