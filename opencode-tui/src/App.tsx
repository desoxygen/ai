import { homedir } from "node:os"
import { basename, join } from "node:path"
import { writeFileSync, readFileSync, existsSync, watch, readdirSync, mkdirSync, type FSWatcher } from "node:fs"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTimeline } from "@opentui/react"
import { ChatLog, fmtSec } from "./components/ChatLog.tsx"
import { HomeScreen } from "./components/HomeScreen.tsx"
import { FuzzyList, type FuzzyRow } from "./components/FuzzyList.tsx"
import { PromptInput } from "./components/PromptInput.tsx"
import { Sidebar, type FileRow, type WorkingRow } from "./components/Sidebar.tsx"
import { SlashMenu, type SlashItem } from "./components/SlashMenu.tsx"
import { WhichKey } from "./components/WhichKey.tsx"
import { Dialog } from "./components/Dialog.tsx"
import { Dashboard, sortPanels, type DashPanel } from "./components/Dashboard.tsx"
import { IdeasBrowser } from "./components/IdeasBrowser.tsx"
import { EMPTY_SYS, subscribeProcs, type SysStats } from "./lib/sysmon.ts"
import { ArticleReader } from "./components/ArticleReader.tsx"
import { articleFor } from "./lib/articles.ts"
import { Explorer } from "./components/Explorer.tsx"
import { NotesBoard, type NotePrompt } from "./components/NotesBoard.tsx"
import { AgentsWorkspace } from "./components/AgentsWorkspace.tsx"
import { createResponse, type AgentEvent } from "./lib/agent.ts"
import { createStore, jobElapsed, jobStageMap, listTemplates, readEvents, startRun as startAisRun, startSkeleton as startAisSkeleton, waitJobId, killTree, killPid, pidAlive, markJobStatus, deleteJobRecord, PROJECT_ROOT, eventsPath, type AisEvent, type AisStore, type RunHandle } from "./lib/aiscientist.ts"
import { apiKey, chatComplete, llmBlockedReason, llmReady, resolveModel, pipelineModel, streamChat, cachedModels, fetchModels, activeRouterId, hasEnv, routerLabel, setActiveRouter, ROUTERS, type ChatMsg } from "./lib/llm.ts"
import { createProject, validateName, type NewProjectInput } from "./lib/newproject.ts"
import { generateAgentsMd } from "./lib/initmd.ts"
import { openInEditor } from "./lib/editor.ts"
import { currentProjectName, listProjects, projectDescription, projectIdeasFull, projectInfo as buildProjectInfo, type IdeaFull, type ProjectInfo } from "./lib/project.ts"
import { flatten, findNode, loadChildren, makeRoot, type ExNode } from "./lib/explorer.ts"
import { EFFECT_NAMES, getActiveEffect, pickGerund, setActiveEffect } from "./lib/fx.ts"
import { fuzzyFilter, type FuzzyItem } from "./lib/fuzzy.ts"
import { contextualDiff, diffLines } from "./lib/diff.ts"
import { LABELS, createNote, deleteNote, listNotes, notesDir, setLabels, type Note } from "./lib/notes.ts"
import { createOrchestrator, type OrchState, type Worker } from "./lib/orchestrator.ts"
import { scanFiles } from "./lib/fsindex.ts"
import { runShell } from "./lib/shell.ts"
import { gitBranch } from "./lib/git.ts"
import { bell, copyToClipboard, setTitle } from "./lib/osc.ts"
import { notifyOS } from "./lib/notify.ts"
import { latestSessionId, listSessions, loadSession, saveSession } from "./lib/sessions.ts"
import { COMMANDS, LEADER_KEYS } from "./lib/keymap.ts"
import { AGENTS, applyTheme, C, CONTEXT_WINDOW, loadSettings, MODELS, patchSettings, settings, THEME_NAMES, TICK_MS, type ModelInfo } from "./theme.ts"
import type { Msg, Segment } from "./types.ts"

function welcomeMsg(_project: string): Msg {
  return {
    id: 0,
    role: "assistant",
    streaming: false,
    segments: [
      {
        kind: "text",
        id: "w1",
        md: false,
        text:
          `Session started. This is the research menu — Shift+P open project · Shift+N new project · Shift+R run pipeline · Shift+D dashboard, or just type a question below.\nChat answers come from the real model via the active LLM router (OpenRouter by default — set the key in .env; /routers switches).\nKeys: 1-6 workspaces · tab cycle · ctrl+p commands · ctrl+x leader · /delegate <task> runs a real background task.\nFirst run? /doctor checks the environment (key, vault, latex, python); /report exports a finished job.\n`,
      },
    ],
  }
}

let segId = 0
const sid = () => `s${++segId}`

const PRICE_PER_MTOK = 15
const CHARS_PER_TOKEN = 3.6

// Real provider-reported token usage; -1 sentinels merge with previous counts.
const realUsage = { in: 0, out: 0, seen: false }
function accumulateUsage(u: { in: number; out: number }): void {
  if (u.in >= 0) {
    realUsage.in = u.in
    realUsage.seen = true
  }
  if (u.out >= 0) {
    realUsage.out += u.out
    realUsage.seen = true
  }
}
function realCost(): number {
  if (!realUsage.seen) return 0
  // blended estimate at the session's list price; per-model pricing varies
  return ((realUsage.in + realUsage.out) / 1e6) * PRICE_PER_MTOK
}

type DlgKind = "palette" | "model" | "theme" | "effect" | "sessions" | "agents" | "history" | "aisjobs" | "projects" | "routers" | "notecolor" | "improve" | "skeleton"

const IMPROVE_PRESETS: { val: string; label: string; desc: string }[] = [
  { val: "off", label: "off", desc: "review once — no repair rounds" },
  { val: "on:6:1", label: "quick — min 6, 1 round", desc: "fix the paper once if the review scores below 6/10" },
  { val: "on:5:2", label: "balanced — min 5, 2 rounds", desc: "up to two fix rounds below 5/10" },
  { val: "on:7:3", label: "strict — min 7, 3 rounds", desc: "up to three fix rounds below 7/10" },
]

export function parseImprove(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  if (v === "off") return "off"
  if (v === "on") return "on:6:1"
  const m = /^(\d+(?:\.\d+)?):(\d+)$/.exec(v)
  if (m) return `on:${m[1]}:${m[2]}`
  const m3 = /^(\d+(?:\.\d+)?)\s+(\d+)$/.exec(v)
  if (m3) return `on:${m3[1]}:${m3[2]}`
  return null
}

export function improveLabel(cfg: string): string {
  const m = /^on:(\d+(?:\.\d+)?):(\d+)$/.exec(cfg)
  return m ? `on · ≥${m[1]} ×${m[2]}` : "off"
}

/** What the skeleton generator should research: prompt.json task + the first seed idea. */
function skeletonDescFor(root: string, name: string): string {
  try {
    const p = JSON.parse(readFileSync(join(root, "templates", name, "prompt.json"), "utf8")) as { task_description?: string }
    const sp = join(root, "templates", name, "seed_ideas.json")
    let idea = ""
    if (existsSync(sp)) {
      const seeds = JSON.parse(readFileSync(sp, "utf8")) as { Experiment?: string; Title?: string }[]
      if (Array.isArray(seeds) && seeds[0]) idea = `\nSeed idea: ${seeds[0].Experiment || seeds[0].Title || ""}`
    }
    return `${p.task_description ?? ""}${idea}`.trim()
  } catch {
    return ""
  }
}

interface NewProjectState {
  step: "name" | "desc" | "idea" | "system" | "skeleton" | "confirm"
  name: string
  desc: string
  idea: string
  system: string
  skeleton: boolean
  error?: string
}

type Ws = "chat" | "dash" | "expl" | "notes" | "agents" | "article"

interface DlgEntry {
  name: string
  desc?: string
  hint?: string
  category?: string
  prefix?: string
  nameColor?: string
  run: () => void
}

interface RunSlot {
  gen: AsyncGenerator<AgentEvent>
  buffer: AgentEvent[]
  inflight: boolean
  abort: AbortController
  pending: Map<string, number>
  mid: number
  start: number
  tokens: number
  cost: number
  thought: string
  agent: "build" | "plan" | "advisor"
  awaiting: boolean
  lastLogic: number
}

const SLASH: SlashItem[] = [
  { name: "/run", desc: "start AI-Scientist pipeline (/run <template>)" },
  { name: "/project", desc: "switch active research project" },
  { name: "/new-project", desc: "create a new research project (wizard)" },
  { name: "/routers", desc: "switch LLM router (OpenRouter, Anthropic, OpenAI, …)" },
  { name: "/delegate", desc: "give the main agent a task (/delegate <task>)" },
  { name: "/jobs", desc: "jump to an experiment" },
  { name: "/article", desc: "open the project's real document (paper.md / README.md, fullscreen)" },
  { name: "/report", desc: "export a job report to markdown (/report [jobId])" },
  { name: "/doctor", desc: "check the environment: key, vault, editor, latex" },
  { name: "/models", desc: "select model" },
  { name: "/themes", desc: "select theme" },
  { name: "/agents", desc: "select agent" },
  { name: "/sessions", desc: "switch session" },
  { name: "/new", desc: "new session" },
  { name: "/compact", desc: "summarize + shrink context (real model call)" },
  { name: "/undo", desc: "undo last exchange" },
  { name: "/redo", desc: "redo last undo" },
  { name: "/copy", desc: "copy last message" },
  { name: "/export", desc: "export session to markdown" },
  { name: "/timeline", desc: "show message timeline" },
  { name: "/status", desc: "session info" },
  { name: "/init", desc: "generate AGENTS.md from the real repo" },
  { name: "/editor", desc: "open $EDITOR on the working file" },
  { name: "/verbose", desc: "toggle tool output" },
  { name: "/effect", desc: "fullscreen post effect" },
  { name: "/animations", desc: "toggle animations" },
  { name: "/theme", desc: "alias of /themes" },
  { name: "/model", desc: "alias of /models" },
  { name: "/help", desc: "list commands and keys" },
  { name: "/exit", desc: "quit" },
]

function fmtNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return `${Math.round(n)}`
}

