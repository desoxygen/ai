import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PROJECT_ROOT } from "./aiscientist.ts"
import { activeRouter, llmBlockedReason, llmReady, streamChat, chatComplete, StreamIncompleteError, type ChatMsg } from "./llm.ts"

export type AgentEvent =
  | { type: "tool"; id: string; label: string; detail: string; ticks: number; output?: string[] }
  | { type: "thinking"; id: string; title: string; ticks: number }
  | { type: "text"; chunk: string; md?: boolean }
  | { type: "plan"; lines: string[] }

let counter = 0
const nid = () => `t${++counter}`

function projectContext(): string {
  try {
    const p = join(PROJECT_ROOT, "AGENTS.md")
    return existsSync(p) ? readFileSync(p, "utf8").slice(0, 6000) : ""
  } catch {
    return ""
  }
}

const SYSTEM =
  "You are the research engineer inside the AI-Scientist console — a bun/OpenTUI lab for the autonomous " +
  "research pipeline (ideas → novelty → experiments → writeup → review). You pair with the researcher: explain " +
  "code and experiments, debug failures, design and harden experiment.py, refine LaTeX writeups, critique results " +
  "like a careful reviewer, and propose concrete next steps. You know the pipeline stages live in " +
  "ai_scientist/pipeline.py and the per-template scaffolds in templates/<name>/.\n" +
  "Rules:\n" +
  "- Answer in the user's language. Be concise and concrete; use markdown code blocks for code and cite sources as path:line.\n" +
  "- Prefer the smallest correct change. When suggesting an experiment edit, name the file and the exact lines.\n" +
  "- Research actions are one sentence away: /ask <цель> makes the model itself call the pipeline tools " +
  "(run_pipeline, write_paper, skeleton_project, last_report, doctor). Suggest /ask instead of teaching the " +
  "user commands; never run long stages yourself.\n" +
  "- When a result looks too good or too bad, say so and suggest a sanity check before celebrating.\n" +
  "- Surface trade-offs (compute cost vs signal, novelty vs feasibility) rather than picking silently for the user."

const ADVISOR_SYSTEM =
  "You are the research ADVISOR on the AI-Scientist start menu — a senior PI, not a coding agent.\n" +
  "Your job is to help the researcher think: scope the project, pressure-test seed ideas for novelty and feasibility, " +
  "judge whether an experiment can actually answer the question, anticipate reviewer objections, and recommend which " +
  "template or run makes sense next. Reason about what makes a real contribution vs an incremental tweak.\n" +
  "Constraints:\n" +
  "- Do NOT write code, edit files, or launch anything here. Point the user to the menu keys: P open project, " +
  "N new project, R run pipeline, D dashboard.\n" +
  "- Be honest about weaknesses; a kind 'this is likely not novel because…' beats false encouragement.\n" +
  "- Keep answers short — a few sentences or tight bullets — and in the user's language."

const PLAN_ASK =
  "The user wants a task done. First reply ONLY with a numbered plan of 3-5 short imperative steps " +
  "(one step per line, no prose before or after). Do not execute anything yet."

export interface ForgedRole {
  role: string
  brief: string
}

const ROLE_FORGE_SYSTEM =
  "You are the staffing desk of a research lab. Given a task, invent the SINGLE best background " +
  "worker persona to execute it (e.g. ablation_statistician, lr_schedule_scout, latex_critic). " +
  "Reply EXACTLY two lines, no prose:\n" +
  "ROLE: <snake_case role name, max 26 chars>\n" +
  "BRIEF: <2-3 imperative sentences of operating instructions specific to this task>"

/** Forge a per-task agent persona instead of a generic "assistant".
 *  Falls back silently when no LLM is configured (offline tests, no key). */
export async function forgeRole(
  task: string,
  model: string,
  signal?: AbortSignal,
  hint = "",
): Promise<ForgedRole> {
  if (!llmReady()) return { role: "assistant", brief: "" }
  try {
    const out = await chatComplete({
      model,
      messages: [
        { role: "system", content: ROLE_FORGE_SYSTEM },
        { role: "user", content: hint ? `Task: ${task}\n${hint}` : `Task: ${task}` },
      ],
      signal,
    })
    const role = /ROLE:\s*([a-z0-9_]{2,26})/i.exec(out)?.[1]?.toLowerCase() ?? ""
    const brief = /BRIEF:\s*(.+)/i.exec(out)?.[1]?.trim().slice(0, 500) ?? ""
    if (!role) return { role: "assistant", brief: "" }
    return { role, brief }
  } catch {
    return { role: "assistant", brief: "" }
  }
}

function parsePlan(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+[.):]/.test(l))
    .slice(0, 6)
}

export async function* createResponse(
  history: ChatMsg[],
  prompt: string,
  model: string,
  agent: "build" | "plan" | "advisor",
  thought: string,
  opts?: { variant?: string | null; signal?: AbortSignal; extraSystem?: string; onUsage?: (u: { in: number; out: number }) => void },
): AsyncGenerator<AgentEvent> {
  yield { type: "thinking", id: nid(), title: thought, ticks: 4 }

  if (!llmReady()) {
    yield {
      type: "text",
      md: false,
      chunk:
        `LLM backend is not available: ${llmBlockedReason()}.\n` +
        `Set ${activeRouter().keyEnvs[0] ?? "AISC_LLM_API_KEY"} in ${".env"} at the project root, then retry (or switch router with /routers). ` +
        `Pipeline runs work without a key: /run <template> (watch them on the Dashboard).\n`,
    }
    return
  }

  const ctx = agent === "advisor" ? "" : projectContext()
  const base = agent === "advisor" ? ADVISOR_SYSTEM : SYSTEM
  const sys = [base, ctx ? `# Project context (AGENTS.md)\n${ctx}` : "", opts?.extraSystem ?? ""].filter(Boolean).join("\n\n")
  const messages: ChatMsg[] = [{ role: "system", content: sys }, ...history, { role: "user", content: prompt }]

  if (agent === "plan") {
    let planText = ""
    try {
      planText = await chatComplete({ model, messages: [...messages, { role: "user", content: PLAN_ASK }], signal: opts?.signal })
    } catch (e) {
      yield { type: "text", md: false, chunk: `Model request failed: ${String((e as Error).message ?? e)}\n` }
      return
    }
    const lines = parsePlan(planText)
    if (lines.length) yield { type: "plan", lines }
    yield { type: "tool", id: nid(), label: "plan", detail: "executing approved plan", ticks: 1 }
  }

  try {
    for await (const chunk of streamChat({ model, messages, variant: opts?.variant, signal: opts?.signal, onUsage: opts?.onUsage })) {
      yield { type: "text", chunk, md: true }
    }
    yield { type: "text", chunk: "\n", md: true }
  } catch (e) {
    if (opts?.signal?.aborted) return
    if (e instanceof StreamIncompleteError) {
      yield { type: "text", md: false, chunk: "\n⚠ ответ мог оборваться на середине (поток закрылся без терминального события) — проверьте полноту или переспросите.\n" }
      return
    }
    yield { type: "text", md: false, chunk: `Model request failed: ${String((e as Error).message ?? e)}\n` }
  }
}
