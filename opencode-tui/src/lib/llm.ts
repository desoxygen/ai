import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PROJECT_ROOT } from "./aiscientist.ts"

// ---------------------------------------------------------------- env loading

let envCache: Record<string, string> | null = null

function dotenv(): Record<string, string> {
  if (envCache) return envCache
  envCache = {}
  try {
    const raw = readFileSync(join(PROJECT_ROOT, ".env"), "utf8")
    for (const ln of raw.split("\n")) {
      const m = ln.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m || ln.trim().startsWith("#")) continue
      envCache[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  } catch {}
  return envCache
}

function env(name: string): string {
  return process.env[name] || dotenv()[name] || ""
}

export function hasEnv(name: string): boolean {
  return env(name).length > 0
}

/** Which API key a model id requires ("" = no key needed / unknown).
 *  Mirrors ai_scientist/console/modules/auxiliary/env.py::provider_key_for. */
export function providerKeyFor(model: string): string {
  const m = (model || "").trim()
  if (!m) return ""
  if (m.startsWith("openrouter/") || m === "llama3.1-405b") return "OPENROUTER_API_KEY"
  if (m.startsWith("ollama/")) return ""  // no key, but the local server must run
  if (m.startsWith("claude-") || m.startsWith("bedrock") || m.startsWith("vertex_ai")) return "ANTHROPIC_API_KEY"
  if (m.includes("gemini")) return "GEMINI_API_KEY"
  if (m.startsWith("deepseek-")) return "DEEPSEEK_API_KEY"
  if (m.includes("gpt") || m.startsWith("o1") || m.startsWith("o3")) return "OPENAI_API_KEY"
  return ""
}

/** The raw AISC_DEFAULT_MODEL as the pipeline runner will see it. */
export function configuredPipelineModel(): string {
  return env("AISC_DEFAULT_MODEL")
}

/** Human-readable /doctor row for the pipeline model's provider/key state.
 *  Pure + injectable key probe so it is testable without touching .env. */
export function pipelineModelStatus(
  model: string,
  keyPresent: (name: string) => boolean = hasEnv,
): string {
  if (!model) return "AISC_DEFAULT_MODEL not set (runner uses its own default)"
  const k = providerKeyFor(model)
  if (!k) {
    return model.startsWith("ollama/")
      ? `${model} — local Ollama server required`
      : `${model} — no key needed`
  }
  return keyPresent(k)
    ? `${model} — key ${k} set`
    : `${model} — WARNING: needs ${k}, which is not set`
}

// ------------------------------------------------------------------- routers
//
// A router is an LLM endpoint the TUI can talk to. OpenAI-compatible routers
// share one request/stream format; Anthropic uses its native Messages API.

export interface Router {
  id: string
  label: string
  kind: "openai" | "anthropic"
  chatUrl: string
  modelsUrl?: string
  keyEnvs: string[]
  needsKey: boolean
  defaultModel: string
  org?: string
}

export const ROUTERS: Router[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    chatUrl: "https://openrouter.ai/api/v1/chat/completions",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    keyEnvs: ["OPENROUTER_API_KEY"],
    needsKey: true,
    defaultModel: "z-ai/glm-4.6",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    chatUrl: "https://api.anthropic.com/v1/messages",
    modelsUrl: "https://api.anthropic.com/v1/models",
    keyEnvs: ["ANTHROPIC_API_KEY"],
    needsKey: true,
    defaultModel: "claude-sonnet-4-5",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    chatUrl: "https://api.openai.com/v1/chat/completions",
    modelsUrl: "https://api.openai.com/v1/models",
    keyEnvs: ["OPENAI_API_KEY"],
    needsKey: true,
    defaultModel: "gpt-5-mini",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai",
    chatUrl: "https://api.groq.com/openai/v1/chat/completions",
    modelsUrl: "https://api.groq.com/openai/v1/models",
    keyEnvs: ["GROQ_API_KEY"],
    needsKey: true,
    defaultModel: "llama-3.3-70b-versatile",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai",
    chatUrl: "https://api.deepseek.com/v1/chat/completions",
    modelsUrl: "https://api.deepseek.com/v1/models",
    keyEnvs: ["DEEPSEEK_API_KEY"],
    needsKey: true,
    defaultModel: "deepseek-chat",
  },
  {
    id: "xai",
    label: "xAI",
    kind: "openai",
    chatUrl: "https://api.x.ai/v1/chat/completions",
    modelsUrl: "https://api.x.ai/v1/models",
    keyEnvs: ["XAI_API_KEY"],
    needsKey: true,
    defaultModel: "grok-3-mini",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai",
    chatUrl: "http://localhost:11434/v1/chat/completions",
    modelsUrl: "http://localhost:11434/v1/models",
    keyEnvs: [],
    needsKey: false,
    defaultModel: "qwen3",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    kind: "openai",
    chatUrl: "http://localhost:1234/v1/chat/completions",
    modelsUrl: "http://localhost:1234/v1/models",
    keyEnvs: [],
    needsKey: false,
    defaultModel: "local-model",
  },
  {
    id: "custom",
    label: "Custom endpoint",
    kind: "openai",
    get chatUrl(): string {
      return joinBase(env("AISC_LLM_BASE_URL")) + "/chat/completions"
    },
    get modelsUrl(): string | undefined {
      return env("AISC_LLM_BASE_URL") ? joinBase(env("AISC_LLM_BASE_URL")) + "/models" : undefined
    },
    keyEnvs: ["AISC_LLM_API_KEY", "OPENAI_API_KEY"],
    needsKey: false,
    defaultModel: "default",
  },
]