export function App() {
  const renderer = useRenderer()
  const timeline = useTimeline({ autoplay: false, duration: 60_000, loop: true })

  const restoredRef = useRef<{ id: number; title: string; createdAt: number; messages: Msg[] } | null>(null)
  if (!restoredRef.current) {
    const latestId = latestSessionId()
    const s = latestId !== null ? loadSession(latestId) : null
    if (s && s.messages.length > 1) {
      restoredRef.current = { id: s.id, title: s.title, createdAt: s.createdAt, messages: s.messages as Msg[] }
    }
  }
  const [msgs, setMsgs] = useState<Msg[]>(() =>
    restoredRef.current ? restoredRef.current.messages : [welcomeMsg(currentProjectName())],
  )
  const [chatWindow, setChatWindow] = useState(60) // render tail only; scroll-to-top loads more
  const [started, setStarted] = useState(false)
  const [modelIndex, setModelIndex] = useState(0)
  const [variantIndex, setVariantIndex] = useState(-1)
  const [agentIndex, setAgentIndex] = useState(0)
  const [themeName, setThemeName] = useState<string>(() => C.name)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [tipsOpen, setTipsOpen] = useState(true)
  const [filesOpen, setFilesOpen] = useState(true)
  const [todosOpen, setTodosOpen] = useState(true)
  const [dlg, setDlg] = useState<{ kind: DlgKind; query: string; index: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [bgRun, setBgRun] = useState<{ thought: string; start: number } | null>(null)
  const [planDlg, setPlanDlg] = useState<{ mid: number; lines: string[] } | null>(null)
  const [leader, setLeader] = useState(false)
  const [quitHint, setQuitHint] = useState(false)
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [anim, setAnim] = useState(() => loadSettings().animations)
  const [verbose, setVerbose] = useState(() => settings.verbose)
  const [effectName, setEffectName] = useState(() => getActiveEffect())
  const [value, setValue] = useState("")
  const [menuIdx, setMenuIdx] = useState(0)
  const [toast, setToast] = useState<{ text: string; kind: "info" | "ok" | "warn" | "err" } | null>(null)
  const [size, setSize] = useState({ w: 80, h: 24 })
  const [branch, setBranch] = useState<string | null>(null)
  const [ws, setWs] = useState<Ws>("chat")
  const [projectName, setProjectName] = useState<string>(() => currentProjectName())
  const [workerFocus, setWorkerFocus] = useState(0)
  const [logOpen, setLogOpen] = useState<number | null>(null)
  const [agentPrompt, setAgentPrompt] = useState<string | null>(null)
  const [agentPromptMode, setAgentPromptMode] = useState<"delegate" | "clarify" | "ask">("delegate")
  const [clarifyTarget, setClarifyTarget] = useState<number | null>(null)
  const clarifyTargetRef = useRef<number | null>(null)
  const agentPromptRef = useRef<string | null>(null)
  const [dashFocus, setDashFocus] = useState(0)
  const [dashDelArmed, setDashDelArmed] = useState<number | null>(null)
  const dashDelArmedRef = useRef<number | null>(null)
  const dashDelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [exCursor, setExCursor] = useState(0)
  const [exFilter, setExFilter] = useState<{ active: boolean; query: string; idx: number }>({ active: false, query: "", idx: 0 })
  const [exDiff, setExDiff] = useState<{ title: string; lines: { kind: "same" | "add" | "del"; text: string }[] } | null>(null)
  const [aisTick, setAisTick] = useState(0)
  const [todos, setTodos] = useState<{ text: string; status: "pending" | "in_progress" | "done" }[]>([])
  const [notesList, setNotesList] = useState<Note[]>([])
  const [notesErr, setNotesErr] = useState<string | null>(null)
  const [notePrompt, setNotePrompt] = useState<NotePrompt | null>(null)
  const [noteFocus, setNoteFocus] = useState(0)
  const [delArmed, setDelArmed] = useState<string | null>(null)
  const [ideaView, setIdeaView] = useState<"ideas" | "notes">("ideas")
  const [ideaFilter, setIdeaFilter] = useState<{ active: boolean; query: string }>({ active: false, query: "" })
  const [ideaCursor, setIdeaCursor] = useState(0)
  const [spark, setSpark] = useState<number[]>(() => Array(24).fill(0))
  const [, forceRender] = useState(0)
  const [projectsList, setProjectsList] = useState<string[]>(() => listProjects())
  const [liveModels, setLiveModels] = useState<{ id: string; label: string; provider: string; ctx: string }[]>(() => cachedModels())
  const [np, setNp] = useState<NewProjectState | null>(null)
  const npRef = useRef<NewProjectState | null>(null)
  const setNpBoth = useCallback((p: NewProjectState | null) => {
    npRef.current = p
    setNp(p)
  }, [])
  const [routerId, setRouterId] = useState<string>(() => {
    const saved = loadSettings().router
    return ROUTERS.some((r) => r.id === saved) ? saved : "openrouter"
  })
  const routerIdRef = useRef(routerId)
  useEffect(() => {
    routerIdRef.current = routerId
    setActiveRouter(routerId)
  }, [routerId])

  const ALL_MODELS: ModelInfo[] = useMemo(() => {
    const out: ModelInfo[] = [MODELS[0]]
    const seen = new Set<string>([MODELS[0].id])
    for (const m of liveModels) {
      if (seen.has(m.id) || out.length >= 80) continue
      seen.add(m.id)
      out.push({
        id: m.id,
        provider: m.provider,
        ctx: m.ctx,
        variants: /claude|gpt-5|gemini-2\.5-pro|o[134]|r1|reasoner|thinking|glm/.test(m.id) ? ["none", "thinking"] : ["none"],
      })
    }
    for (const m of MODELS.slice(1)) if (!seen.has(m.id)) out.push(m)
    return out
  }, [liveModels])

  useEffect(() => {
    const saved = loadSettings().model
    const i = saved ? ALL_MODELS.findIndex((m) => m.id === saved) : -1
    setModelIndex(i >= 0 ? i : 0)
  }, [ALL_MODELS])

  const inputRef = useRef<InputRenderable | null>(null)
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const articleScrollRef = useRef<ScrollBoxRenderable | null>(null)
  const fgRef = useRef<RunSlot | null>(null)
  const bgRef = useRef<RunSlot | null>(null)
  const msgIdRef = useRef(1)
  const lastEscRef = useRef(0)
  const busyRef = useRef(false)
  const startedRef = useRef(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionCostRef = useRef(0)
  const clockRef = useRef({ acc: 0, lastVisual: 0 })
  const frameRef = useRef<(dt: number) => void>(() => {})
  const sessionsRef = useRef<Map<number, Msg[]>>(new Map())
  const activeSessionRef = useRef(restoredRef.current?.id ?? 1)
  const sessionListRef = useRef<{ id: number; title: string; createdAt: number }[]>(
    restoredRef.current
      ? [restoredRef.current, { id: 1, title: "new session", createdAt: Date.now() }]
      : [{ id: 1, title: "new session", createdAt: Date.now() }],
  )
  const [sessionList, setSessionList] = useState(sessionListRef.current)
  const fileIndexRef = useRef<string[]>([])
  const [fileCount, setFileCount] = useState(0)
  const projFilesRef = useRef<string[]>([])
  const [projCount, setProjCount] = useState(0)
  const charsThisWindow = useRef(0)
  const sparkWindowRef = useRef(0)
  const historyRef = useRef<string[]>([])
  const histPosRef = useRef(-1)
  const draftRef = useRef("")
  const undoStack = useRef<{ user: Msg; asst: Msg[] }[]>([])
  const redoStack = useRef<{ user: Msg; asst: Msg[] }[]>([])
  const valueRef = useRef("")
  const storeRef = useRef<AisStore>(null as unknown as AisStore)
  if (!storeRef.current) storeRef.current = createStore()
  const rootRef = useRef<ExNode>(makeRoot(PROJECT_ROOT, basename(PROJECT_ROOT)))
  const [rootSeq, setRootSeq] = useState(0)
  const handlesRef = useRef<Map<number, RunHandle>>(new Map())
  const taskCtlRef = useRef<Map<number, AbortController>>(new Map())
  const jobMsgRef = useRef<Map<number, number>>(new Map())
  const stageSegRef = useRef<Map<number, Map<string, string>>>(new Map())
  const ownJobsRef = useRef<Set<number>>(new Set())
  const lastSeenRef = useRef<Map<number, number>>(new Map())
  const handoffRef = useRef(false)
  const aisPanelsRef = useRef<DashPanel[]>([])
  const exRowsRef = useRef<ExNode[]>([])
  const focusRef = useRef({ dash: 0, ex: 0, notes: 0, agents: 0, ideas: 0 })
  const notePromptRef = useRef<NotePrompt | null>(null)
  const notePreviewRef = useRef<ScrollBoxRenderable | null>(null)
  const [notePreviewTick, setNotePreviewTick] = useState(0)
  const noteRowsRef = useRef<Note[]>([])
  const ideaRowsRef = useRef<IdeaFull[]>([])
  const delArmedRef = useRef<string | null>(null)
  const orchRef = useRef<ReturnType<typeof createOrchestrator> | null>(null)
  if (!orchRef.current) orchRef.current = createOrchestrator()
  const orchStateRef = useRef<OrchState | null>(null)
  const [orchV, setOrchV] = useState(0)
  const delTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bumpDash = useCallback((i: number) => {
    focusRef.current.dash = i
    setDashFocus(i)
  }, [])
  const bumpEx = useCallback((i: number) => {
    focusRef.current.ex = i
    setExCursor(i)
  }, [])
  const bumpNotes = useCallback((i: number) => {
    focusRef.current.notes = i
    setNoteFocus(i)
  }, [])
  const bumpIdeas = useCallback((i: number) => {
    focusRef.current.ideas = i
    setIdeaCursor(i)
  }, [])
  const bumpAgents = useCallback((i: number) => {
    focusRef.current.agents = i
    setWorkerFocus(i)
  }, [])
  const setAgentPromptBoth = useCallback((p: string | null) => {
    agentPromptRef.current = p
    setAgentPrompt(p)
  }, [])
  const openClarify = useCallback((wid: number, mode: "clarify" | "ask" = "clarify") => {
    clarifyTargetRef.current = wid
    setClarifyTarget(wid)
    setAgentPromptMode(mode)
    setAgentPrompt("")
  }, [])
  const closeAgentPrompt = useCallback(() => {
    agentPromptRef.current = null
    clarifyTargetRef.current = null
    setClarifyTarget(null)
    setAgentPromptMode("delegate")
    setAgentPrompt(null)
  }, [])
  const setNotePromptBoth = useCallback((p: NotePrompt | null | ((cur: NotePrompt | null) => NotePrompt | null)) => {
    const next = typeof p === "function" ? p(notePromptRef.current) : p
    notePromptRef.current = next
    setNotePrompt(next)
  }, [])
  const setDelArmedBoth = useCallback((path: string | null) => {
    delArmedRef.current = path
    setDelArmed(path)
  }, [])
  const aisEventsRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dlgRef = useRef<{ kind: DlgKind; query: string; index: number } | null>(null)
  const menuIdxRef = useRef(0)
  const atIdxRef = useRef(0)
  const leaderRef = useRef(false)

  const openDialog = useCallback((kind: DlgKind, index = 0) => {
    const d = { kind, query: "", index }
    dlgRef.current = d
    setDlg(d)
  }, [])

  const mutateDlg = useCallback((fn: (d: NonNullable<typeof dlgRef.current>) => NonNullable<typeof dlgRef.current>) => {
    const cur = dlgRef.current
    if (!cur) return
    const next = fn(cur)
    dlgRef.current = next
    setDlg(next)
  }, [])

  const agent = AGENTS[agentIndex]
  const agentColor = agent.tokenColor === "primary" ? C.primary : C.info

  useEffect(() => {
    busyRef.current = busy
  }, [busy])
  useEffect(() => {
    startedRef.current = started
  }, [started])
  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        inputRef.current?.setText(valueRef.current)
      } catch {}
    }, 0)
    return () => clearTimeout(t)
  }, [ws])

  useEffect(() => {
    setSize({ w: renderer.width, h: renderer.height })
    const onResize = () => {
      setSize({ w: renderer.width, h: renderer.height })
      renderer.requestRender()
    }
    renderer.on("resize", onResize)
    setTitle(`opencode · ${process.cwd().split(/[\\/]/).pop()}`)
    return () => {
      renderer.off("resize", onResize)
    }
  }, [renderer])

  useEffect(() => {
    gitBranch(PROJECT_ROOT).then(setBranch)
    scanFiles(process.cwd()).then((f) => {
      fileIndexRef.current = f
      setFileCount(f.length)
    })
    scanFiles(PROJECT_ROOT).then((f) => {
      projFilesRef.current = f
      setProjCount(f.length)
    })
  }, [])

  const cwd = process.cwd().replace(homedir(), "~")

  const showToast = useCallback((text: string, kind: "info" | "ok" | "warn" | "err" = "info") => {
    setToast({ text, kind })
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 4000)
  }, [])

  const updateAssistant = useCallback((mid: number, fn: (segs: Segment[]) => Segment[], streaming?: boolean) => {
    setMsgs((prev) =>
      prev.map((m) => (m.id === mid && m.role === "assistant" ? { ...m, streaming: streaming ?? m.streaming, segments: fn(m.segments) } : m)),
    )
  }, [])

  const reduceAisEvent = useCallback((ev: AisEvent) => {
    const jid = ev.job_id ?? 0
    if (!ownJobsRef.current.has(jid)) return
    let mid = jobMsgRef.current.get(jid)
    if (mid === undefined) {
      mid = msgIdRef.current++
      jobMsgRef.current.set(jid, mid)
      setStarted(true)
      startedRef.current = true
      setMsgs((prev) => [...prev, { id: mid!, role: "assistant", segments: [], streaming: true }])
    }
    const stages = stageSegRef.current.get(jid) ?? new Map<string, string>()
    stageSegRef.current.set(jid, stages)
    if (ev.stage === "run" && ev.status === "started") return
    if (ev.status === "started" && ev.stage !== "system") {
      const id = sid()
      stages.set(ev.stage, id)
      updateAssistant(mid, (segs) => [
        ...segs,
        { kind: "text", id: sid(), text: "" },
        { kind: "tool", id, label: ev.stage, detail: ev.message, status: "running", bornAt: Date.now() },
      ])
      return
    }
    if (ev.status === "log") {
      const segIdForRun = [...stages.values()].pop()
      updateAssistant(mid, (segs) =>
        segs.map((s) => (s.kind === "tool" && s.id === segIdForRun ? { ...s, output: [...(s.output ?? []), ev.message].slice(-30) } : s)),
      )
      return
    }
    const target = stages.get(ev.stage)
    if (target) {
      updateAssistant(mid, (segs) =>
        segs.map((s) =>
          s.kind === "tool" && s.id === target
            ? {
                ...s,
                status: ev.status === "fail" ? ("error" as const) : ("done" as const),
                doneAt: Date.now(),
                detail: ev.message || s.detail,
                output: [...(s.output ?? []), ...(ev.detail?.error ? [`error: ${ev.detail.error}`] : []), ...(ev.detail?.path ? [`→ ${ev.detail.path}`] : [])],
              }
            : s,
        ),
      )
      if (ev.status === "fail") showToast(`${ev.stage}: ${ev.message}`, "err")
    }
    if (ev.stage === "run" && ev.status === "done") {
      const j = storeRef.current.jobs.find((x) => x.id === jid)
      setMsgs((prev) =>
        prev.map((m) =>
          m.id === mid && m.role === "assistant"
            ? { ...m, streaming: false, meta: { agent: "build", model: ev.model || j?.model || "aiscientist", ms: j ? jobElapsed(j) : 0 } }
            : m,
        ),
      )
      bell()
      notifyOS("AI-Scientist", `job ${jid} completed — ${j?.template || ""}`)
      showToast(`job ${jid} completed`, "ok")
    }
    if (ev.stage === "run" && ev.status === "fail") {
      setMsgs((prev) =>
        prev.map((m) => (m.id === mid && m.role === "assistant" ? { ...m, streaming: false, meta: { agent: "build", model: "aiscientist", ms: 0, interrupted: !!ev.detail?.aborted } } : m)),
      )
      showToast(`job ${jid} ${ev.detail?.aborted ? "aborted" : "failed"}`, ev.detail?.aborted ? "warn" : "err")
    }
  }, [showToast, updateAssistant])

  useEffect(() => {
    const store = storeRef.current
    const un = store.subscribe((kind, jobId) => {
      if (kind === "event" && jobId !== undefined) {
        const list = store.events.get(jobId) ?? []
        const seen = lastSeenRef.current.get(jobId) ?? 0
        for (let i = seen; i < list.length; i++) reduceAisEvent(list[i])
        lastSeenRef.current.set(jobId, list.length)
      }
      setAisTick((t) => t + 1)
    })
    store.start()
    setAisTick((t) => t + 1)
    return () => {
      un()
      store.dispose()
    }
  }, [reduceAisEvent])


  const menu = useMemo(() => {
    const v = value
    if (dlg || !v.startsWith("/") || v.slice(1).includes(" ")) return [] as SlashItem[]
    return SLASH.filter((c) => c.name.startsWith(v.toLowerCase()))
  }, [value, dlg])
  const menuOpen = menu.length > 0

  const atMenu = useMemo(() => {
    if (dlg || menuOpen) return { open: false, items: [] as FuzzyItem<{ path: string }>[], token: "" }
    const m = value.match(/(^|\s)@([^\s]*)$/)
    if (!m) return { open: false, items: [] as FuzzyItem<{ path: string }>[], token: "" }
    const query = m[2]
    const items = fuzzyFilter(
      query,
      fileIndexRef.current.map((path) => ({ path })),
      (f) => f.path,
    ).slice(0, 7)
    return { open: items.length > 0 && query.length > 0, items, token: `@${query}` }
  }, [value, dlg, menuOpen, fileCount])
  const [atIdx, setAtIdx] = useState(0)
  useEffect(() => {
    atIdxRef.current = 0
    setAtIdx(0)
  }, [atMenu.token])

  const handleValueChange = useCallback((v: string) => {
    menuIdxRef.current = 0
    setMenuIdx(0)
    setValue(v)
  }, [])

  const finishSlot = useCallback(
    (key: "fg" | "bg", aborted: boolean, note?: string) => {
      const slot = key === "fg" ? fgRef.current : bgRef.current
      if (!slot) return
      if (key === "fg") fgRef.current = null
      else bgRef.current = null
      if (planDlg?.mid === slot.mid) setPlanDlg(null)
      slot.abort.abort()
      try {
        slot.gen.return(undefined as never)
      } catch {}
      slot.buffer.length = 0
      slot.pending.clear()
      const meta = { agent: slot.agent, model: ALL_MODELS[modelIndex].id, ms: Date.now() - slot.start, interrupted: aborted }
      setMsgs((prev) =>
        prev.map((m) => {
          if (m.id !== slot.mid || m.role !== "assistant") return m
          const done = m.segments
            .map((s) =>
              s.kind !== "text" && s.status === "running" ? { ...s, status: "done" as const, doneAt: Date.now() } : s,
            )
            .filter((s) => !(s.kind === "text" && s.text === ""))
          const segs = aborted
            ? [...done, { kind: "tool" as const, id: sid(), label: "error", detail: note ?? "generation aborted", status: "error" as const, bornAt: Date.now(), doneAt: Date.now() }]
            : done
          return { ...m, streaming: false, segments: segs, meta }
        }),
      )
      if (key === "fg") setBusy(false)
      else {
        setBgRun(null)
        if (!aborted) {
          bell()
          showToast("background task completed", "ok")
        }
      }
    },
    [modelIndex, planDlg, showToast],
  )

  const slotOfMid = useCallback((mid: number): "fg" | "bg" | null => {
    if (fgRef.current?.mid === mid) return "fg"
    if (bgRef.current?.mid === mid) return "bg"
    return null
  }, [])

  const todoProgress = useCallback(() => {
    setTodos((prev) => {
      const i = prev.findIndex((t) => t.status === "in_progress")
      if (i >= 0) return prev.map((t, j) => (j === i ? { ...t, status: "done" as const } : j === i + 1 ? { ...t, status: "in_progress" as const } : t))
      const j = prev.findIndex((t) => t.status === "pending")
      if (j >= 0) return prev.map((t, k) => (k === j ? { ...t, status: "in_progress" as const } : t))
      return prev
    })
  }, [])

  const pumpSlot = useCallback(
    (key: "fg" | "bg") => {
      const slot = key === "fg" ? fgRef.current : bgRef.current
      if (!slot || slot.awaiting) return
      const { mid } = slot

      for (const [id, left] of [...slot.pending.entries()]) {
        if (left <= 1) {
          slot.pending.delete(id)
          updateAssistant(mid, (segs) => segs.map((s) => (s.kind !== "text" && s.id === id ? { ...s, status: "done" as const, doneAt: Date.now() } : s)))
          todoProgress()
        } else {
          slot.pending.set(id, left - 1)
        }
      }

      if (slot.buffer.length === 0) {
        if (slot.inflight) return
        slot.inflight = true
        slot.gen
          .next()
          .then((r) => {
            slot.inflight = false
            const cur = key === "fg" ? fgRef.current : bgRef.current
            if (cur !== slot) return
            if (r.done) {
              finishSlot(key, false)
              return
            }
            slot.buffer.push(r.value)
          })
          .catch((e: unknown) => {
            slot.inflight = false
            const cur = key === "fg" ? fgRef.current : bgRef.current
            if (cur === slot && !slot.abort.signal.aborted) finishSlot(key, true, String((e as Error)?.message ?? e))
          })
        return
      }
      const ev = slot.buffer.shift()!
      if (ev.type === "plan") {
        slot.awaiting = true
        if (key === "fg") setPlanDlg({ mid, lines: ev.lines })
        else {
          bgRef.current = null
          slot.awaiting = false
          fgRef.current = slot
          setBusy(true)
          setBgRun(null)
          setPlanDlg({ mid, lines: ev.lines })
        }
        return
      }
      if (ev.type === "thinking" || ev.type === "tool") {
        slot.pending.set(ev.id, ev.ticks)
        if (ev.type === "thinking") {
          updateAssistant(mid, (segs) => [
            ...segs,
            { kind: "text", id: sid(), text: "" },
            { kind: "thinking", id: ev.id, title: ev.title, status: "running", bornAt: Date.now() },
          ])
        } else {
          updateAssistant(mid, (segs) => [
            ...segs,
            { kind: "text", id: sid(), text: "" },
            { kind: "tool", id: ev.id, label: ev.label, detail: ev.detail, status: "running", bornAt: Date.now(), output: ev.output },
          ])
        }
      } else {
        slot.tokens += ev.chunk.length / CHARS_PER_TOKEN
        slot.cost += (ev.chunk.length / CHARS_PER_TOKEN / 1e6) * PRICE_PER_MTOK
        sessionCostRef.current += (ev.chunk.length / CHARS_PER_TOKEN / 1e6) * PRICE_PER_MTOK
        charsThisWindow.current += ev.chunk.length
        updateAssistant(mid, (segs) => {
          const next = [...segs]
          const last = next[next.length - 1]
          if (last && last.kind === "text" && last.md === !!ev.md) {
            next[next.length - 1] = { ...last, text: last.text + ev.chunk }
          } else {
            next.push({ kind: "text", id: sid(), text: ev.chunk, md: ev.md })
          }
          return next
        })
      }
    },
    [finishSlot, todoProgress, updateAssistant],
  )

  const glideFrame = useCallback(() => {
    const sb = scrollRef.current
    if (!sb || !startedRef.current) return
    // load-earlier: scrolled to the very top with history off-screen → extend
    if (sb.scrollTop <= 0 && msgs.length > chatWindow) {
      setChatWindow((w) => w + 40)
      return
    }
    try {
      const max = Math.max(0, sb.scrollHeight - sb.viewport.height)
      const cur = sb.scrollTop
      if (!settings.animations) {
        sb.scrollTop = max
        return
      }
      if (cur < max - 0.5) {
        const step = Math.max(1, (max - cur) * 0.35)
        sb.scrollTop = Math.min(max, cur + step)
      }
    } catch {}
  }, [msgs.length, chatWindow])

  frameRef.current = (dt: number) => {
    const cl = clockRef.current
    cl.acc += dt
    if (cl.acc - cl.lastVisual >= 70) {
      cl.lastVisual = cl.acc
      setTick((t) => t + 1)
      setNow(Date.now())
      glideFrame()
      sparkWindowRef.current += dt
      if (sparkWindowRef.current >= 250) {
        sparkWindowRef.current = 0
        const cps = (charsThisWindow.current / 4) * (1000 / 250)
        charsThisWindow.current = 0
        setSpark((s) => [...s.slice(1), cps])
      }
    }
    if (busyRef.current && fgRef.current && cl.acc - fgRef.current.lastLogic >= TICK_MS) {
      fgRef.current.lastLogic = cl.acc
      pumpSlot("fg")
    }
    if (bgRef.current && cl.acc - bgRef.current.lastLogic >= TICK_MS * 2) {
      bgRef.current.lastLogic = cl.acc
      pumpSlot("bg")
    }
  }

  useEffect(() => {
    timeline.add({ v: 0 }, { v: 1, duration: TICK_MS, loop: true, onUpdate: (a: { deltaTime: number }) => frameRef.current(a.deltaTime) })
  }, [timeline])

  useEffect(() => {
    if (busy || bgRef.current) {
      timeline.play()
      return
    }
    const t = setTimeout(() => {
      if (!busyRef.current && !bgRef.current) timeline.pause()
    }, 400)
    return () => clearTimeout(t)
  }, [busy, bgRun, timeline])

  const activeVariant = useCallback((): string | null => {
    const vs = ALL_MODELS[modelIndex].variants.filter((v) => v !== "none")
    return variantIndex >= 0 ? vs[variantIndex % vs.length] ?? null : null
  }, [modelIndex, variantIndex])

  const sessionHistory = useCallback(
    (prev: Msg[]): ChatMsg[] => {
      const hist: ChatMsg[] = []
      let budget = 30_000
      for (const m of [...prev].reverse()) {
        if (hist.length >= 12 || budget <= 0) break
        if (m.role === "user" && !m.shell) {
          hist.unshift({ role: "user", content: m.text.slice(0, budget) })
          budget -= m.text.length
        } else if (m.role === "assistant" && !m.streaming) {
          const t = m.segments
            .filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text" && s.text.trim().length > 0)
            .map((s) => s.text)
            .join("")
          if (t) {
            hist.unshift({ role: "assistant", content: t.slice(0, Math.min(budget, 4000)) })
            budget -= t.length
          }
        }
      }
      return hist
    },
    [],
  )

  const startRun = useCallback(
    (prompt: string, runOpts?: { agentId?: "build" | "plan" | "advisor"; extraSystem?: string }) => {
      const mid = msgIdRef.current++
      const thought = pickGerund()
      const abort = new AbortController()
      const agentId = runOpts?.agentId ?? agent.id
      fgRef.current = {
        gen: createResponse(sessionHistory(msgs), prompt, ALL_MODELS[modelIndex].id, agentId, thought, { variant: activeVariant(), signal: abort.signal, extraSystem: runOpts?.extraSystem, onUsage: (u) => { accumulateUsage(u); setTick((t) => t + 1) } }),
        buffer: [],
        inflight: false,
        abort,
        pending: new Map(),
        mid,
        start: Date.now(),
        tokens: 0,
        cost: 0,
        thought,
        agent: agentId,
        awaiting: false,
        lastLogic: clockRef.current.acc,
      }
      setMsgs((prev) => [...prev, { id: mid, role: "assistant", segments: [], streaming: true }])
      setBusy(true)
    },
    [activeVariant, agent.id, msgs, modelIndex, sessionHistory],
  )

  const pushStatic = useCallback((text: string, label = "info", md = false) => {
    setStarted(true)
    startedRef.current = true
    const mid = msgIdRef.current++
    setMsgs((prev) => [
      ...prev,
      {
        id: mid,
        role: "assistant",
        streaming: false,
        segments: [
          { kind: "tool", id: sid(), label, detail: "", status: "done", bornAt: Date.now(), doneAt: Date.now() },
          { kind: "text", id: sid(), text, md },
        ],
      },
    ])
  }, [])

  const delegateTask = useCallback(
    (task: string, steerTo?: number) => {
      const o = orchRef.current
      if (!o) return
      let wid = steerTo ?? -1
      if (wid === -1) wid = o.beginTask(task)
      const prev = steerTo ? orchStateRef.current?.workers.find((x) => x.id === wid) : undefined
      const full = prev && prev.clarifications.length > 0
        ? `${prev.task}\n\nOperator clarifications:\n${prev.clarifications.map((c) => `- ${c}`).join("\n")}`
        : task
      if (steerTo) o.appendTaskLog(wid, "restarted with operator clarification")
      const oldCtl = taskCtlRef.current.get(wid)
      if (oldCtl) {
        oldCtl.abort()
        taskCtlRef.current.delete(wid)
      }
      const abort = new AbortController()
      taskCtlRef.current.set(wid, abort)
      if (!llmReady()) {
        o.appendTaskLog(wid, `LLM backend unavailable: ${llmBlockedReason()}`)
        o.finishTask(wid, "failed")
        showToast(`worker #${wid}: ${llmBlockedReason()}`, "err")
        return
      }
      o.appendTaskLog(wid, `model ${resolveModel(ALL_MODELS[modelIndex].id)} · streaming…`)
      let acc = ""
      let pendingLine = ""
      const sys =
        "You are a background worker of the AI-Scientist TUI main agent. Complete the task honestly and concisely; " +
        "if you cannot do something for real, say so. Answer in the language of the task."
      const run = async () => {
        for await (const chunk of streamChat({ model: ALL_MODELS[modelIndex].id, messages: [{ role: "system", content: sys }, { role: "user", content: full }], variant: activeVariant(), signal: abort.signal, onUsage: accumulateUsage })) {
          acc += chunk
          pendingLine += chunk
          const lines = pendingLine.split("\n")
          pendingLine = lines.pop() ?? ""
          for (const ln of lines) if (ln.trim()) o.appendTaskLog(wid, ln)
        }
        if (pendingLine.trim()) o.appendTaskLog(wid, pendingLine)
      }
      run()
        .then(() => {
          if (abort.signal.aborted) return
          o.setResult(wid, acc)
          o.finishTask(wid, "done")
          bell()
          notifyOS("AI-Scientist", `worker #${wid} finished`)
          showToast(`worker #${wid} finished`, "ok")
          pushStatic(`Delegated task «${full.slice(0, 60)}» — worker #${wid} result:\n\n${acc}`, "delegate", true)
        })
        .catch((e: unknown) => {
          if (abort.signal.aborted) return
          const status = "failed"
          o.appendTaskLog(wid, `error: ${String((e as Error)?.message ?? e)}`)
          o.finishTask(wid, status)
          showToast(`worker #${wid} failed`, "err")
        })
        .finally(() => {
          if (taskCtlRef.current.get(wid) === abort) taskCtlRef.current.delete(wid)
        })
    },
    [activeVariant, modelIndex, pushStatic, showToast],
  )

  const steerWorker = useCallback(
    (wid: number, clarification: string) => {
      const o = orchRef.current
      if (!o) return
      const w = o.steer(wid, clarification)
      if (!w) {
        showToast(`worker #${wid} is not running`, "warn")
        return
      }
      delegateTask("", wid)
      showToast(`worker #${wid} steered — restarting with clarification`, "info")
    },
    [delegateTask, showToast],
  )

  const quit = useCallback(() => {
    setTitle("")
    timeline.pause()
    renderer.destroy()
    process.exit(0)
  }, [renderer, timeline])

  const changeTheme = useCallback(
    (name: string) => {
      applyTheme(name)
      patchSettings({ theme: name })
      setThemeName(name)
      showToast(`theme: ${name}`, "ok")
    },
    [showToast],
  )

  const toggleAnimations = useCallback(
    (v?: boolean) => {
      const next = v ?? !settings.animations
      patchSettings({ animations: next })
      setAnim(next)
      forceRender((x) => x + 1)
      showToast(`animations: ${next ? "on" : "off"}`, "info")
    },
    [showToast],
  )

  const toggleVerbose = useCallback(() => {
    const next = !settings.verbose
    patchSettings({ verbose: next })
    setVerbose(next)
    showToast(`tool output: ${next ? "on" : "off"}`, "info")
  }, [showToast])

  const applyEffect = useCallback(
    (name: string) => {
      setActiveEffect(name)
      patchSettings({ effect: getActiveEffect() })
      setEffectName(getActiveEffect())
      showToast(`post effect: ${getActiveEffect()}`, "ok")
    },
    [showToast],
  )

  const archiveActive = useCallback(() => {
    sessionsRef.current.set(activeSessionRef.current, msgs)
    // persist so the conversation survives a TUI restart
    const stored = sessionListRef.current.find((s) => s.id === activeSessionRef.current)
    saveSession({
      id: activeSessionRef.current,
      title: stored?.title ?? "session",
      createdAt: stored?.createdAt ?? Date.now(),
      messages: msgs,
    })
  }, [msgs])

  const newSession = useCallback(() => {
    finishSlot("fg", true)
    bgRef.current = null
    setBgRun(null)
    archiveActive()
    const id = Math.max(...sessionListRef.current.map((s) => s.id)) + 1
    sessionListRef.current = [{ id, title: "new session", createdAt: Date.now() }, ...sessionListRef.current]
    setSessionList(sessionListRef.current)
    activeSessionRef.current = id
    setMsgs([welcomeMsg(projectName)])
    setStarted(false)
    startedRef.current = false
    histPosRef.current = -1
    setTodos([])
    undoStack.current = []
    redoStack.current = []
  }, [archiveActive, finishSlot, projectName])

  const switchSession = useCallback(
    (id: number) => {
      if (id === activeSessionRef.current) return
      finishSlot("fg", true)
      archiveActive()
      activeSessionRef.current = id
      const stored = sessionsRef.current.get(id)
      if (stored) {
        setMsgs(stored)
        setStarted(stored.length > 1)
        startedRef.current = stored.length > 1
      } else {
        setMsgs([welcomeMsg(projectName)])
        setStarted(false)
        startedRef.current = false
      }
      showToast(`switched to session ${id}`, "info")
    },
    [archiveActive, finishSlot, projectName, showToast],
  )

  const cycleAgent = useCallback(() => {
    setAgentIndex((i) => (i + 1) % AGENTS.length)
    showToast(`agent: ${AGENTS[(agentIndex + 1) % AGENTS.length].label}`, "info")
  }, [agentIndex, showToast])

  const cycleVariant = useCallback(() => {
    const vs = ALL_MODELS[modelIndex].variants.filter((v) => v !== "none")
    if (vs.length === 0) {
      showToast("no variants available", "warn")
      return
    }
    setVariantIndex((i) => (i + 1) % vs.length)
  }, [modelIndex, showToast])

  const approvePlan = useCallback(
    (ok: boolean) => {
      if (!planDlg) return
      const key = slotOfMid(planDlg.mid)
      setPlanDlg(null)
      if (!key) return
      const slot = key === "fg" ? fgRef.current : bgRef.current
      if (!slot) return
      if (ok) {
        slot.awaiting = false
        setTodos(planDlg.lines.map((l, i) => ({ text: l.replace(/^\d+\.\s*/, ""), status: i === 0 ? "in_progress" : ("pending" as const) })))
        updateAssistant(planDlg.mid, (segs) => [
          ...segs,
          { kind: "tool", id: sid(), label: "plan", detail: "approved — continuing", status: "done", bornAt: Date.now(), doneAt: Date.now() },
        ])
      } else {
        finishSlot(key, true, "plan rejected — no changes applied")
      }
    },
    [finishSlot, planDlg, slotOfMid, updateAssistant],
  )

  const lastAssistantText = useCallback((): string | null => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.role === "assistant" && !m.streaming) {
        const t = m.segments
          .filter((s): s is Extract<Segment, { kind: "text" }> => s.kind === "text" && s.text.length > 0)
          .map((s) => s.text)
          .join("")
        if (t) return t
      }
    }
    return null
  }, [msgs])

  const copyLast = useCallback(() => {
    const t = lastAssistantText()
    if (!t) {
      showToast("nothing to copy", "warn")
      return
    }
    copyToClipboard(t)
    showToast("copied last message to clipboard", "ok")
  }, [lastAssistantText, showToast])

  const exportSession = useCallback(() => {
    const t = lastAssistantText()
    if (!t) {
      showToast("nothing to export", "warn")
      return
    }
    const lines: string[] = ["# OpenCode session\n"]
    for (const m of msgs) {
      if (m.role === "user") lines.push(`## ${m.shell ? `$ ${m.text}` : m.text}\n`)
      else {
        for (const s of m.segments) {
          if (s.kind === "text" && s.text) lines.push(s.text.trimEnd(), "")
          else if (s.kind === "tool" && s.label !== "read") lines.push(`> \`${s.label}${s.detail ? ` ${s.detail}` : ""}\``, "")
        }
      }
    }
    const file = `session-${activeSessionRef.current}-${Date.now()}.md`
    try {
      writeFileSync(file, lines.join("\n"))
      copyToClipboard(lines.join("\n"))
      showToast(`exported → ${file}`, "ok")
    } catch (e) {
      showToast(`export failed: ${String((e as Error).message ?? e)}`, "err")
    }
  }, [lastAssistantText, msgs, showToast])

  const undoLast = useCallback(() => {
    if (busy) {
      showToast("cannot undo while generating", "warn")
      return
    }
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")
    if (!lastUser) {
      showToast("nothing to undo", "warn")
      return
    }
    const idx = msgs.indexOf(lastUser)
    const asst = msgs.slice(idx + 1).filter((m) => m.role === "assistant")
    undoStack.current.push({ user: lastUser, asst })
    redoStack.current = []
    setMsgs((prev) => prev.slice(0, idx))
    inputRef.current?.setText(lastUser.text)
    setValue(lastUser.text)
    showToast("undid last exchange", "info")
  }, [busy, msgs, showToast])

  const redoLast = useCallback(() => {
    const ex = undoStack.current.pop()
    if (!ex) {
      showToast("nothing to redo", "warn")
      return
    }
    redoStack.current.push(ex)
    setMsgs((prev) => [...prev, ex.user, ...ex.asst])
    showToast("redid message", "info")
  }, [showToast])

  const ctxRaw =
    1500 +
    msgs.reduce(
      (acc, m) => acc + (m.role === "user" ? m.text.length : m.segments.reduce((a, s) => a + (s.kind === "text" ? s.text.length : 0), 0)),
      0,
    ) / CHARS_PER_TOKEN
  const ctxK = Math.round(ctxRaw)
  const ctxPct = Math.min(100, Math.round((ctxK / CONTEXT_WINDOW) * 100))

  const doCompact = useCallback(async () => {
    if (ctxK < 25000 || msgs.length <= 2) {
      pushStatic(`context is light (${fmtNum(ctxK)} / ${fmtNum(CONTEXT_WINDOW)} tokens) — nothing worth compacting\n`, "compact")
      return
    }
    const transcript = msgs
      .map((m) =>
        m.role === "user"
          ? `USER: ${m.text}`
          : `ASSISTANT: ${m.segments.filter((s) => s.kind === "text").map((s) => (s.kind === "text" ? s.text : "")).join("")}`,
      )
      .join("\n")
      .slice(0, 60_000)
    if (!llmReady()) {
      pushStatic(`compaction needs the model: ${llmBlockedReason()} — session kept as-is\n`, "compact")
      return
    }
    pushStatic(`summarizing ${msgs.length} messages with ${resolveModel(ALL_MODELS[modelIndex].id)}…\n`, "compact")
    try {
      const summary = await chatComplete({
        model: ALL_MODELS[modelIndex].id,
        messages: [
          { role: "system", content: "Compress the following session transcript into a dense summary that preserves decisions, files, experiments and open questions. Reply with the summary only." },
          { role: "user", content: transcript },
        ],
      })
      const mid = msgIdRef.current++
      setMsgs([
        welcomeMsg(projectName),
        {
          id: mid,
          role: "assistant",
          streaming: false,
          segments: [
            { kind: "tool" as const, id: sid(), label: "compact", detail: `session summarized (${msgs.length} → 1)`, status: "done" as const, bornAt: Date.now(), doneAt: Date.now() },
            { kind: "text" as const, id: sid(), text: summary + "\n", md: true },
          ],
        },
      ])
      showToast(`context compacted: ${fmtNum(ctxK)} → ~${fmtNum(Math.round(summary.length / CHARS_PER_TOKEN + 1500))} tokens`, "ok")
    } catch (e) {
      pushStatic(`compaction failed: ${String((e as Error).message ?? e)}\n`, "error")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, ctxK, modelIndex, projectName])

  const runShellLine = useCallback(
    (cmd: string) => {
      const mid = msgIdRef.current++
      setMsgs((prev) => [
        ...prev,
        {
          id: mid,
          role: "assistant",
          streaming: true,
          segments: [{ kind: "tool", id: sid(), label: "bash", detail: cmd, status: "running", bornAt: Date.now() }],
        },
      ])
      setBusy(true)
      runShell(cmd, process.cwd()).then((res) => {
        const bornAt = Date.now()
        setMsgs((prev) =>
          prev.map((m) => {
            if (m.id !== mid || m.role !== "assistant") return m
            const first = m.segments[0]
            const start = first && first.kind === "tool" ? first.bornAt : Date.now()
            return {
              ...m,
              streaming: false,
              meta: { agent: "shell", model: "local", ms: Date.now() - start },
              segments: m.segments.map((s) =>
                s.kind === "tool" ? { ...s, status: res.code === 0 ? ("done" as const) : ("error" as const), doneAt: bornAt, output: res.output } : s,
              ),
            }
          }),
        )
        setBusy(false)
      })
    },
    [],
  )

  const store = storeRef.current

  const dashPanels: DashPanel[] = useMemo(() => {
    const raw: DashPanel[] = [...store.jobs].slice(-10).map((j) => {
      const evs = store.events.get(j.id) ?? readEvents(j.id)
      const sm = jobStageMap(evs)
      const lastEv = [...evs].reverse().find((e) => e.stage !== "run")
      return {
        id: j.id,
        title: `${j.template || "—"}${j.idea ? ` · ${j.idea}` : ""}`,
        status: j.status,
        elapsed: jobElapsed(j, Date.now()),
        model: (j.model || "").replace(/^openrouter\//, ""),
        chips: ["ideas", "novelty", "experiments", "writeup", "review"].map((s) => ({
          short: s[0].toUpperCase(),
          status: (sm.get(s) === "started" ? "running" : sm.get(s) ?? "pending") as "running" | "done" | "fail" | "pending",
        })),
        last: lastEv ? `[${lastEv.stage}] ${lastEv.message}` : "queued",
        rate: store.rate.get(j.id) ?? [],
      }
    })
    return sortPanels(raw)
  }, [aisTick, store])
  aisPanelsRef.current = dashPanels

  const dashLog = useMemo(() => {
    const f = dashPanels[Math.min(focusRef.current.dash, Math.max(0, dashPanels.length - 1))]
    const running = [...store.jobs].reverse().find((j) => j.status === "running")
    const j = (f ? store.jobs.find((x) => x.id === f.id) : undefined) ?? running ?? store.jobs[store.jobs.length - 1]
    if (!j) return { events: [] as AisEvent[], label: "—" }
    return { events: store.events.get(j.id) ?? readEvents(j.id), label: `job #${j.id} · ${j.template || j.module || "—"}` }
  }, [aisTick, dashPanels, store])

  const [sys, setSys] = useState<SysStats>(EMPTY_SYS)
  useEffect(() => {
    if (ws !== "dash") return
    return subscribeProcs(
      () =>
        store.jobs
          .filter((j) => j.status === "running" && j.pid && pidAlive(j.pid))
          .map((j) => ({ pid: j.pid as number, label: `job #${j.id} · ${j.template || "pipeline"}` })),
      setSys,
    )
  }, [ws, store])

  const articleDoc = useMemo(() => articleFor(projectName), [projectName, aisTick])

  const refreshProjects = useCallback(() => setProjectsList(listProjects()), [])
  useEffect(() => {
    let alive = true
    fetchModels().then((m) => {
      if (alive && m && m.length) setLiveModels(m)
    })
    return () => {
      alive = false
    }
  }, [])

  const selectProject = useCallback(
    (t: string) => {
      setProjectName(t)
      patchSettings({ project: t })
      showToast(`project: ${t}`, "info")
    },
    [showToast],
  )

  const selectRouter = useCallback(
    (id: string) => {
      const r = ROUTERS.find((x) => x.id === id)
      if (!r) return
      setRouterId(id)
      setActiveRouter(id)
      patchSettings({ router: id, model: "" })
      setModelIndex(0)
      setVariantIndex(-1)
      setLiveModels(cachedModels(id))
      fetchModels(false, id).then((m) => {
        if (m && m.length) setLiveModels(m)
      })
      showToast(`router: ${r.label} — ${r.needsKey && !apiKey() ? "set " + r.keyEnvs[0] + " in .env" : "ready"}`, r.needsKey && !apiKey() ? "warn" : "ok")
    },
    [showToast],
  )

  const handleCommandRef = useRef<(cmd: string) => boolean>(() => false)

  const doSkeleton = useCallback(
    async (name: string, description: string) => {
      const prevMax = store.jobs.reduce((m, j) => Math.max(m, j.id), 0)
      const h = startAisSkeleton({ name, description })
      pushStatic(`AI skeleton queued for «${name}» — the model writes experiment.py + plot.py and runs the run_0 baseline; progress lands on the Agents board (tab 5).\n`, "run")
      h.child.on("error", (e) => showToast(`spawn failed: ${String((e as Error).message ?? e)} — set $AISC_PYTHON`, "err"))
      const jid = await waitJobId(prevMax)
      if (jid === -1) {
        showToast("no skeleton job appeared in results/jobs.jsonl", "warn")
        return
      }
      ownJobsRef.current.add(jid)
      lastSeenRef.current.set(jid, 0)
      handlesRef.current.set(jid, h)
      h.child.on("close", () => handlesRef.current.delete(jid))
      store.refresh()
      showToast(`skeleton job #${jid} attached`, "ok")
    },
    [pushStatic, showToast, store],
  )

  const startWizard = useCallback(() => {
    setNpBoth({ step: "name", name: "", desc: "", idea: "", system: "", skeleton: true, error: undefined })
  }, [setNpBoth])

  const finishProjectCreation = useCallback(() => {
    const cur = npRef.current
    if (!cur) return
    const res = createProject({ name: cur.name, description: cur.desc, idea: cur.idea, system: cur.system })
    if (!res.ok) {
      setNpBoth({ ...cur, step: "name", error: res.error ?? "creation failed" })
      return
    }
    setNpBoth(null)
    refreshProjects()
    selectProject(cur.name)
    if (cur.skeleton) {
      pushStatic(
        `Project «${cur.name}» created at templates/${cur.name}/ — wrote ${res.files.join(", ")}.\n`,
        "project",
      )
      void doSkeleton(cur.name, `${cur.desc}\nSeed idea: ${cur.idea}`)
    } else {
      pushStatic(
        `Project «${cur.name}» created at templates/${cur.name}/ — wrote ${res.files.join(", ")}.\n` +
          (res.missing.length
            ? `Still missing for experiments: ${res.missing.join(", ")} — run /skeleton ${cur.name} to have the model generate them, or copy from a sibling template (press P to browse).\n`
            : "") +
          `Next: edit the seed idea if needed (/editor), then start the pipeline with /run ${cur.name} or press r on the research menu.\n`,
        "project",
      )
      showToast(`project «${cur.name}» created`, "ok")
    }
  }, [doSkeleton, pushStatic, refreshProjects, selectProject, setNpBoth, showToast])

  const npEnter = useCallback(() => {
    const cur = npRef.current
    if (!cur) return
    const strip = (s: string) => s.trim()
    switch (cur.step) {
      case "name": {
        const name = strip(cur.name)
        const err = validateName(name)
        if (err) {
          setNpBoth({ ...cur, name, error: err })
          return
        }
        setNpBoth({ ...cur, name, error: undefined, step: "desc" })
        return
      }
      case "desc": {
        const desc = strip(cur.desc)
        if (desc.length < 10) {
          setNpBoth({ ...cur, desc, error: "task description is required — at least 10 chars (it becomes prompt.json)" })
          return
        }
        setNpBoth({ ...cur, desc, error: undefined, step: "idea" })
        return
      }
      case "idea": {
        const idea = strip(cur.idea)
        if (idea.length < 10) {
          setNpBoth({ ...cur, idea, error: "a seed idea is required — at least 10 chars (it becomes seed_ideas.json)" })
          return
        }
        setNpBoth({ ...cur, idea, error: undefined, step: "system" })
        return
      }
      case "system":
        setNpBoth({ ...cur, system: strip(cur.system), error: undefined, step: "skeleton" })
        return
      case "skeleton":
        setNpBoth({ ...cur, error: undefined, step: "confirm" })
        return
      case "confirm":
        finishProjectCreation()
        return
    }
  }, [finishProjectCreation, setNpBoth])

  const npEscape = useCallback(() => {
    const cur = npRef.current
    if (!cur) return
    const back: Record<NewProjectState["step"], NewProjectState["step"] | null> = {
      name: null,
      desc: "name",
      idea: "desc",
      system: "idea",
      skeleton: "system",
      confirm: "skeleton",
    }
    const prev = back[cur.step]
    if (prev === null) setNpBoth(null)
    else setNpBoth({ ...cur, step: prev, error: undefined })
  }, [setNpBoth])

  const npAppend = useCallback(
    (ch: string) => {
      const cur = npRef.current
      if (!cur || cur.step === "confirm" || cur.step === "skeleton") return
      setNpBoth({ ...cur, [cur.step]: cur[cur.step] + ch, error: undefined })
    },
    [setNpBoth],
  )

  const npBackspace = useCallback(() => {
    const cur = npRef.current
    if (!cur || cur.step === "confirm" || cur.step === "skeleton") return
    setNpBoth({ ...cur, [cur.step]: cur[cur.step].slice(0, -1), error: undefined })
  }, [setNpBoth])

  const [runAsk, setRunAsk] = useState(false)
  const runAskRef = useRef(false)
  const setRunAskBoth = useCallback((v: boolean) => {
    runAskRef.current = v
    setRunAsk(v)
  }, [])

  const runCurrentProject = useCallback(() => {
    const tpls = listProjects()
    if (projectName && tpls.includes(projectName)) setRunAskBoth(true)
    else openDialog("projects", 0)
  }, [openDialog, projectName, setRunAskBoth])

  const continueProject = useCallback(() => {
    if (!projectName || !listProjects().includes(projectName)) {
      openDialog("projects", 0)
      return
    }
    patchSettings({ project: projectName })
    setWs("dash")
    setStarted(true)
    startedRef.current = true
    showToast(`continuing «${projectName}» — dashboard`, "info")
  }, [openDialog, projectName, showToast])

  const project: ProjectInfo | null = useMemo(
    () => (projectName ? buildProjectInfo(projectName, store.jobs, (id) => store.events.get(id) ?? readEvents(id)) : null),
    [projectName, store, aisTick],
  )

  const orch = orchRef.current
  const orchState: OrchState = orch.state(project)
  orchStateRef.current = orchState

  useEffect(() => {
    const o = orchRef.current
    if (!o) return
    const un = o.subscribe(() => setOrchV((v) => v + 1))
    o.start()
    return () => {
      un()
      o.dispose()
    }
  }, [])

  useEffect(() => {
    orchRef.current?.sync(project, store.jobs, (id) => store.events.get(id) ?? readEvents(id))
  }, [project, store, aisTick, orchV])

  const exRows: ExNode[] = useMemo(() => flatten(rootRef.current), [rootSeq, aisTick])
  exRowsRef.current = exRows

  const exHits: string[] = useMemo(() => {
    if (!exFilter.active) return []
    return fuzzyFilter(exFilter.query, projFilesRef.current.map((path) => ({ path })), (f) => f.path)
      .slice(0, 60)
      .map((f) => f.item.path)
  }, [exFilter, projCount])

  const openFile = useCallback(
    async (path: string) => {
      if (handoffRef.current) return
      handoffRef.current = true
      const r = await openInEditor(renderer, path)
      handoffRef.current = false
      if (!r.ok) showToast(`editor failed: ${r.error}`, "err")
      else {
        const dir = path.slice(0, Math.max(path.lastIndexOf("\\") ?? -1, path.lastIndexOf("/")))
        const n = dir ? findNode(rootRef.current, dir) : rootRef.current
        if (n && n.path === dir) {
          n.loaded = false
          n.children = null
          n.expanded = true
          setRootSeq((s) => s + 1)
        }
      }
      forceRender((x) => x + 1)
    },
    [renderer, showToast],
  )

  const reloadNotes = useCallback(
    (keepPath?: string) => {
      try {
        const list = listNotes()
        setNotesList(list)
        setNotesErr(null)
        let idx = keepPath ? list.findIndex((n) => n.path === keepPath) : -1
        if (idx < 0) idx = Math.max(0, Math.min(focusRef.current.notes, list.length - 1))
        focusRef.current.notes = idx
        setNoteFocus(idx)
      } catch (e) {
        setNotesErr(String((e as Error).message ?? e))
        setNotesList([])
      }
    },
    [],
  )

  useEffect(() => {
    notePromptRef.current = null
    setNotePrompt(null)
    setDelArmedBoth(null)
    setLogOpen(null)
    if (ws !== "notes") return
    reloadNotes()
    // live vault: edits made in Obsidian (or any editor) appear without
    // leaving the notes tab — watch is unreliable on Windows, so debounce.
    let watcher: FSWatcher | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      const dir = notesDir()
      watcher = watch(dir, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => reloadNotes(), 400)
      })
    } catch {}
    return () => {
      watcher?.close()
      if (timer) clearTimeout(timer)
    }
  }, [ws, reloadNotes, setDelArmedBoth])

  const noteRows: Note[] = useMemo(() => {
    const q = notePrompt?.mode === "filter" ? notePrompt.text.trim() : ""
    if (!q) return notesList
    return fuzzyFilter(q, notesList, (n) => `${n.title} ${n.name} ${n.labels.join(" ")}`).map((f) => f.item)
  }, [notesList, notePrompt])
  noteRowsRef.current = noteRows

  const allIdeas = useMemo(() => (projectName ? projectIdeasFull(projectName) : []), [projectName, aisTick])
  const ideaRows = useMemo(() => {
    const q = ideaFilter.query.trim().toLowerCase()
    if (!q) return allIdeas
    return allIdeas.filter((i) => i.name.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))
  }, [allIdeas, ideaFilter.query])
  ideaRowsRef.current = ideaRows


  const stopJob = useCallback(
    (jid: number) => {
      const h = handlesRef.current.get(jid)
      const j = storeRef.current.jobs.find((x) => x.id === jid)
      let killed = false
      if (h) {
        killTree(h.child)
        handlesRef.current.delete(jid)
        killed = true
      } else if (j?.pid && pidAlive(j.pid)) {
        killPid(j.pid)
        killed = true
      } else if (j?.status === "running") {
        showToast(`job ${jid}: process is gone — marking aborted`, "warn")
      } else {
        showToast(`job ${jid} is not running`, "info")
        return
      }
      markJobStatus(jid, "aborted")
      storeRef.current.refresh()
      showToast(killed ? `job ${jid}: process killed` : `job ${jid}: marked aborted`, "warn")
    },
    [showToast],
  )

  const removeJobRecord = useCallback(
    (jid: number) => {
      const j = storeRef.current.jobs.find((x) => x.id === jid)
      if (j && j.status === "running") {
        showToast(`job ${jid} is running — stop it first (x)`, "warn")
        return false
      }
      if (j?.pid && pidAlive(j.pid)) {
        killPid(j.pid)
        markJobStatus(jid, "aborted")
      }
      const ok = deleteJobRecord(jid)
      ownJobsRef.current.delete(jid)
      lastSeenRef.current.delete(jid)
      jobMsgRef.current.delete(jid)
      stageSegRef.current.delete(jid)
      storeRef.current.refresh()
      showToast(ok ? `job ${jid}: record removed from the board` : `job ${jid} not found`, ok ? "ok" : "warn")
      return ok
    },
    [showToast],
  )

  const doRun = useCallback(
    async (template: string, model?: string, improve?: string) => {
      const prevMax = store.jobs.reduce((m, j) => Math.max(m, j.id), 0)
      const improveCfg = improve ?? settings.improve ?? "off"
      const h = startAisRun({ template, model: model ? pipelineModel(model) : undefined, improve: improveCfg })
      const tail = /^on:/.test(improveCfg) ? ` --improve (${improveLabel(improveCfg)})` : ""
      pushStatic(`Launching pipeline: aiscientist run --template ${template}${tail}\n`, "run")
      h.child.on("error", (e) => showToast(`spawn failed: ${String((e as Error).message ?? e)} — set $AISC_PYTHON`, "err"))
      const jid = await waitJobId(prevMax)
      if (jid === -1) {
        showToast("no new job appeared in results/jobs.jsonl", "warn")
        return
      }
      ownJobsRef.current.add(jid)
      lastSeenRef.current.set(jid, 0)
      handlesRef.current.set(jid, h)
      h.child.on("close", () => handlesRef.current.delete(jid))
      store.refresh()
      showToast(`attached to job #${jid}`, "ok")
    },
    [pushStatic, showToast, store],
  )

  const modifiedFiles: FileRow[] = useMemo(() => {
    const out: FileRow[] = []
    for (const m of msgs) {
      if (m.role !== "assistant") continue
      for (const s of m.segments) {
        if (s.kind === "tool" && (s.label === "edit" || s.label === "write")) {
          const mm = s.detail.match(/^(\/?[\w./\\-]+)\s*—\s*\+(\d+)\s*−(\d+)/)
          if (mm) {
            const existing = out.find((f) => f.path === mm[1])
            if (existing) {
              existing.add += +mm[2]
              existing.del += +mm[3]
            } else out.push({ path: mm[1], add: +mm[2], del: +mm[3] })
          }
        }
      }
    }
    return out
  }, [msgs])

  const workingRows: WorkingRow[] = useMemo(() => {
    const rows: WorkingRow[] = []
    if (busy && fgRef.current) {
      const lastUser = [...msgs].reverse().find((m) => m.role === "user")
      rows.push({ glyph: "✎", color: "warn", text: lastUser ? lastUser.text : "generating…", sub: `${((now - fgRef.current.start) / 1000).toFixed(0)}s` })
    }
    if (bgRun) rows.push({ glyph: "⚡", color: "info", text: bgRun.thought, sub: `${((now - bgRun.start) / 1000).toFixed(0)}s` })
    for (const j of store.jobs.filter((x) => x.status === "running").slice(-3)) {
      rows.push({ glyph: "⚙", color: "warn", text: j.idea || j.template || `run #${j.id}`, sub: `#${j.id}` })
    }
    for (const w of orchState.workers.filter((x) => x.status === "running").slice(-3)) {
      rows.push({ glyph: "⇉", color: "info", text: w.name, sub: `${Math.round(w.progress * 100)}%` })
    }
    return rows.slice(0, 6)
  }, [msgs, busy, bgRun, orchState, store, now])

  const handleCommand = useCallback(
    (cmd: string): boolean => {
      const [name, ...args] = cmd.slice(1).trim().split(/\s+/)
      const nameL = (name ?? "").toLowerCase()
      const argsL = args.map((a) => a.toLowerCase())
      const open = (kind: DlgKind, index = 0) => openDialog(kind, index)
      switch (nameL) {
        case "themes":
        case "theme":
          if (args.length && THEME_NAMES.includes(argsL[0])) {
            changeTheme(argsL[0])
          } else open("theme", Math.max(0, THEME_NAMES.indexOf(themeName)))
          return true
        case "models":
        case "model":
          if (args.length && ALL_MODELS.some((m) => m.id.toLowerCase() === argsL[0])) {
            const found = ALL_MODELS.find((m) => m.id.toLowerCase() === argsL[0])!
            const id = found.id
            setModelIndex(ALL_MODELS.findIndex((m) => m.id === id))
            setVariantIndex(-1)
            patchSettings({ model: id })
            showToast(`model: ${id} (${found.provider})`, "ok")
          } else open("model", modelIndex)
          return true
        case "agents":
          open("agents", agentIndex)
          return true
        case "sessions":
          open("sessions", 0)
          return true
        case "run": {
          const tpls = listTemplates()
          if (!args.length) {
            pushStatic(`usage: /run <template> [--model m] [--improve [min:rounds]] — templates: ${tpls.join(", ")}\n`, "help")
            return true
          }
          if (!tpls.includes(args[0])) {
            pushStatic(`Unknown template "${args[0]}" — available: ${tpls.join(", ")}\n`, "error")
            return true
          }
          let improveForRun: string | undefined
          const impIdx = args.indexOf("--improve")
          if (impIdx >= 0) {
            const nxt = args[impIdx + 1]
            improveForRun = nxt && !nxt.startsWith("--") ? parseImprove(nxt) ?? "on:6:1" : "on:6:1"
          }
          void doRun(args[0], args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined, improveForRun)
          return true
        }
        case "skeleton": {
          if (!args.length) {
            open("skeleton", 0)
            return true
          }
          const nm = args[0]
          const tdir = join(PROJECT_ROOT, "templates", nm)
          if (!existsSync(tdir)) {
            pushStatic(`no such project: ${nm} — available: ${listProjects().join(", ")}\n`, "error")
            return true
          }
          if (existsSync(join(tdir, "experiment.py"))) {
            pushStatic(`project «${nm}» already has experiment.py — /skeleton only fills in missing skeletons\n`, "error")
            return true
          }
          void doSkeleton(nm, skeletonDescFor(PROJECT_ROOT, nm) || projectDescription(nm))
          return true
        }
        case "improve": {
          const val = args.join(" ")
          if (!val) {
            open("improve", 0)
            return true
          }
          const parsed = parseImprove(val)
          if (!parsed) {
            pushStatic("usage: /improve off | on | <min>:<rounds>  (e.g. /improve 6:1) — no arg opens the picker\n", "error")
            return true
          }
          patchSettings({ improve: parsed })
          showToast(`auto-improve: ${improveLabel(parsed)}`, "ok")
          return true
        }
        case "report": {
          const jobsAll = storeRef.current.jobs
          const job = args[0] ? jobsAll.find((j) => j.id === Number(args[0])) : jobsAll[jobsAll.length - 1]
          if (!job) {
            pushStatic("usage: /report [jobId] — no such job\n", "error")
            return true
          }
          const evs = readEvents(job.id)
          const sm = jobStageMap(evs)
          const lines: string[] = [
            `# Report — job #${job.id}`,
            "",
            `- template: ${job.template || "—"}`,
            `- idea: ${job.idea || "full run"}`,
            `- model: ${job.model || "default"}`,
            `- status: ${job.status}`,
            `- started: ${job.started_at || "—"}`,
            `- elapsed: ${jobElapsed(job)}`,
            "",
            "## Stages",
            "",
            ...["ideas", "novelty", "experiments", "writeup", "review", "improve"].map((s) => `- ${s}: ${sm.get(s) ?? "pending"}`),
            "",
            "## Last events",
            "",
            ...evs.slice(-20).map((e) => `- [${e.stage}/${e.status}] ${e.message}`),
            "",
          ]
          // attach the newest run folder artifacts if present
          try {
            const rd = join(PROJECT_ROOT, "results", job.template || "")
            if (existsSync(rd)) {
              const runs = readdirSync(rd).sort()
              const last = runs[runs.length - 1]
              if (last) {
                const lp = join(rd, last)
                lines.push(`## Artifacts (${last})`, "")
                for (const f of ["review.txt", "sanity.json", "run_meta.json", "notes.txt"]) {
                  const fp = join(lp, f)
                  if (existsSync(fp)) {
                    lines.push(`### ${f}`, "", "```", readFileSync(fp, "utf8").slice(0, 2000), "```", "")
                  }
                }
              }
            }
          } catch {}
          const out = lines.join("\n")
          try {
            const dir = join(PROJECT_ROOT, "results", "reports")
            mkdirSync(dir, { recursive: true })
            const file = join(dir, `job-${job.id}.md`)
            writeFileSync(file, out)
            copyToClipboard(out)
            pushStatic(`report → ${file} (+ clipboard)\n`, "report")
          } catch (e) {
            pushStatic(`report failed: ${String((e as Error).message ?? e)}\n`, "error")
          }
          return true
        }
        case "doctor": {
          pushStatic("doctor: checking environment…\n", "doctor")
          const hasKey = llmReady()
          let vault = "—"
          try {
            vault = notesDir()
          } catch (e) {
            vault = `NOT SET (${String((e as Error).message ?? e).slice(0, 60)})`
          }
          const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === "win32" ? "notepad (default)" : "nvim (default)")
          const rows: string[] = [
            `llm key/router: ${hasKey ? `OK (${routerLabel()})` : `MISSING — ${llmBlockedReason()}`}`,
            `obsidian vault: ${vault.startsWith("NOT SET") ? vault : `OK (${vault})`}`,
            `editor:         ${editor}`,
            `python:         ${process.env.AISC_PYTHON || "python"}`,
            `multi-seed:     AISC_EXP_SEEDS=${process.env.AISC_EXP_SEEDS || "1"}`,
            `idea budget:    AISC_IDEA_BUDGET_MINUTES=${process.env.AISC_IDEA_BUDGET_MINUTES || "off"}`,
            `auto-improve:   ${improveLabel(settings.improve)}${process.env.AISC_REVIEW_FIX_ITER ? ` (env legacy: iter ${process.env.AISC_REVIEW_FIX_ITER}, min ${process.env.AISC_REVIEW_MIN_SCORE || "off"})` : ""}`,
            `baseline:       ${projectName ? (existsSync(join(PROJECT_ROOT, "templates", projectName, "run_0", "final_info.json")) ? `OK (templates/${projectName}/run_0)` : `MISSING — run /skeleton ${projectName}`) : "no project selected"}`,
          ]
          const probe = (cmd: string) => runShell(cmd, process.cwd(), 8000).then((r) => `${cmd}: ${r.code === 0 ? "OK" : "NOT FOUND"}`)
          void Promise.all([probe("python --version"), probe("pdflatex --version"), probe("aider --version")]).then((checks) => {
            pushStatic(["environment:", ...rows, ...checks].map((l) => `  ${l}`).join("\n") + "\n", "doctor")
          })
          return true
        }
        case "jobs":
          open("aisjobs", 0)
          return true
        case "article":
          setWs("article")
          setStarted(true)
          startedRef.current = true
          return true
        case "project": {
          const tpls = listProjects()
          if (args.length && tpls.includes(args[0])) {
            selectProject(args[0])
          } else open("projects", 0)
          return true
        }
        case "new-project":
        case "newproject":
          startWizard()
          return true
        case "routers":
        case "router":
          if (args.length && ROUTERS.some((r) => r.id === argsL[0])) {
            selectRouter(argsL[0])
          } else open("routers", 0)
          return true
        case "delegate": {
          const task = cmd.slice(cmd.indexOf(" ") + 1).trim()
          if (task && !/^--?\w*$/.test(task)) {
            delegateTask(task)
            pushStatic(`Main agent accepted «${task}» and spawned a real worker — follow it on tab 5 (Agents); the result will be posted to chat.\n`, "delegate")
          } else {
            pushStatic("usage: /delegate <task> — the main agent runs the task with the model (Agents board · tab 5)\n", "help")
          }
          return true
        }
        case "effect":
          if (args.length && EFFECT_NAMES.includes(argsL[0])) applyEffect(argsL[0])
          else open("effect", Math.max(0, EFFECT_NAMES.indexOf(getActiveEffect())))
          return true
        case "animations":
          toggleAnimations(argsL[0] === "on" ? true : argsL[0] === "off" ? false : undefined)
          return true
        case "verbose":
          toggleVerbose()
          return true
        case "compact":
        case "summarize":
          doCompact()
          return true
        case "undo":
          undoLast()
          return true
        case "redo":
          redoLast()
          return true
        case "copy":
          copyLast()
          return true
        case "export":
          exportSession()
          return true
        case "timeline": {
          const t = msgs
            .map((m) => `${m.role === "user" ? "user" : "asst"} #${m.id}${m.role === "assistant" && m.meta ? ` ${fmtSec(m.meta.ms)}` : ""}`)
            .join(" → ")
          pushStatic(`${t}\n`, "timeline")
          return true
        }
        case "status":
          pushStatic(
            `model:    ${resolveModel(ALL_MODELS[modelIndex].id)} (${ALL_MODELS[modelIndex].provider})\n` +
              `llm:      ${routerId} — ${llmReady() ? `${routerLabel()} ready` : `unavailable — ${llmBlockedReason()}`}\n` +
              `agent:    ${agent.label} · theme: ${themeName} · ctx: ${fmtNum(ctxK)}/${fmtNum(CONTEXT_WINDOW)} (${ctxPct}%)\n` +
              `cwd:      ${cwd}${branch ? `:${branch}` : ""}\n` +
              `cost:     $${(realUsage.seen ? realCost() : sessionCostRef.current).toFixed(3)}${realUsage.seen ? ` · real tokens: ${fmtNum(realUsage.in)} in / ${fmtNum(realUsage.out)} out` : " (est.)"} · msgs: ${msgs.length} · fx: ${getActiveEffect()} · anim: ${settings.animations ? "on" : "off"}\n` +
              `runtime:  bun ${process.versions.bun} · opentui · jobs: ${storeRef.current.jobs.filter((x) => x.status === "running").length} running / ${storeRef.current.jobs.length} total\n`,
            "status",
          )
          return true
        case "new":
          newSession()
          return true
        case "init": {
          const agentsMd = join(PROJECT_ROOT, "AGENTS.md")
          if (existsSync(agentsMd) && argsL[0] !== "force") {
            pushStatic(`AGENTS.md already exists: ${agentsMd}\nRewrite it with: /init force\n`, "init")
            return true
          }
          try {
            const r = generateAgentsMd()
            pushStatic(`Wrote ${r.path} (scanned ${r.files} top-level dirs, ${listProjects().length} templates). The chat agent loads it as context on next request.\n`, "init")
          } catch (e) {
            pushStatic(`init failed: ${String((e as Error).message ?? e)}\n`, "error")
          }
          return true
        }
        case "editor": {
          const target = modifiedFiles[0]?.path ?? join(PROJECT_ROOT, "README.md")
          void openFile(target)
          return true
        }
        case "help":
          pushStatic(
              "workspaces: tab cycle · 1 Dashboard (главный экран) · 2 Chat · 3 Explorer · 4 Notes · 5 Agents board · 6 Article\n" +
               "research menu on boot: Shift+P open project · Shift+N new project · Shift+R run pipeline · Shift+D dashboard · Shift+I init\n" +
               "dashboard keys: a article · x stop/kill process · d remove job record · enter events · r re-run\n" +
               "notes keys: ↑↓ select · l color · L clear · enter edit · n new · x del · / filter · t ideas\n" +
               "agents keys: d delegate · s clarify worker · a ask worker (follow-up) · x kill · enter log\n" +
               "explorer keys: d diff run_N.py vs run_N-1 · enter edit · / filter\n" +
               "research quality: AISC_EXP_SEEDS=N (multi-seed) · AISC_IDEA_BUDGET_MINUTES · AISC_REVIEW_FIX_ITER + AISC_REVIEW_MIN_SCORE · sanity.json в прогоне · learnings.md\n" +
               "ctrl+p commands · ctrl+r history · ctrl+x leader · ctrl+b background · @ files · ! shell\n" +
                "esc interrupt — уточните и продолжите · esc esc quit\n" +
               "/run <template> · /project · /new-project · /routers · /delegate <task> · /jobs · /article · /report [id] · /doctor · /models /themes /agents /sessions /new /compact /undo /redo /copy /export /timeline /status /init [force] /editor /verbose /effect /animations /help /exit\n",
            "help",
          )
          return true
        case "exit":
        case "quit":
        case "q":
          quit()
          return true
        default:
          return false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      agent.label,
      agentIndex,
      applyEffect,
      branch,
      changeTheme,
      copyLast,
      ctxK,
      ctxPct,
      cwd,
      delegateTask,
      doCompact,
      doSkeleton,
      doRun,
      exportSession,
      msgs,
      modifiedFiles,
      modelIndex,
      newSession,
      openFile,
      pushStatic,
      quit,
       redoLast,
       selectProject,
       selectRouter,
       showToast,
       startWizard,
       themeName,
       toggleAnimations,
       toggleVerbose,
       undoLast,
    ],
  )
  handleCommandRef.current = handleCommand
 
   const send = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || busy || dlg || planDlg || leader) return
      if (atMenu.open) {
        const pick = atMenu.items[atIdxRef.current] ?? atMenu.items[0]
        if (pick) {
          const path = pick.item.path
          const v = text.replace(/(^|\s)@([^\s]*)$/, `$1@${path} `)
          inputRef.current?.setText(v)
          setValue(v)
          return
        }
      }
      const liveMenu = text.startsWith("/") && !text.slice(1).includes(" ") ? SLASH.filter((c) => c.name.startsWith(text.toLowerCase())) : []
      const isExactCommand = SLASH.some((c) => c.name === text.toLowerCase())
      if (!isExactCommand && liveMenu.length > 0) {
        const it = liveMenu[Math.min(menuIdxRef.current, liveMenu.length - 1)]
        inputRef.current?.setText(`${it.name} `)
        setValue(`${it.name} `)
        menuIdxRef.current = 0
        setMenuIdx(0)
        return
      }
      inputRef.current?.setText("")
      setValue("")
      historyRef.current.push(text)
      histPosRef.current = -1
      if (text.startsWith("/")) {
        setStarted(true)
        startedRef.current = true
        if (!handleCommand(text)) pushStatic(`Unknown command: ${text.split(/\s+/)[0]} - try /help\n`, "error")
        return
      }
      if (text.startsWith("!")) {
        setStarted(true)
        startedRef.current = true
        const cmd = text.slice(1).trim()
        if (!cmd) {
          showToast("empty shell command", "warn")
          return
        }
        setMsgs((prev) => [...prev, { id: msgIdRef.current++, role: "user", text: cmd, shell: true, ts: Date.now() }])
        runShellLine(cmd)
        return
      }
      // On the start menu the prompt is an ADVISOR consultation: it answers in
      // place and never switches into the build/research workspace.
      const onSplash = ws === "chat" && !startedRef.current
      setMsgs((prev) => {
        const next = [...prev, { id: msgIdRef.current++, role: "user" as const, text, ts: Date.now() }]
        const s = sessionListRef.current.find((x) => x.id === activeSessionRef.current)
        if (s && s.title === "new session") {
          s.title = text.length > 24 ? `${text.slice(0, 24)}.` : text
          setSessionList([...sessionListRef.current])
        }
        return next
      })
      if (onSplash) {
        const tpls = listProjects()
        const extra = [
          `Active research project: ${project ? `${project.name} - ${project.description || "no description"}` : "none selected yet (Shift+P opens one, Shift+N creates one)"}`,
          project ? `Pipeline stages: ${project.stages.map((s) => `${s.key}:${s.status}`).join(" ")} · runs: ${project.totalRuns} (${project.running} running)` : "",
          `Templates available: ${tpls.join(", ")}`,
          `Menu: P project · N new · C continue · R run pipeline · D dashboard. Full coding chat is opened with the 2 key.`,
        ]
          .filter(Boolean)
          .join("\n")
        startRun(text, { agentId: "advisor", extraSystem: extra })
      } else {
        startRun(text)
      }
    },
    [atIdx, atMenu, busy, dlg, handleCommand, leader, menuIdx, planDlg, project, pushStatic, runShellLine, startRun, ws],
  )

  const historyStep = useCallback((dir: 1 | -1) => {
    const hist = historyRef.current
    if (hist.length === 0) return
    if (dir === 1 && histPosRef.current === -1) draftRef.current = inputRef.current?.value ?? ""
    const pos = Math.max(-1, Math.min(hist.length - 1, histPosRef.current + dir))
    histPosRef.current = pos
    const v = pos === -1 ? draftRef.current : hist[hist.length - 1 - pos]
    inputRef.current?.setText(v)
    setValue(v)
  }, [])

  const dlgEntries = useCallback(
    (kind: DlgKind): DlgEntry[] => {
      if (kind === "palette")
        return COMMANDS.map((c) => ({ name: c.title, category: c.category, hint: c.key, run: () => runCommand(c.id) }))
      if (kind === "model")
        return ALL_MODELS.map((m, i) => ({
          name: m.id,
          desc: `${m.provider} · ctx ${m.ctx}`,
          category: m.provider,
          prefix: i === modelIndex ? "●" : undefined,
          run: () => {
            setModelIndex(i)
            setVariantIndex(-1)
            patchSettings({ model: m.id })
            showToast(`model: ${m.id} (${m.provider})`, "ok")
          },
        }))
      if (kind === "theme")
        return THEME_NAMES.map((t, i) => ({
          name: t,
          category: "Theme",
          hint: i === THEME_NAMES.indexOf(themeName) ? "active" : undefined,
          run: () => changeTheme(t),
        }))
      if (kind === "effect")
        return EFFECT_NAMES.map((e) => ({
          name: e,
          desc: "full-screen post effect",
          category: "Visuals",
          hint: e === getActiveEffect() ? "active" : undefined,
          run: () => applyEffect(e),
        }))
      if (kind === "agents")
        return AGENTS.map((a, i) => ({
          name: a.label,
          desc: a.desc,
          category: "Agent",
          hint: i === agentIndex ? "active" : a.id === "plan" ? "tab" : undefined,
          run: () => {
            setAgentIndex(i)
            showToast(`agent: ${a.label}`, "info")
          },
        }))
      if (kind === "sessions")
        return sessionList.map((s) => ({
          name: s.title,
          desc: s.id === activeSessionRef.current ? undefined : new Date(s.createdAt).toLocaleString(),
          category: "Session",
          prefix: s.id === activeSessionRef.current ? "●" : undefined,
          hint: s.id === activeSessionRef.current ? "current" : undefined,
          run: () => switchSession(s.id),
        }))
      if (kind === "aisjobs")
        return store.jobs
          .slice(-12)
          .reverse()
          .map((j) => ({
            name: `#${j.id} ${j.template || "—"}${j.idea ? ` · ${j.idea}` : ""}`,
            desc: j.run_id,
            hint: j.status,
            category: "Experiments",
            prefix: j.status === "running" ? "▶" : j.status === "done" ? "✓" : "·",
            nameColor: j.status === "running" ? C.warn : undefined,
            run: () => {
              setWs("dash")
              setStarted(true)
              startedRef.current = true
              const idx = aisPanelsRef.current.findIndex((p) => p.id === j.id)
              focusRef.current.dash = Math.max(0, idx)
              setDashFocus(Math.max(0, idx))
            },
          }))
      if (kind === "projects")
        return projectsList.map((t) => {
          const runs = store.jobs.filter((j) => j.template === t)
          const running = runs.some((j) => j.status === "running")
          return {
            name: t,
            desc: projectDescription(t) || undefined,
            category: "Projects",
            prefix: t === projectName ? "●" : undefined,
            hint: running ? "running" : runs.length ? `${runs.length} runs` : undefined,
            run: () => selectProject(t),
          }
        })
      if (kind === "improve")
        return IMPROVE_PRESETS.map((p) => ({
          name: p.label,
          desc: p.desc,
          category: "Auto-improve",
          prefix: settings.improve === p.val ? "●" : undefined,
          hint: settings.improve === p.val ? "active" : undefined,
          run: () => {
            patchSettings({ improve: p.val })
            showToast(`auto-improve: ${improveLabel(p.val)}`, "ok")
          },
        }))
      if (kind === "skeleton")
        return projectsList
          .filter((t) => !existsSync(join(PROJECT_ROOT, "templates", t, "experiment.py")))
          .map((t) => ({
            name: t,
            desc: projectDescription(t) || "no task description yet",
            category: "Needs skeleton",
            hint: "generate",
            run: () => void doSkeleton(t, skeletonDescFor(PROJECT_ROOT, t) || projectDescription(t)),
          }))
      if (kind === "notecolor")
        return LABELS.map((l) => ({
          name: l.name,
          desc: "set this note's color",
          category: "Color",
          prefix: "●",
          nameColor: l.hex,
          run: () => {
            const cur = noteRowsRef.current[Math.min(focusRef.current.notes, Math.max(0, noteRowsRef.current.length - 1))]
            if (!cur) return
            try {
              setLabels(cur.path, [l.name])
              reloadNotes(cur.path)
              showToast(`color: ${l.name}`, "ok")
            } catch (e) {
              showToast(`color failed: ${String((e as Error).message ?? e)}`, "err")
            }
          },
        }))
      if (kind === "routers")
        return ROUTERS.map((r) => ({
          name: r.label,
          desc: `${r.id === "openrouter" ? "one key, every model" : r.kind === "anthropic" ? "native Messages API" : r.kind === "openai" ? "OpenAI-compatible" : "local"} · ${r.keyEnvs[0] ?? r.chatUrl.replace(/^https?:\/\//, "").split("/")[0]}`,
          category: "Router",
          prefix: r.id === activeRouterId() ? "●" : undefined,
          hint: !r.needsKey && r.id !== "custom" ? "no key" : r.keyEnvs.some((e) => hasEnv(e)) ? "key set" : "no key",
          nameColor: r.id === activeRouterId() ? C.primary : undefined,
          run: () => selectRouter(r.id),
        }))
      return [...new Set(historyRef.current)].reverse().map((h) => ({
        name: h,
        category: "History",
        run: () => {
          inputRef.current?.setText(h)
          setValue(h)
        },
      }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentIndex, applyEffect, changeTheme, doSkeleton, modelIndex, projectName, projectsList, selectProject, selectRouter, sessionList, showToast, store, switchSession, themeName],
  )

  const dlgFiltered: FuzzyItem<DlgEntry>[] = useMemo(() => {
    if (!dlg) return []
    return fuzzyFilter(dlg.query, dlgEntries(dlg.kind), (e) => e.name + (e.desc ? ` ${e.desc}` : ""))
  }, [dlg, dlgEntries])

  const dlgRows: FuzzyRow[] = useMemo(
    () =>
      dlgFiltered.map((f) => ({
        id: f.item.name,
        name: f.item.name,
        desc: f.item.desc,
        hint: f.item.hint,
        category: f.item.category,
        prefix: f.item.prefix,
        nameColor: f.item.nameColor,
        indices: f.indices,
      })),
    [dlgFiltered],
  )

  const dlgPick = useCallback(() => {
    const cur = dlgRef.current
    if (!cur) return
    const entries = dlgEntries(cur.kind)
    const filtered = fuzzyFilter(cur.query, entries, (e) => e.name + (e.desc ? ` ${e.desc}` : ""))
    const e = filtered[Math.min(cur.index, filtered.length - 1)]?.item
    dlgRef.current = null
    setDlg(null)
    if (!e) return
    e.run()
  }, [dlgEntries])

  const runCommand = useCallback(
    (id: string) => {
      switch (id) {
        case "new":
          newSession()
          break
        case "sessions":
          openDialog("sessions")
          break
        case "compact":
          doCompact()
          break
        case "undo":
          undoLast()
          break
        case "redo":
          redoLast()
          break
        case "copy":
          copyLast()
          break
        case "export":
          exportSession()
          break
        case "timeline":
          handleCommand("/timeline")
          break
        case "agents":
          openDialog("agents", agentIndex)
          break
        case "cycle-agent":
          cycleAgent()
          break
        case "models":
          openDialog("model", modelIndex)
          break
        case "themes":
          openDialog("theme", Math.max(0, THEME_NAMES.indexOf(themeName)))
          break
        case "variants":
          cycleVariant()
          break
        case "history":
          openDialog("history")
          break
        case "verbose":
          toggleVerbose()
          break
        case "sidebar":
          setSidebarOpen((v) => !v)
          break
        case "dashboard":
          setWs("dash")
          setStarted(true)
          startedRef.current = true
          break
        case "chat":
          setWs("chat")
          break
        case "explorer":
          setWs("expl")
          setStarted(true)
          startedRef.current = true
          break
        case "notes":
          setWs("notes")
          setStarted(true)
          startedRef.current = true
          break
        case "projects":
          openDialog("projects", 0)
          break
        case "newproject":
          startWizard()
          break
        case "routers":
          openDialog("routers", 0)
          break
        case "improve":
          openDialog("improve", 0)
          break
        case "skeleton":
          openDialog("skeleton", 0)
          break
        case "agentboard":
          setWs("agents")
          setStarted(true)
          startedRef.current = true
          break
        case "delegate":
          setWs("agents")
          setStarted(true)
          startedRef.current = true
          setAgentPromptBoth("")
          break
        case "jobs":
          openDialog("aisjobs")
          break
        case "article":
          setWs("article")
          setStarted(true)
          startedRef.current = true
          break
        case "run":
          handleCommand("/run")
          break
        case "tips":
          setTipsOpen((v) => !v)
          showToast(`tips: ${!tipsOpen ? "on" : "off"}`, "info")
          break
        case "details":
          toggleVerbose()
          break
        case "effect":
          openDialog("effect")
          break
        case "animations":
          toggleAnimations()
          break
        case "editor":
          handleCommand("/editor")
          break
        case "status":
          handleCommand("/status")
          break
        case "help":
          handleCommand("/help")
          break
        case "quit":
          quit()
          break
      }
    },
    [
      agentIndex,
      copyLast,
      cycleAgent,
      cycleVariant,
      doCompact,
      exportSession,
      handleCommand,
      newSession,
      openDialog,
      quit,
      redoLast,
      showToast,
      themeName,
      tipsOpen,
      toggleAnimations,
      toggleVerbose,
      undoLast,
    ],
  )

  useKeyboard((k) => {
    if (k.eventType === "release") return
    if (handoffRef.current) {
      k.preventDefault()
      return
    }

    const wiz = npRef.current
    if (wiz) {
      if (wiz.step === "skeleton") {
        if (k.name === "y") setNpBoth({ ...wiz, skeleton: true, step: "confirm", error: undefined })
        else if (k.name === "n") setNpBoth({ ...wiz, skeleton: false, step: "confirm", error: undefined })
        else if (k.name === "return" || k.name === "enter" || k.name === "KPEnter") npEnter()
        else if (k.name === "escape" || k.name === "backspace") npEscape()
      } else if (wiz.step === "confirm") {
        if (k.name === "y" || k.name === "return" || k.name === "enter" || k.name === "KPEnter") npEnter()
        else if (k.name === "n" || k.name === "escape") npEscape()
      } else if (k.name === "escape") npEscape()
      else if (k.name === "return" || k.name === "enter" || k.name === "KPEnter") npEnter()
      else if (k.name === "backspace") npBackspace()
      else if (!k.ctrl && !k.meta && k.sequence && k.sequence.length === 1 && !/[\x00-\x1f]/.test(k.sequence)) npAppend(k.sequence)
      k.preventDefault()
      return
    }

    if (runAskRef.current) {
      if (k.name === "y" || k.name === "return" || k.name === "enter" || k.name === "KPEnter") {
        setRunAskBoth(false)
        setStarted(true)
        startedRef.current = true
        handleCommandRef.current(`/run ${projectName}`)
      } else if (k.name === "n" || k.name === "escape") setRunAskBoth(false)
      k.preventDefault()
      return
    }

    if (planDlg) {
      if (k.name === "y") approvePlan(true)
      else if (k.name === "n" || k.name === "escape") approvePlan(false)
      k.preventDefault()
      return
    }

    if (leaderRef.current && !k.ctrl && !k.meta) {
      if (leaderTimerRef.current) clearTimeout(leaderTimerRef.current)
      const entry = LEADER_KEYS.find((l) => l.key === k.name)
      leaderRef.current = false
      setLeader(false)
      if (entry) runCommand(entry.cmd)
      else showToast(`unknown leader key: ${k.name}`, "warn")
      k.preventDefault()
      return
    }

    if (dlg) {
    if (k.name === "escape") {
        dlgRef.current = null
        setDlg(null)
        return
      }
      if (k.name === "up" || (k.ctrl && k.name === "p")) {
        mutateDlg((d) => ({ ...d, index: Math.max(0, d.index - 1) }))
        k.preventDefault()
        return
      }
      if (k.name === "down" || (k.ctrl && k.name === "n")) {
        mutateDlg((d) => ({ ...d, index: Math.min(dlgFiltered.length - 1, d.index + 1) }))
        k.preventDefault()
        return
      }
      if (k.name === "return" || k.name === "enter" || k.name === "KPEnter") {
        dlgPick()
        k.preventDefault()
        return
      }
      if (k.name === "backspace") {
        mutateDlg((d) => (d.query ? { ...d, query: d.query.slice(0, -1), index: 0 } : { ...d, query: "", index: 0 }))
        k.preventDefault()
        return
      }
      if (!k.ctrl && !k.meta && k.sequence && k.sequence.length === 1 && !/[\x00-\x1f]/.test(k.sequence)) {
        const ch = k.sequence
        mutateDlg((d) => ({ ...d, query: d.query + ch, index: 0 }))
        k.preventDefault()
        return
      }
      k.preventDefault()
      return
    }
    if (!startedRef.current && ws === "chat" && !dlg && !npRef.current && !runAskRef.current && (inputRef.current?.value ?? "") === "" && !k.ctrl && !k.meta && k.shift) {
      if (k.name === "p") {
        openDialog("projects", 0)
        k.preventDefault()
        return
      }
      if (k.name === "n") {
        startWizard()
        k.preventDefault()
        return
      }
      if (k.name === "c") {
        continueProject()
        k.preventDefault()
        return
      }
      if (k.name === "r") {
        runCurrentProject()
        k.preventDefault()
        return
      }
      if (k.name === "d") {
        setWs("dash")
        setStarted(true)
        startedRef.current = true
        k.preventDefault()
        return
      }
      if (k.name === "i") {
        handleCommandRef.current("/init")
        k.preventDefault()
        return
      }
      if (k.name === "a") {
        openDialog("improve", 0)
        k.preventDefault()
        return
      }
      if (k.name === "m") {
        openDialog("skeleton", 0)
        k.preventDefault()
        return
      }
    }

    if (!k.ctrl && !k.meta && /^[123456]$/.test(k.name ?? "") && (ws !== "chat" || value === "")) {
      const target = (["dash", "chat", "expl", "notes", "agents", "article"] as const)[Number(k.name) - 1]
      if (target !== "agents") closeAgentPrompt()
      setWs(target)
      if (target !== "chat") {
        setStarted(true)
        startedRef.current = true
      } else if (!startedRef.current && msgs.length > 1) {
        setStarted(true)
        startedRef.current = true
      }
      k.preventDefault()
      return
    }

    if (ws === "article" && !k.ctrl && !k.meta) {
      const sb = articleScrollRef.current
      const vh = Math.max(5, size.h - 10)
      const max = Math.max(0, (sb?.scrollHeight ?? 0) - vh)
      const to = (v: number) => {
        if (sb) sb.scrollTop = Math.max(0, Math.min(max, v))
      }
      if (k.name === "escape" || k.name === "a") setWs("dash")
      else if (k.name === "up" || k.name === "k") to((sb?.scrollTop ?? 0) - 1)
      else if (k.name === "down" || k.name === "j") to((sb?.scrollTop ?? 0) + 1)
      else if (k.name === "pagedown" || k.name === "space") to((sb?.scrollTop ?? 0) + vh)
      else if (k.name === "pageup") to((sb?.scrollTop ?? 0) - vh)
      else if (k.name === "home") to(0)
      else if (k.name === "end") to(max)
      else if (k.name === "g" && !k.shift) to(0)
      else if (k.name === "g" && k.shift) to(max)
      k.preventDefault()
      return
    }

    if (ws === "dash" && !dlg && !busy && !k.ctrl && !k.meta && k.name !== "tab") {
      const panels = aisPanelsRef.current
      const cols = size.w >= 110 ? 2 : 1
      const cur = panels[focusRef.current.dash]
      if (k.name === "up") bumpDash(focusRef.current.dash - cols)
      else if (k.name === "down") bumpDash(focusRef.current.dash + cols)
      else if (k.name === "left") bumpDash(focusRef.current.dash - 1)
      else if (k.name === "right") bumpDash(focusRef.current.dash + 1)
      else if (k.name === "return" && cur) void openFile(eventsPath(cur.id))
      else if (k.name === "a") {
        setWs("article")
        setStarted(true)
        startedRef.current = true
      }
      else if (k.name === "d" && cur) {
        if (dashDelArmedRef.current === cur.id) {
          dashDelArmedRef.current = null
          setDashDelArmed(null)
          if (dashDelTimerRef.current) clearTimeout(dashDelTimerRef.current)
          removeJobRecord(cur.id)
        } else {
          dashDelArmedRef.current = cur.id
          setDashDelArmed(cur.id)
          if (dashDelTimerRef.current) clearTimeout(dashDelTimerRef.current)
          dashDelTimerRef.current = setTimeout(() => {
            dashDelArmedRef.current = null
            setDashDelArmed(null)
          }, 2500)
        }
      }
      else if (k.name === "x" && cur) stopJob(cur.id)
      else if (k.name === "r" && cur) {
        const j = store.jobs.find((x) => x.id === cur.id)
        if (j) void doRun(j.template, j.model || undefined)
      }
      if (["up", "down", "left", "right", "return", "a", "d", "x", "r"].includes(k.name)) k.preventDefault()
      return
    }

    if (ws === "expl" && !dlg && !k.ctrl && !k.meta && k.name !== "tab") {
      if (exDiff) {
        if (k.name === "escape" || k.name === "d" || k.name === "q") setExDiff(null)
        k.preventDefault()
        return
      }
      if (exFilter.active) {
        if (k.name === "escape") setExFilter({ active: false, query: "", idx: 0 })
        else if (k.name === "up") setExFilter((f) => ({ ...f, idx: Math.max(0, f.idx - 1) }))
        else if (k.name === "down") setExFilter((f) => ({ ...f, idx: Math.min(Math.max(0, exHits.length - 1), f.idx + 1) }))
        else if (k.name === "backspace") setExFilter((f) => ({ ...f, query: f.query.slice(0, -1), idx: 0 }))
        else if (k.name === "return") {
          const hit = exHits[exFilter.idx]
          if (hit) void openFile(join(PROJECT_ROOT, hit))
        } else if (!k.ctrl && !k.meta && k.sequence && k.sequence.length === 1 && !/[\x00-\x1f]/.test(k.sequence)) {
          const ch = k.sequence
          setExFilter((f) => ({ active: true, query: f.query + ch, idx: 0 }))
        }
        k.preventDefault()
        return
      }
      const rows = exRowsRef.current
      const clamp = (i: number) => Math.max(0, Math.min(rows.length - 1, i))
      const cur = rows[clamp(focusRef.current.ex)]
      if (k.name === "up") bumpEx(clamp(focusRef.current.ex - 1))
      else if (k.name === "down") bumpEx(clamp(focusRef.current.ex + 1))
      else if (k.name === "pgup") bumpEx(clamp(focusRef.current.ex - 10))
      else if (k.name === "pgdown") bumpEx(clamp(focusRef.current.ex + 10))
      else if (k.name === "right" && cur?.dir) {
        if (cur.expanded) {
          const idx = rows.indexOf(cur)
          bumpEx(clamp(idx + 1))
        } else {
          if (!cur.loaded) loadChildren(cur)
          cur.expanded = true
          setRootSeq((s) => s + 1)
        }
      } else if (k.name === "left" && cur) {
        if (cur.dir && cur.expanded) {
          cur.expanded = false
          setRootSeq((s) => s + 1)
        } else {
          const parent = cur.path.slice(0, Math.max(cur.path.lastIndexOf("\\"), cur.path.lastIndexOf("/")))
          const pi = rows.findIndex((r) => r.path === (parent || PROJECT_ROOT))
          bumpEx(Math.max(0, pi))
        }
      } else if (k.name === "return" && cur) {
        if (cur.dir) {
          if (!cur.loaded) loadChildren(cur)
          cur.expanded = !cur.expanded
          setRootSeq((s) => s + 1)
        } else void openFile(cur.path)
      } else if (k.sequence === "/") {
        setExFilter({ active: true, query: "", idx: 0 })
      } else if (k.name === "d" && cur && !cur.dir) {
        // diff a run snapshot against its predecessor (run_2.py vs run_1.py)
        const mm = cur.path.match(/^(.*run_)(\d+)(\.py)$/i)
        if (!mm || Number(mm[2]) < 1) {
          showToast("no diff: only run_<N>.py snapshots (N ≥ 1) can be diffed", "warn")
        } else {
          const prevPath = `${mm[1]}${Number(mm[2]) - 1}${mm[3]}`
          try {
            const a = readFileSync(prevPath, "utf8").split("\n")
            const b = readFileSync(cur.path, "utf8").split("\n")
            const d = contextualDiff(diffLines(a, b), 2)
            const short = (p: string) => p.split(/[\\/]/).pop() ?? p
            setExDiff({ title: `${short(prevPath)} → ${short(cur.path)}`, lines: d })
          } catch (e) {
            showToast(`diff failed: ${String((e as Error).message ?? e)}`, "err")
          }
        }
      }
      if (!k.ctrl && !k.meta) k.preventDefault()
      return
    }

    if (ws === "notes" && !dlg && !k.ctrl && !k.meta && k.name !== "tab") {
      if (ideaView === "ideas") {
        const rowsI = ideaRowsRef.current
        const clampI = (i: number) => Math.max(0, Math.min(rowsI.length - 1, i))
        if (ideaFilter.active) {
          if (k.name === "escape") setIdeaFilter({ active: false, query: "" })
          else if (k.name === "up") bumpIdeas(clampI(focusRef.current.ideas - 1))
          else if (k.name === "down") bumpIdeas(clampI(focusRef.current.ideas + 1))
          else if (k.name === "backspace") setIdeaFilter((f) => ({ ...f, query: f.query.slice(0, -1) }))
          else if (k.sequence && k.sequence.length === 1 && !/[\x00-\x1f]/.test(k.sequence)) {
            const ch = k.sequence
            setIdeaFilter((f) => ({ active: true, query: f.query + ch }))
          }
          k.preventDefault()
          return
        }
        if (k.name === "up") bumpIdeas(clampI(focusRef.current.ideas - 1))
        else if (k.name === "down") bumpIdeas(clampI(focusRef.current.ideas + 1))
        else if (k.name === "pgup") bumpIdeas(clampI(focusRef.current.ideas - 12))
        else if (k.name === "pgdown") bumpIdeas(clampI(focusRef.current.ideas + 12))
        else if (k.name === "home") bumpIdeas(0)
        else if (k.name === "end") bumpIdeas(clampI(rowsI.length - 1))
        else if (k.sequence === "/") setIdeaFilter({ active: true, query: "" })
        else if (k.name === "t") {
          setIdeaView("notes")
          reloadNotes()
        }
        else if (k.name === "e" && projectName) void openFile(join(PROJECT_ROOT, "templates", projectName, "ideas.json"))
        if (!k.ctrl && !k.meta) k.preventDefault()
        return
      }
      const prompt = notePromptRef.current
      if (prompt) {
        if (k.name === "escape") setNotePromptBoth(null)
        else if (k.name === "return" || k.name === "enter" || k.name === "KPEnter") {
          if (prompt.mode === "create") {
            const text = prompt.text.trim()
            try {
              const n = createNote(text || "untitled")
              setNotePromptBoth(null)
              reloadNotes(n.path)
              showToast(`created «${n.title}»`, "ok")
            } catch (e) {
              showToast(`create failed: ${String((e as Error).message ?? e)}`, "err")
              setNotePromptBoth(null)
            }
          } else setNotePromptBoth(null)
        } else if (k.name === "backspace") setNotePromptBoth((p) => (p ? { ...p, text: p.text.slice(0, -1) } : p))
        else if (!k.ctrl && !k.meta && k.sequence && k.sequence.length === 1 && !/[\x00-\x1f]/.test(k.sequence)) {
          const ch = k.sequence
          setNotePromptBoth((p) => (p ? { ...p, text: p.text + ch } : p))
        }
        k.preventDefault()
        return
      }
      const rowsN = noteRowsRef.current
      const cur = rowsN[Math.min(focusRef.current.notes, Math.max(0, rowsN.length - 1))]
      const clampN = (i: number) => Math.max(0, Math.min(rowsN.length - 1, i))
      if (delArmedRef.current && k.name !== "x") setDelArmedBoth(null)
      if (k.name === "t") setIdeaView("ideas")
      else if (k.name === "n") setNotePromptBoth({ mode: "create", text: "" })
      else if (k.sequence === "/" && !k.ctrl) setNotePromptBoth({ mode: "filter", text: "" })
      else if (k.name === "up") bumpNotes(clampN(focusRef.current.notes - 1))
      else if (k.name === "down") bumpNotes(clampN(focusRef.current.notes + 1))
      else if (k.name === "k") {
        const sb = notePreviewRef.current
        if (sb) sb.scrollTop = Math.max(0, sb.scrollTop - 3)
      } else if (k.name === "j") {
        const sb = notePreviewRef.current
        if (sb) sb.scrollTop = sb.scrollTop + 3
      } else if (k.name === "return" && cur) {
        void openFile(cur.path).then(() => {
          reloadNotes()
          setNotePreviewTick((t) => t + 1)
        })
      }
      else if (k.name === "l" && cur) {
        try {
          if (k.shift) {
            setLabels(cur.path, [])
            reloadNotes(cur.path)
            showToast("color cleared", "info")
          } else {
            openDialog("notecolor")
          }
        } catch (e) {
          showToast(`label failed: ${String((e as Error).message ?? e)}`, "err")
        }
      } else if (k.name === "x" && cur) {
        if (delArmedRef.current === cur.path) {
          try {
            deleteNote(cur.path)
            showToast(`deleted «${cur.title}»`, "warn")
            setDelArmedBoth(null)
            reloadNotes()
          } catch (e) {
            showToast(`delete failed: ${String((e as Error).message ?? e)}`, "err")
          }
        } else {
          setDelArmedBoth(cur.path)
          if (delTimerRef.current) clearTimeout(delTimerRef.current)
          delTimerRef.current = setTimeout(() => setDelArmedBoth(null), 2000)
        }
      } else if (k.name === "r") reloadNotes()
      if (k.name === "escape") return
      if (!k.ctrl && !k.meta) k.preventDefault()
      return
    }

    if (ws === "agents" && !dlg && !k.ctrl && !k.meta && k.name !== "tab") {
      const workers = orchStateRef.current?.workers ?? []
      const clampA = (i: number) => Math.max(0, Math.min(workers.length - 1, i))
      if (agentPromptRef.current !== null) {
        if (k.name === "escape") closeAgentPrompt()
        else if (k.name === "return" || k.name === "enter" || k.name === "KPEnter") {
          const task = (agentPromptRef.current ?? "").trim()
          const mode = agentPromptMode
          const target = clarifyTargetRef.current
          if (target !== null && mode === "clarify") {
            if (task) steerWorker(target, task)
          } else if (target !== null && mode === "ask") {
            if (task) {
              const w = orchStateRef.current?.workers.find((x) => x.id === target)
              if (w?.status === "running") {
                steerWorker(target, task)
              } else {
                const ctx = w?.result ? `Previous result:\n${w.result.slice(0, 800)}\n\n` : ""
                delegateTask(`Follow-up on task «${w?.task ?? target}».\n${ctx}Operator question: ${task}`)
                showToast(`follow-up dispatched (worker #${target + 0} context attached)`, "ok")
              }
            }
          } else if (task) {
            delegateTask(task)
            showToast("main agent dispatched a real worker", "ok")
          }
          closeAgentPrompt()
        } else if (k.name === "backspace") {
          const v = agentPromptRef.current ?? ""
          setAgentPromptBoth(v.slice(0, -1))
        } else if (!k.ctrl && !k.meta && k.sequence && k.sequence.length === 1 && !/[\x00-\x1f]/.test(k.sequence)) {
          setAgentPromptBoth((agentPromptRef.current ?? "") + k.sequence)
        }
        k.preventDefault()
        return
      }
      if (logOpen !== null) {
        if (k.name === "escape" || k.name === "return") setLogOpen(null)
        k.preventDefault()
        return
      }
      const cur = workers[Math.min(focusRef.current.agents, Math.max(0, workers.length - 1))]
      if (k.name === "up") bumpAgents(clampA(focusRef.current.agents - 1))
      else if (k.name === "down") bumpAgents(clampA(focusRef.current.agents + 1))
      else if (k.name === "pgup") bumpAgents(clampA(focusRef.current.agents - 8))
      else if (k.name === "pgdown") bumpAgents(clampA(focusRef.current.agents + 8))
      else if (k.name === "home") bumpAgents(0)
      else if (k.name === "end") bumpAgents(workers.length - 1)
      else if ((k.name === "return" || k.name === "enter" || k.name === "KPEnter") && cur) setLogOpen(cur.id)
      else if (k.name === "d") {
        setAgentPromptMode("delegate")
        setAgentPromptBoth("")
      }
      else if (k.name === "s" && cur && cur.kind === "delegate" && cur.status === "running") openClarify(cur.id)
      else if (k.name === "a" && cur && cur.kind === "delegate") openClarify(cur.id, "ask")
      else if (k.name === "x" && cur) {
        if (cur.status === "done" || cur.status === "failed" || cur.status === "killed") {
          showToast(`worker #${cur.id} already ${cur.status}`, "info")
        } else {
          taskCtlRef.current.get(cur.id)?.abort()
          orchRef.current?.kill(cur.id)
          if (cur.kind === "job" && cur.jobId !== null) stopJob(cur.jobId)
          showToast(`killed worker #${cur.id}${cur.kind === "job" ? ` + job #${cur.jobId}` : ""}`, "warn")
        }
      } else if (k.name === "r") {
        store.refresh()
        showToast("resynced with pipeline", "info")
      }
      if (k.name === "escape") return
      if (!k.ctrl && !k.meta) k.preventDefault()
      return
    }


    if (k.ctrl && k.name === "x") {
      leaderRef.current = true
      setLeader(true)
      if (leaderTimerRef.current) clearTimeout(leaderTimerRef.current)
      leaderTimerRef.current = setTimeout(() => {
        leaderRef.current = false
        setLeader(false)
      }, 2000)
      return
    }

    if (k.ctrl && k.name === "p") {
      openDialog("palette")
      return
    }

    if (k.ctrl && k.name === "r") {
      openDialog("history")
      return
    }

    if (k.ctrl && k.name === "t") {
      cycleVariant()
      return
    }

    if (k.name === "tab" && !k.shift) {
      const order = ["chat", "dash", "expl", "notes", "agents", "article"] as const
      const next = order[(order.indexOf(ws) + 1) % order.length]
      if (next !== "agents") closeAgentPrompt()
      setWs(next)
      if (next !== "chat") {
        setStarted(true)
        startedRef.current = true
      }
      return
    }
    if (k.name === "tab" && k.shift) {
      cycleAgent()
      return
    }

    if (k.ctrl && k.name === "b") {
      if (fgRef.current && !bgRef.current) {
        bgRef.current = fgRef.current
        bgRef.current.awaiting = false
        fgRef.current = null
        setBusy(false)
        setBgRun({ thought: bgRef.current.thought, start: bgRef.current.start })
      } else if (bgRef.current && !fgRef.current) {
        fgRef.current = bgRef.current
        bgRef.current = null
        setBusy(true)
        setBgRun(null)
      } else if (fgRef.current && bgRef.current) {
        const t = bgRef.current
        bgRef.current = fgRef.current
        bgRef.current.awaiting = false
        fgRef.current = t
        setBgRun({ thought: bgRef.current.thought, start: bgRef.current.start })
      }
      return
    }

    if (k.name === "escape") {
      if (leaderRef.current) {
        leaderRef.current = false
        setLeader(false)
        return
      }
      if (atMenu.open) {
        const v = value.replace(/(^|\s)@([^\s]*)$/, "$1")
        inputRef.current?.setText(v)
        setValue(v)
        return
      }
      if (menuOpen) {
        setValue("")
        inputRef.current?.setText("")
        return
      }
      if (busy && fgRef.current) {
        // instant interrupt: the partial answer stays in the chat, the user
        // types a clarification and the conversation continues.
        finishSlot("fg", true, "interrupted — ждём уточнения оператора")
        return
      }
      const t = Date.now()
      if (t - lastEscRef.current < 1500) {
        quit()
        return
      }
      lastEscRef.current = t
      setQuitHint(true)
      setTimeout(() => setQuitHint(false), 1500)
      return
    }

    if (!busy && !dlg) {
      if (k.name === "up") {
        if (atMenu.open) {
          atIdxRef.current = Math.max(0, atIdxRef.current - 1)
          setAtIdx(atIdxRef.current)
        } else if (menuOpen) {
          menuIdxRef.current = (menuIdxRef.current + menu.length - 1) % menu.length
          setMenuIdx(menuIdxRef.current)
        } else historyStep(1)
      } else if (k.name === "down") {
        if (atMenu.open) {
          atIdxRef.current = Math.min(atMenu.items.length - 1, atIdxRef.current + 1)
          setAtIdx(atIdxRef.current)
        } else if (menuOpen) {
          menuIdxRef.current = (menuIdxRef.current + 1) % menu.length
          setMenuIdx(menuIdxRef.current)
        } else historyStep(-1)
      }
    }
  })

  const costShown = realUsage.seen ? realCost() : sessionCostRef.current
  const usage =
    ctxK > 0 || costShown > 0
      ? `${fmtNum(ctxK)} (${ctxPct}%)${costShown > 0 ? ` · $${costShown.toFixed(2)}` : ""}${realUsage.seen ? ` · ${fmtNum(realUsage.in + realUsage.out)} tok` : ""}`
      : ""

  const variant = variantIndex >= 0 ? ALL_MODELS[modelIndex].variants.filter((v) => v !== "none")[variantIndex] ?? null : null
  const shellMode = value.startsWith("!")

  const consult = useMemo(() => {
    const uIdx = msgs.map((m) => m.role).lastIndexOf("user")
    if (uIdx < 0) return null
    const lastU = msgs[uIdx] as Extract<Msg, { role: "user" }>
    let lastA: Extract<Msg, { role: "assistant" }> | null = null
    for (let i = msgs.length - 1; i > uIdx; i--) {
      const m = msgs[i]
      if (m.role === "assistant") {
        lastA = m
        break
      }
    }
    if (!lastA) return null
    const text = lastA.segments
      .filter((s) => s.kind === "text")
      .map((s) => (s.kind === "text" ? s.text : ""))
      .join("")
    return { q: lastU.text, a: text, running: lastA.streaming }
  }, [msgs])

  const homeProps = {
    inputRef,
    model: ALL_MODELS[modelIndex] ?? MODELS[0],
    agentLabel: AGENTS.find((a) => a.id === "advisor")?.label ?? "Advisor",
    agentColor: C.info,
    effectName,
    menu,
    menuActive: Math.min(menuIdx, Math.max(0, menu.length - 1)),
    atItems: atMenu.open ? atMenu.items.map((f) => ({ name: `@${f.item.path}`, desc: "file" })) : [],
    atActive: Math.min(atIdx, Math.max(0, atMenu.items.length - 1)),
    cwd,
    branch,
    tipsEnabled: tipsOpen,
    project,
    projectsCount: projectsList.length,
    onPickProject: () => openDialog("projects", 0),
    onContinue: continueProject,
    onNewProject: startWizard,
    onRunProject: runCurrentProject,
    consult,
    busy,
    thinking: fgRef.current?.thought ?? null,
    onGoDashboard: () => {
      setWs("dash")
      setStarted(true)
      startedRef.current = true
    },
    improveLabel: improveLabel(settings.improve),
    onPickImprove: () => openDialog("improve", 0),
    onPickSkeleton: () => openDialog("skeleton", 0),
    workers: orchState.workers,
    now,
    animations: anim,
    maxW: size.w < 82 ? size.w - 6 : 75,
    onSend: send,
    onValueChange: handleValueChange,
  }

  const dialogTitle: Record<DlgKind, string> = {
    palette: "Commands",
    model: "Select model",
    theme: "Select theme",
    effect: "Post effect",
    sessions: "Sessions",
    agents: "Select agent",
    history: "Prompt history",
    aisjobs: "Experiments",
    projects: "Select project",
    routers: "Select LLM router",
    notecolor: "Note color",
    improve: "Auto-improve papers",
    skeleton: "Generate AI skeleton",
  }

  if (size.w < 58 || size.h < 12) {
    return (
      <box width="100%" height="100%" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
        <box flexDirection="column" border borderStyle="rounded" borderColor={C.warn} paddingLeft={1} paddingRight={1} backgroundColor={C.panel}>
          <text>
            <b fg={C.warn}>{`terminal too small (${size.w}×${size.h})`}</b>
          </text>
          <text>
            <span fg={C.dim}>{"need at least 58×12 — resize the window"}</span>
          </text>
        </box>
      </box>
    )
  }

  const sidebarVisible = started && sidebarOpen && size.w > 120

  if (!started && ws === "chat") {
    return (
      <box width="100%" height="100%" position="relative">
        <HomeScreen {...homeProps} />
        {dlg && <FuzzyList title={dialogTitle[dlg.kind]} query={dlg.query} rows={dlgRows} index={dlg.index} maxVisible={Math.max(4, size.h - 14)} width={Math.min(88, size.w - 6)} />}
        {np && <NpWizard np={np} width={Math.min(80, size.w - 6)} />}
        {runAsk && (
          <Dialog title="run pipeline?" escHint="y · n" width={Math.min(68, size.w - 6)}>
            <text>
              <b fg={C.primary}>{`/run ${projectName}`}</b>
            </text>
            <text>
              <span fg={C.dim}>{"spawns a real AI-Scientist run — every stage shows up on the Dashboard"}</span>
            </text>
          </Dialog>
        )}
      {leader && <WhichKey cols={Math.max(2, Math.floor(size.w / 72))} />}
        {toast && <Toast text={toast.text} kind={toast.kind} />}
      </box>
    )
  }

  const aisCounts = { running: store.jobs.filter((j) => j.status === "running").length, total: store.jobs.length }

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={C.bg}>
      <TabStrip
        ws={ws}
        project={projectName}
        onPick={(w) => {
          setWs(w)
          if (w !== "chat") {
            setStarted(true)
            startedRef.current = true
          }
        }}
        running={aisCounts.running}
      />
      <box flexDirection="row" flexGrow={1}>
        {ws === "dash" && (
          <Dashboard
            panels={dashPanels}
            focus={Math.min(focusRef.current.dash, Math.max(0, dashPanels.length - 1))}
            cols={size.w >= 110 ? 2 : 1}
            panelW={size.w >= 110 ? Math.floor((size.w - 10) / 2) : Math.min(size.w - 6, 100)}
            tick={tick}
            animations={anim}
            counts={aisCounts}
            lastRun={[...store.jobs].reverse().find((j) => j.run_id)?.run_id ?? "—"}
            project={project}
            workers={orchState.workers}
            projectsCount={projectsList.length}
            onPickProject={() => openDialog("projects", 0)}
            onOpenArticle={() => {
              setWs("article")
              setStarted(true)
              startedRef.current = true
            }}
            availW={size.w}
            delArmed={dashDelArmed !== null}
            log={dashLog.events}
            logLabel={dashLog.label}
            sys={sys}
          />
        )}
        {ws === "expl" && (
          <Explorer
            root={PROJECT_ROOT}
            rows={exRows}
            cursor={Math.min(exCursor, Math.max(0, exRows.length - 1))}
            visibleHeight={Math.max(5, size.h - 8)}
            filterActive={exFilter.active}
            filterQuery={exFilter.query}
            filterHits={exHits}
            filterIdx={Math.min(exFilter.idx, Math.max(0, exHits.length - 1))}
            availW={size.w}
          />
        )}
        {ws === "notes" && ideaView === "ideas" && (
          <IdeasBrowser
            ideas={ideaRows}
            total={allIdeas.length}
            project={projectName}
            cursor={Math.min(ideaCursor, Math.max(0, ideaRows.length - 1))}
            visibleHeight={Math.max(6, size.h - 9)}
            filterActive={ideaFilter.active}
            filterQuery={ideaFilter.query}
            availW={size.w}
            onSelect={(idx) => bumpIdeas(idx)}
          />
        )}
        {ws === "notes" && ideaView === "notes" && (
          <NotesBoard
            notes={noteRows}
            total={notesList.length}
            cursor={Math.min(noteFocus, Math.max(0, noteRows.length - 1))}
            visibleHeight={Math.max(7, size.h - 6)}
            availW={size.w}
            prompt={notePrompt}
            delArmed={delArmed ? notesList.find((n) => n.path === delArmed)?.title ?? null : null}
            error={notesErr}
            previewRef={notePreviewRef}
            previewTick={notePreviewTick}
            onSelect={(idx) => bumpNotes(idx)}
          />
        )}
        {ws === "agents" && (
          <AgentsWorkspace
            state={orchState}
            project={projectName}
            focus={Math.min(workerFocus, Math.max(0, orchState.workers.length - 1))}
            availW={size.w - 2}
            visibleHeight={Math.max(10, size.h - 4)}
            prompt={agentPrompt}
            promptMode={agentPromptMode}
            clarifyTarget={clarifyTarget}
            onSelect={(wk) => {
              const idx = orchState.workers.findIndex((x) => x.id === wk.id)
              if (idx >= 0) bumpAgents(idx)
              setLogOpen(wk.id)
            }}
          />
        )}
        {ws === "article" && (
          <ArticleReader
            title={articleDoc?.title ?? (projectName ? `no document for «${projectName}»` : "no project selected")}
            subtitle={articleDoc?.subtitle ?? "real files only: results/<project>/**/paper.md · templates/<project>/README.md"}
            md={
              articleDoc?.md ??
              `# No document yet

This tab reads **real files only** — nothing is hardcoded or faked:

- \`results/<project>/<run>/paper.md\` — the generated writeup, once a pipeline run reaches the writeup stage
- \`templates/<project>/README.md\` — written by the new-project wizard (Shift+N)

Pick a project with Shift+P, create one with Shift+N, or open the project README in $EDITOR with /editor.
`
            }
            scrollRef={articleScrollRef}
            availW={size.w}
            availH={size.h}
          />
        )}
        {ws === "chat" && (
        <box flexDirection="column" flexGrow={1}>
          <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} height={1}>
            <text>
              <span fg={C.dim}>{`${cwd}${branch ? `:${branch}` : ""}`}</span>
            </text>
            <text>
              <span fg={C.dim}>{`session ${activeSessionRef.current}`}</span>
            </text>
          </box>

          <ChatLog
            messages={msgs.length > chatWindow ? msgs.slice(msgs.length - chatWindow) : msgs}
            hiddenAbove={Math.max(0, msgs.length - chatWindow)}
            onLoadEarlier={() => setChatWindow((w) => w + 40)}
            tick={tick}
            now={now}
            animations={anim}
            verbose={verbose}
            agentColor={agentColor}
            scrollRef={scrollRef}
          />

          {bgRun && (
            <box paddingLeft={1} height={1}>
              <text>
                <span fg={C.info}>{"⚇ "}</span>
                <b fg={C.text}>{"background task"}</b>
                <span fg={C.dim}>{` · ctrl+b to bring back · ${((now - bgRun.start) / 1000).toFixed(0)}s`}</span>
              </text>
            </box>
          )}

          {planDlg && (
            <Dialog title="plan — approve?" escHint="y · n" width={Math.min(76, size.w - 6)}>
              {planDlg.lines.map((l, i) => (
                <text key={i}>
                  <span fg={C.faint}>{`  ${l}`}</span>
                </text>
              ))}
              <text>
                <b fg={C.ok}>{" y"}</b>
                <span fg={C.dim}>{" approve    "}</span>
                <b fg={C.err}>{" n"}</b>
                <span fg={C.dim}>{" reject"}</span>
              </text>
            </Dialog>
          )}

          {atMenu.open && (
            <box marginLeft={1} marginRight={1}>
              <SlashMenu
                items={atMenu.items.map((f, i) => ({
                  name: `@${f.item.path}`,
                  desc: i === atIdx ? "file" : "",
                }))}
                active={Math.min(atIdx, atMenu.items.length - 1)}
              />
            </box>
          )}

          {menuOpen && <SlashMenu items={menu} active={homeProps.menuActive} />}

          <PromptInput
            inputRef={inputRef}
            focused={!dlg}
            busy={busy && !!fgRef.current}
            agentLabel={agent.label}
            agentColor={agentColor}
            model={ALL_MODELS[modelIndex].id}
            provider={ALL_MODELS[modelIndex].provider}
            variant={variant}
            usage={usage}
            thinking={fgRef.current?.thought ?? null}
            elapsed={fgRef.current ? (now - fgRef.current.start) / 1000 : 0}
            animations={anim}
            tick={tick}
            shellMode={shellMode}
            onSend={send}
            onValueChange={handleValueChange}
          />

          <box height={2} paddingLeft={1} border={["top"]} borderColor={C.border}>
            <text>
              <b fg={quitHint ? C.warn : C.dim}>
                {quitHint ? "⚠ press esc again to quit" : "ctrl+x leader · ctrl+p commands · tab workspaces · /help"}
              </b>
            </text>
          </box>
        </box>
        )}

        {ws === "chat" && sidebarVisible && (
          <Sidebar
            sessionTitle={sessionList.find((s) => s.id === activeSessionRef.current)?.title ?? "session"}
            ctxK={ctxK}
            cost={sessionCostRef.current}
            spark={spark}
            files={modifiedFiles}
            todos={todos}
            filesOpen={filesOpen}
            todosOpen={todosOpen}
            cwd={cwd}
            branch={branch}
            working={workingRows}
            onToggleFiles={() => setFilesOpen((v) => !v)}
            onToggleTodos={() => setTodosOpen((v) => !v)}
          />
        )}
      </box>

      {dlg && (
        <FuzzyList
          title={dialogTitle[dlg.kind]}
          query={dlg.query}
          rows={dlgRows}
          index={dlg.index}
          maxVisible={Math.max(4, size.h - 12)}
          width={Math.min(88, size.w - 6)}
        />
      )}
      {ws === "agents" &&
        logOpen !== null &&
        (() => {
          const wk = orchState.workers.find((x) => x.id === logOpen)
          if (!wk) return null
          const t = (ts: number) => {
            const d = new Date(ts)
            const p = (n: number) => String(n).padStart(2, "0")
            return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
          }
          return (
            <Dialog title={`worker #${wk.id} · ${wk.name} · ${wk.status}`} escHint="esc close" width={Math.min(86, size.w - 6)}>
              <text>
                <span fg={C.faint}>{wk.task}</span>
              </text>
              {wk.log.slice(-Math.max(4, size.h - 18)).map((l, i) => (
                <text key={i}>
                  <span fg={C.dim}>{`${t(l.ts)}  ${l.text}`}</span>
                </text>
              ))}
              {wk.log.length === 0 && (
                <text>
                  <span fg={C.dim}>{"(no output yet)"}</span>
                </text>
              )}
            </Dialog>
          )
        })()}
      {leader && <WhichKey cols={Math.max(2, Math.floor(size.w / 72))} />}
      {np && <NpWizard np={np} width={Math.min(80, size.w - 6)} />}
      {ws === "expl" && exDiff && (
        <Dialog title={`diff · ${exDiff.title}`} escHint="esc close" width={Math.min(96, size.w - 6)}>
          {exDiff.lines.slice(0, Math.max(4, size.h - 16)).map((l, i) => (
            <text key={i}>
              <span fg={l.kind === "add" ? C.ok : l.kind === "del" ? C.err : C.faint}>
                {`${l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}${l.kind === "same" ? "" : " "}${l.text}`.slice(0, Math.max(20, size.w - 12))}
              </span>
            </text>
          ))}
          {exDiff.lines.length > size.h - 16 && (
            <text>
              <span fg={C.dim}>{`… ${exDiff.lines.length - (size.h - 16)} more lines`}</span>
            </text>
          )}
        </Dialog>
      )}
      {toast && <Toast text={toast.text} kind={toast.kind} />}
    </box>
  )
}