function joinBase(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/(chat\/completions|models)$/, "")
}

export function routerById(id: string): Router | null {
  return ROUTERS.find((r) => r.id === id) ?? null
}

let routerMemo: string | null = null

function settingsRouter(): string {
  if (routerMemo !== null) return routerMemo
  try {
    // read lazily to avoid a theme.ts <-> llm.ts import cycle at module init;
    // src/lib -> project TUI root is two levels up (same state.json as themes.ts)
    const raw = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "state.json"), "utf8")) as { router?: string }
    routerMemo = raw.router || ""
  } catch {
    routerMemo = ""
  }
  return routerMemo
}

export function setActiveRouter(id: string): void {
  routerMemo = routerById(id) ? id : "openrouter"
}

export function activeRouterId(): string {
  const forced = env("AISC_LLM_ROUTER") || settingsRouter()
  return routerById(forced) ? forced : "openrouter"
}

export function activeRouter(): Router {
  return routerById(activeRouterId()) ?? ROUTERS[0]
}

export function routerLabel(): string {
  return activeRouter().label
}

export function apiKey(): string {
  const r = activeRouter()
  for (const e of r.keyEnvs) {
    const v = env(e)
    if (v) return v
  }
  return ""
}

export function defaultModel(): string {
  const m = env("AISC_DEFAULT_MODEL")
  return m ? m.replace(/^openrouter\//, "") : activeRouter().defaultModel
}

export function llmReady(): boolean {
  if (env("AISC_TUI_OFFLINE") === "1") return false
  const r = activeRouter()
  if (r.id === "custom" && !env("AISC_LLM_BASE_URL")) return false
  return r.needsKey ? apiKey().length > 0 : true
}

export function llmBlockedReason(): string {
  if (env("AISC_TUI_OFFLINE") === "1") return "AISC_TUI_OFFLINE=1 (offline mode)"
  const r = activeRouter()
  if (r.id === "custom" && !env("AISC_LLM_BASE_URL")) return "no AISC_LLM_BASE_URL in .env"
  if (r.needsKey && !apiKey()) return `no ${r.keyEnvs[0]} in .env (router: ${r.label})`
  return ""
}

// ------------------------------------------------------------- model aliases

// Curated OpenRouter ids -> native ids for direct routers.
const DIRECT_IDS: Record<string, Record<string, string>> = {
  "anthropic/claude-sonnet-4.5": { anthropic: "claude-sonnet-4-5" },
  "anthropic/claude-opus-4.5": { anthropic: "claude-opus-4-5" },
  "anthropic/claude-haiku-4.5": { anthropic: "claude-haiku-4-5" },
  "openai/gpt-5": { openai: "gpt-5" },
  "openai/gpt-5-mini": { openai: "gpt-5-mini" },
  "openai/gpt-5.1": { openai: "gpt-5.1" },
  "openai/gpt-5.1-codex": { openai: "gpt-5.1-codex" },
  "openai/o4-mini": { openai: "o4-mini" },
  "deepseek/deepseek-chat": { deepseek: "deepseek-chat" },
  "deepseek/deepseek-v3.2": { deepseek: "deepseek-chat" },
  "deepseek/deepseek-r1": { deepseek: "deepseek-reasoner" },
  "x-ai/grok-4.3": { xai: "grok-4" },
}

export function resolveModel(id: string): string {
  const r = activeRouter()
  if (!id || id.startsWith("default")) return defaultModel()
  const clean = id.replace(/^openrouter\//, "")
  const alias = DIRECT_IDS[clean]?.[r.id]
  if (alias) return alias
  if (r.id === "openrouter") return clean
  if (clean.includes("/")) return clean.slice(clean.indexOf("/") + 1)
  return clean
}

/** Full model name handed to the Python pipeline (which dispatches on prefix). */
export function pipelineModel(id: string): string {
  if (!id || id.startsWith("default")) return defaultModel()
  const r = activeRouter()
  if (r.id === "openrouter") return id.startsWith("openrouter/") ? id : `openrouter/${id.replace(/^openrouter\//, "")}`
  if (r.id === "ollama") return id.startsWith("ollama/") ? id : `ollama/${id}`
  return id
}

// ------------------------------------------------------------------ chat API

export interface ChatMsg {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatOpts {
  model: string
  messages: ChatMsg[]
  variant?: string | null
  signal?: AbortSignal
  /** Real token usage reported by the provider (final stream events). */
  onUsage?: (u: { in: number; out: number }) => void
}

/** Thrown when a stream ends without its terminal event — the answer is incomplete. */
export class StreamIncompleteError extends Error {
  constructor() {
    super("stream ended without a terminal event — response may be incomplete")
    this.name = "StreamIncompleteError"
  }
}

const STREAM_IDLE_TIMEOUT_MS = 90_000
const PRESTREAM_RETRIES = 2
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function openaiBody(o: ChatOpts): Record<string, unknown> {
  const r = activeRouter()
  const b: Record<string, unknown> = { model: resolveModel(o.model), messages: o.messages, stream: true }
  if (r.id === "openrouter") b.usage = { include: true }
  if (r.id === "openai") b.stream_options = { include_usage: true }
  if (o.variant && o.variant !== "none") {
    b.reasoning = ["low", "medium", "high", "max"].includes(o.variant) ? { effort: o.variant } : { enabled: true }
  }
  return b
}

function anthropicBody(o: ChatOpts): Record<string, unknown> {
  const system = o.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
  const b: Record<string, unknown> = {
    model: resolveModel(o.model),
    max_tokens: 32000,
    stream: true,
    messages: o.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content })),
  }
  if (system) b.system = system
  if (o.variant && o.variant !== "none") {
    const budget = o.variant === "high" || o.variant === "max" ? 16000 : o.variant === "medium" ? 8000 : 4096
    b.thinking = { type: "enabled", budget_tokens: budget }
  }
  return b
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

async function openStream(o: ChatOpts): Promise<Response> {
  const r = activeRouter()
  const key = apiKey()
  if (r.needsKey && !key) throw new Error(llmBlockedReason() || `${r.label}: no API key`)
  if (r.id === "custom" && !env("AISC_LLM_BASE_URL")) throw new Error("router «custom» needs AISC_LLM_BASE_URL in .env")
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (r.kind === "anthropic") {
    headers["x-api-key"] = key
    headers["anthropic-version"] = "2023-06-01"
  } else {
    if (key) headers.Authorization = `Bearer ${key}`
    if (r.id === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/sakanaai/ai-scientist"
      headers["X-Title"] = "AI-Scientist TUI"
    }
  }
  const bodyJson = JSON.stringify(r.kind === "anthropic" ? anthropicBody(o) : openaiBody(o))

  // Retries only cover failures BEFORE any byte of the answer stream — those
  // are cheap and safe to replay. Mid-stream failures are NOT retried here
  // (double billing); they surface to the caller with the partial text kept.
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= PRESTREAM_RETRIES; attempt++) {
    if (attempt > 0) {
      const base = Math.min(4000, 500 * 2 ** (attempt - 1))
      await sleep(base + Math.random() * base * 0.5)
    }
    let retryable = false
    try {
      const res = await fetch(r.chatUrl, { method: "POST", headers, body: bodyJson, signal: o.signal })
      if (res.ok && res.body) return res
      let detail = ""
      try {
        detail = (await res.text()).slice(0, 300)
      } catch {}
      lastErr = new Error(`${r.label}: HTTP ${res.status} ${detail}`)
      retryable = isRetryableStatus(res.status)
    } catch (e) {
      if (o.signal?.aborted || (e instanceof Error && e.name === "AbortError")) throw e
      lastErr = e as Error
      retryable = true // network-level failure before any byte
    }
    if (!retryable) throw lastErr
  }
  throw lastErr ?? new Error(`${r.label}: request failed`)
}