function TabStrip({ ws, project, onPick, running }: { ws: Ws; project: string; onPick: (w: Ws) => void; running: number }) {
  const tab = (id: Ws, key: string, label: string) => (
    <box flexDirection="row" onMouseUp={() => onPick(id)} backgroundColor={ws === id ? C.element : undefined}>
      <text>
        <span fg={ws === id ? C.primary : C.dim}>{` ${ws === id ? "▮" : "▯"} ${key} `}</span>
        <b fg={ws === id ? C.primary : C.faint}>{label}</b>
        {id === "dash" && running > 0 && <b fg={C.warn}>{` ⚇${running}`}</b>}
        <span fg={C.borderSubtle}>{"│"}</span>
      </text>
    </box>
  )
  return (
    <box flexDirection="row" paddingLeft={1} backgroundColor={C.panel} height={1} flexShrink={0}>
      {tab("dash", "1", "Dashboard")}
      {tab("chat", "2", "Chat")}
      {tab("expl", "3", "Explorer")}
      {tab("notes", "4", "Notes")}
      {tab("agents", "5", "Agents")}
      {tab("article", "6", "Article")}
      <box flexGrow={1} />
      <text>
        {project && (
          <>
            <span fg={C.primary}>{"⌗ "}</span>
            <b fg={C.faint}>{project}</b>
            <span fg={C.borderSubtle}>{" · "}</span>
          </>
        )}
        <span fg={C.dim}>{"tab to cycle"}</span>
      </text>
    </box>
  )
}