function sseData(line: string): string | null {
  if (!line.startsWith("data:")) return null
  const data = line.slice(5).trim()
  return data === "[DONE]" ? "" : data
}

function readWithIdleTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal): Promise<{ done: boolean; value?: Uint8Array }> {
  // A stalled proxy keeps the socket open while no bytes arrive — without this
  // timer the generator waits forever and the UI stays busy.
  let timer: ReturnType<typeof setTimeout> | null = null
  let onAbort: (() => void) | null = null
  const idle = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("stream idle timeout — no bytes for 90s")), STREAM_IDLE_TIMEOUT_MS)
  })
  const abort = new Promise<never>((_, rej) => {
    if (!signal) return
    onAbort = () => rej(new Error("aborted"))
    signal.addEventListener("abort", onAbort, { once: true })
  })
  return Promise.race([reader.read(), idle, abort]).finally(() => {
    if (timer) clearTimeout(timer)
    // never accumulate listeners: one per chunk would leak for the whole session
    if (signal && onAbort) signal.removeEventListener("abort", onAbort)
  })
}

export async function* streamChat(o: ChatOpts): AsyncGenerator<string> {
  const r = activeRouter()
  const res = await openStream(o)
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let rem = ""
  let sawTerminal = false
  try {
    while (true) {
      const { done, value } = await readWithIdleTimeout(reader, o.signal)
      if (done) break
      rem += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = rem.indexOf("\n")) !== -1) {
        const line = rem.slice(0, nl).trim()
        rem = rem.slice(nl + 1)
        const data = sseData(line)
        if (data === null) continue
        if (data === "") {
          sawTerminal = true
          return
        }
        try {
          const j = JSON.parse(data) as Record<string, unknown>
          if (r.kind === "anthropic") {
            if (j.type === "content_block_delta") {
              const d = j.delta as { type?: string; text?: string } | undefined
              if (d?.type === "text_delta" && d.text) yield d.text
            } else if (j.type === "message_delta") {
              const u = (j.usage as { output_tokens?: number } | undefined)?.output_tokens
              const d = j.delta as { stop_reason?: string } | undefined
              if (d?.stop_reason || u !== undefined) {
                sawTerminal = true
                if (u !== undefined) o.onUsage?.({ in: -1, out: u })
              }
              if (d?.stop_reason) return
            } else if (j.type === "message_stop") {
              sawTerminal = true
              return
            } else if (j.type === "message_start") {
              const u = (j.message as { usage?: { input_tokens?: number } } | undefined)?.usage?.input_tokens
              if (u !== undefined) o.onUsage?.({ in: u, out: -1 })
            } else if (j.type === "error") {
              throw new Error(`provider stream error: ${JSON.stringify(j.error ?? j).slice(0, 200)}`)
            }
          } else {
            const choice = (j.choices as { delta?: { content?: string } }[] | undefined)?.[0]
            const chunk = choice?.delta?.content
            if (chunk) yield chunk
            const u = j.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
            if (u && (u.prompt_tokens !== undefined || u.completion_tokens !== undefined)) {
              o.onUsage?.({ in: u.prompt_tokens ?? -1, out: u.completion_tokens ?? -1 })
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("provider stream error")) throw e
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  // A connection that closes without [DONE] / message_stop is an abnormal
  // termination: the answer is incomplete and must not look successful.
  if (!sawTerminal) throw new StreamIncompleteError()
}

export async function chatComplete(o: ChatOpts): Promise<string> {
  let out = ""
  for await (const c of streamChat(o)) out += c
  return out
}

// -------------------------------------------------------------- live catalog

const CACHE_TTL_MS = 60 * 60 * 1000

export interface LiveModel {
  id: string
  label: string
  provider: string
  ctx: string
}

function fmtCtx(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return `${n}`
}

function cachePath(routerId: string): string {
  return join(import.meta.dir, "..", "..", `models.cache.${routerId}.json`)
}

function loadCache(routerId: string): { at: number; models: LiveModel[] } | null {
  try {
    const c = JSON.parse(readFileSync(cachePath(routerId), "utf8")) as { at: number; models: LiveModel[] }
    return c && Array.isArray(c.models) ? c : null
  } catch {
    return null
  }
}

function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())
}

export function cachedModels(routerId = activeRouterId()): LiveModel[] {
  if (process.env.AISC_TUI_OFFLINE === "1") return []
  const c = loadCache(routerId)
  return c ? c.models : []
}

export async function fetchModels(force = false, routerId = activeRouterId()): Promise<LiveModel[] | null> {
  const r = routerById(routerId) ?? activeRouter()
  const c = loadCache(r.id)
  if (!force && c && Date.now() - c.at < CACHE_TTL_MS) return c.models
  if (env("AISC_TUI_OFFLINE") === "1") return null
  if (!r.modelsUrl) return c ? c.models : null
  if (r.id === "custom" && !env("AISC_LLM_BASE_URL")) return c ? c.models : null
  try {
    const headers: Record<string, string> = {}
    const key = (() => {
      for (const e of r.keyEnvs) {
        const v = env(e)
        if (v) return v
      }
      return ""
    })()
    if (key) headers.Authorization = `Bearer ${key}`
    if (r.kind === "anthropic") {
      headers["x-api-key"] = key
      headers["anthropic-version"] = "2023-06-01"
    }
    const res = await fetch(r.modelsUrl, { headers, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return c ? c.models : null
    const j = (await res.json()) as {
      data?: ({ id?: string; name?: string; display_name?: string; model_name?: string; context_length?: number } | string)[]
      models?: { id?: string; name?: string }[]
    }
    const rows = (j.data ?? j.models ?? []) as ({ id?: string; name?: string; display_name?: string; model_name?: string; context_length?: number } | string)[]
    const list: LiveModel[] = rows
      .map((m) => (typeof m === "string" ? { id: m, name: "", context_length: 0 } : m))
      .filter((m) => m.id && (m.id.includes("/") || r.id !== "openrouter"))
      .map((m) => {
        const id = m.id!
        const [prov, ...rest] = id.split("/")
        const native = rest.join("/") || id
        return {
          id,
          label: (m.name || m.display_name || m.model_name || native).split(":")[0],
          provider: r.id === "openrouter" ? titleCase(prov) : r.label,
          ctx: m.context_length ? fmtCtx(m.context_length) : "—",
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 300)
    if (list.length) {
      try {
        writeFileSync(cachePath(r.id), JSON.stringify({ at: Date.now(), models: list }))
      } catch {}
      return list
    }
    return c ? c.models : null
  } catch {
    return c ? c.models : null
  }
}

export function clearModelsCache(): void {
  for (const p of [join(import.meta.dir, "..", "models.cache.json"), join(import.meta.dir, "..", "models.cache.openrouter.json")]) {
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {}
  }
}