function Toast({ text, kind }: { text: string; kind: "info" | "ok" | "warn" | "err" }) {
  const col = kind === "ok" ? C.ok : kind === "warn" ? C.warn : kind === "err" ? C.err : C.info
  const icon = kind === "ok" ? "✓" : kind === "warn" ? "⚠" : kind === "err" ? "✕" : "ℹ"
  return (
    <box position="absolute" top={1} right={2} zIndex={30}>
      <box flexDirection="row" backgroundColor={C.element} paddingLeft={1} paddingRight={2} border={["left"]} borderColor={col}>
        <text>
          <b fg={col}>{`${icon} `}</b>
          <span fg={C.text}>{text}</span>
        </text>
      </box>
    </box>
  )
}

const NP_FIELDS: Record<string, { label: string; hint: string }> = {
  name: { label: "project name", hint: "lowercase latin / digits / _ - → templates/<name>/" },
  desc: { label: "task description (required)", hint: "goes to prompt.json — what exactly are we researching?" },
  idea: { label: "seed idea (required)", hint: "goes to seed_ideas.json — hypothesis / first experiment" },
  system: { label: "system persona (optional)", hint: "goes to prompt.json — enter with empty value for the default PhD student" },
}

function NpWizard({ np, width }: { np: NewProjectState; width: number }) {
  const order = ["name", "desc", "idea", "system", "skeleton", "confirm"] as const
  const idx = order.indexOf(np.step)
  const isText = np.step === "name" || np.step === "desc" || np.step === "idea" || np.step === "system"
  const cur = np.step === "name" || np.step === "desc" || np.step === "idea" || np.step === "system" ? np[np.step] : null
  const prompt =
    np.step === "confirm" || np.step === "skeleton"
      ? ""
      : `${NP_FIELDS[np.step].label}: `
  const preview = (s: string, n = 64) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  return (
    <Dialog title={`new project — step ${idx + 1}/${order.length}`} escHint="esc = back · enter = next" width={width}>
      {isText && (
        <>
          <text>
            <b fg={C.primary}>{prompt}</b>
            <span fg={C.text}>{cur}</span>
            <b fg={C.primary}>▌</b>
          </text>
          <text>
            <span fg={C.dim}>{`  ${NP_FIELDS[np.step].hint}`}</span>
          </text>
        </>
      )}
      {np.step === "skeleton" && (
        <>
          <text>
            <b fg={C.primary}>{"  AI skeleton?"}</b>
            <span fg={C.text}>{`  current: ${np.skeleton ? "yes" : "no (write prompt.json/seed_ideas.json only)"}`}</span>
          </text>
          <text>
            <span fg={C.dim}>{"  y — the model generates experiment.py + plot.py and runs the run_0 baseline"}</span>
          </text>
          <text>
            <span fg={C.dim}>{"  n — plain project (you can run /skeleton later) · esc — back"}</span>
          </text>
        </>
      )}
      {np.step === "confirm" && (
        <>
          <text>
            <span fg={C.faint}>{`name    `}</span>
            <b fg={C.text}>{np.name}</b>
          </text>
          <text>
            <span fg={C.faint}>{`task    `}</span>
            <span fg={C.text}>{preview(np.desc)}</span>
          </text>
          <text>
            <span fg={C.faint}>{`idea    `}</span>
            <span fg={C.text}>{preview(np.idea)}</span>
          </text>
          <text>
            <span fg={C.faint}>{`persona `}</span>
            <span fg={C.text}>{np.system ? preview(np.system) : "default (ambitious AI PhD student)"}</span>
          </text>
          <text>
            <span fg={C.faint}>{`skeleton`}</span>
            <span fg={np.skeleton ? C.ok : C.dim}>{np.skeleton ? "AI experiment.py + plot.py + run_0 baseline" : "skip — /skeleton <name> later"}</span>
          </text>
          <box marginTop={1}>
            <text>
              <b fg={C.ok}>{" y"}</b>
              <span fg={C.dim}>{" create templates/" + np.name + "/: prompt.json + seed_ideas.json + README.md    "}</span>
              <b fg={C.err}>{" n"}</b>
              <span fg={C.dim}>{" back"}</span>
            </text>
          </box>
        </>
      )}
      {np.error && (
        <text>
          <span fg={C.err}>{`⚠ ${np.error}`}</span>
        </text>
      )}
    </Dialog>
  )
}

