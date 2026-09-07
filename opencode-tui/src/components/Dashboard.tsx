import type { ReactNode } from "react"
import { C, SPARK, SPINNERS } from "../theme.ts"
import {
  workboard,
  projectIdeas,
  hasBaseline,
  selectedIdea,
  type IdeaCard,
  type ProjectInfo,
  type StageState,
} from "../lib/project.ts"
import { articleFor, articleSections, articleSummary, articleWordCount, type Article } from "../lib/articles.ts"
import type { AisEvent } from "../lib/aiscientist.ts"
import { type SysStats, EMPTY_SYS } from "../lib/sysmon.ts"
import type { Worker } from "../lib/orchestrator.ts"

export interface DashChip {
  short: string
  status: "pending" | "running" | "done" | "fail"
}

export interface DashPanel {
  id: number
  title: string
  status: "queued" | "running" | "done" | "failed" | "aborted"
  elapsed: number
  model: string
  chips: DashChip[]
  last: string
  rate: number[]
}

function StatusGlyph({ status }: { status: DashPanel["status"] }) {
  if (status === "running") return <b fg={C.warn}>{"▶ running"}</b>
  if (status === "done") return <b fg={C.ok}>{"✓ done"}</b>
  if (status === "failed") return <b fg={C.err}>{"✗ failed"}</b>
  if (status === "aborted") return <b fg={C.warn}>{"⊘ aborted"}</b>
  return <b fg={C.dim}>{"● queued"}</b>
}

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function Panel({ p, focused, w, tick, animations }: { p: DashPanel; focused: boolean; w: number; tick: number; animations: boolean }) {
  const max = Math.max(1, ...p.rate)
  const spark = p.rate
    .slice(-14)
    .map((v) => SPARK[Math.min(SPARK.length - 1, Math.round((v / max) * (SPARK.length - 1)))])
    .join("")
  const spin = animations && p.status === "running" ? SPINNERS[tick % SPINNERS.length] : " "
  return (
    <box
      width={w}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={focused ? C.primary : p.status === "failed" ? C.err : C.border}
      backgroundColor={focused ? C.selected : C.panel}
      paddingLeft={1}
      paddingRight={1}
      marginBottom={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text>
          <b fg={C.text}>{`#${p.id} `}</b>
          <span fg={C.info}>{p.title}</span>
          <span fg={C.warn}>{spin === " " ? "" : ` ${spin}`}</span>
        </text>
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text>
          <StatusGlyph status={p.status} />
          <span fg={C.dim}>{` · ${fmtDur(p.elapsed)}`}</span>
        </text>
        <text>
          <span fg={C.dim}>{p.model}</span>
        </text>
      </box>
      <text>
        {p.chips.map((ch) => (
          <span
            key={ch.short}
            fg={ch.status === "done" ? C.ok : ch.status === "fail" ? C.err : ch.status === "running" ? C.warn : C.dim}
          >{` ${ch.short}${ch.status === "done" ? "✓" : ch.status === "fail" ? "✗" : ch.status === "running" ? "▶" : "·"}`}</span>
        ))}
      </text>
      <text>
        <span fg={C.tool}>{spark.padEnd(14)}</span>
        <span fg={C.dim}>{" ev/s"}</span>
      </text>
      <text>
        <span fg={C.faint}>{p.last.length > w - 4 ? `${p.last.slice(0, w - 5)}…` : p.last}</span>
      </text>
    </box>
  )
}

export function sortPanels(panels: DashPanel[]): DashPanel[] {
  return [...panels].sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || b.id - a.id)
}

function StagePill({ s, first }: { s: StageState; first: boolean }) {
  const glyph = s.status === "done" ? "✓" : s.status === "running" ? "▶" : s.status === "fail" ? "✗" : "░"
  const col = s.status === "done" ? C.ok : s.status === "running" ? C.warn : s.status === "fail" ? C.err : C.dim
  const short: Record<string, string> = { ideas: "ide", novelty: "nov", experiments: "exp", writeup: "wru", review: "rev" }
  return (
    <span>
      {!first && <span fg={C.border}>{"─"}</span>}
      <span fg={col}>{`${glyph}${short[s.key] ?? s.key.slice(0, 3)}`}</span>
    </span>
  )
}

function WorkCol({ head, col, items, w }: { head: string; col: string; items: string[]; w: number }) {
  return (
    <box width={w} flexDirection="column" border={["left"]} borderColor={C.border} paddingLeft={1}>
      <text>
        <b fg={col}>{head}</b>
      </text>
      {items.length === 0 && (
        <text>
          <span fg={C.faint}>{"—"}</span>
        </text>
      )}
      {items.map((it, i) => (
        <text key={i}>
          <span fg={col === C.ok ? C.faint : col === C.warn ? C.text : C.dim}>
            {it.length > w - 3 ? `${it.slice(0, w - 4)}…` : it}
          </span>
        </text>
      ))}
    </box>
  )
}

// ------------------------------------------------------------------ btop grid

const HEAD = { text: C.faint, idea: C.primary, have: C.info, hyp: C.secondary, check: C.warn, now: C.ok, papers: C.tool }

function wrapText(s: string, w: number, maxLines: number): string[] {
  const words = (s || "").trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ""
  for (const word of words) {
    if (cur && cur.length + 1 + word.length > w) {
      lines.push(cur)
      cur = word
    } else {
      cur = cur ? `${cur} ${word}` : word
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, "")}…`
  }
  return lines.length ? lines : ["—"]
}

function Block({ head, col, w, children }: { head: string; col: string; w: number; children: ReactNode }) {
  return (
    <box
      width={w}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={C.border}
      backgroundColor={C.panel}
      paddingLeft={1}
      paddingRight={1}
    >
      <text>
        <b fg={col}>{head}</b>
      </text>
      {children}
    </box>
  )
}

const STAGE_COLOR: Record<string, string> = {
  ideas: C.info,
  novelty: C.secondary,
  experiments: C.tool,
  writeup: C.ok,
  review: C.warn,
  run: C.dim,
  system: C.dim,
}

function logGlyph(s: AisEvent["status"]): { g: string; col: string } {
  if (s === "done") return { g: "✓", col: C.ok }
  if (s === "fail") return { g: "✗", col: C.err }
  if (s === "started") return { g: "▶", col: C.warn }
  return { g: "·", col: C.dim }
}

function evTime(ts: string): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? "--:--" : d.toTimeString().slice(0, 5)
}

function LiveLog({ log, label, spin, tail, w }: { log: AisEvent[]; label: string; spin: string; tail: number; w: number }) {
  const rows = log.slice(-tail)
  return (
    <box
      width={w}
      height={8}
      flexShrink={0}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={C.border}
      backgroundColor={C.panel}
      paddingLeft={1}
      paddingRight={1}
    >
      <text>
        <b fg={C.dim}>{"LIVE LOG "}</b>
        <span fg={C.faint}>{label}</span>
        <span fg={C.warn}>{` ${spin}`}</span>
      </text>
      {rows.length === 0 && (
        <text>
          <span fg={C.faint}>{"— событий нет: /run <template> запустит пайплайн —"}</span>
        </text>
      )}
      {rows.map((e, i) => {
        const { g, col } = logGlyph(e.status)
        const sc = STAGE_COLOR[e.stage] ?? C.dim
        return (
          <text key={i}>
            <span fg={C.faint}>{`${evTime(e.ts)} `}</span>
            <span fg={sc}>{"["}</span>
            <span fg={sc}>{e.stage.padEnd(10)}</span>
            <span fg={sc}>{"] "}</span>
            <span fg={col}>{`${g} `}</span>
            <span fg={C.text}>{e.message.length > w - 30 ? `${e.message.slice(0, w - 31)}…` : e.message}</span>
          </text>
        )
      })}
    </box>
  )
}

function gauge(pct: number, n: number): string {
  const k = Math.max(0, Math.min(n, Math.round((pct / 100) * n)))
  return "▓".repeat(k) + "░".repeat(n - k)
}

function SysPanel({ sys, w }: { sys: SysStats; w: number }) {
  const procs = sys.procs
  const totCpu = procs.reduce((a, p) => a + p.cpu, 0)
  const totMem = procs.reduce((a, p) => a + p.memMb, 0)
  return (
    <box
      width={w}
      height={8}
      flexShrink={0}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={C.border}
      backgroundColor={C.panel}
      paddingLeft={1}
      paddingRight={1}
    >
      <text>
        <b fg={C.dim}>{"RES "}</b>
        <span fg={totCpu > 75 ? C.err : totCpu > 40 ? C.warn : C.ok}>{gauge(Math.min(100, totCpu), 10)}</span>
        <b fg={C.text}>{` ${totCpu}% cpu`}</b>
        <span fg={C.border}>{"  │  "}</span>
        <b fg={C.dim}>{`${String(totMem).padStart(5)} MB`}</b>
      </text>
      <text>
        <b fg={C.dim}>{"PID      CPU%   MB     PROCESS"}</b>
      </text>
      {procs.slice(0, 4).map((p) => (
        <text key={p.pid}>
          <span fg={C.faint}>{`${String(p.pid).padEnd(9)}`}</span>
          <span fg={p.cpu >= 50 ? C.err : p.cpu >= 10 ? C.warn : C.text}>{`${String(p.cpu).padStart(3)}%`}</span>
          <span fg={C.dim}>{`  ${String(p.memMb).padStart(5)}  `}</span>
          <span fg={C.faint}>{p.label.length > w - 26 ? `${p.label.slice(0, w - 27)}…` : p.label}</span>
        </text>
      ))}
      {procs.length === 0 && (
        <text>
          <span fg={C.faint}>{"— нет живых процессов пайплайна —"}</span>
        </text>
      )}
    </box>
  )
}

function PaperBlock({ a, project, w, onOpen }: { a: Article | null; project: string; w: number; onOpen: () => void }) {
  const body = a ? (
    <>
      <text>
        <b fg={C.primary}>{"▣ ЧИТАЕМ В ТУИ "}</b>
        <b fg={C.text}>{a.title.length > w - 22 ? `${a.title.slice(0, w - 23)}…` : a.title}</b>
      </text>
      <text>
        <span fg={C.faint}>{articleSummary(a).slice(0, w - 4) + (articleSummary(a).length > w - 4 ? "…" : "")}</span>
      </text>
      <text>
        <span fg={C.dim}>{`${articleSections(a)} разделов · ~${articleWordCount(a)} слов · `}</span>
        <b fg={C.info}>{"a — открыть · glow-читалка"}</b>
      </text>
    </>
  ) : (
    <>
      <text>
        <b fg={C.dim}>{"▣ документ проекта "}</b>
        <b fg={C.faint}>{project || "— нет проекта —"}</b>
      </text>
      <text>
        <span fg={C.dim}>
          {project
            ? `нет real-документа: ни results/${project}/**/paper.md, ни templates/${project}/README.md`
            : "P — открыть проект · N — создать новый (мастер запишет README.md)"}
        </span>
      </text>
      <text>
        <span fg={C.faint}>{" "}</span>
      </text>
    </>
  )
  return (
    <box
      width={w}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={C.border}
      backgroundColor={C.panel}
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={onOpen}
    >
      {body}
    </box>
  )
}

export function Dashboard({
  panels,
  focus,
  cols,
  panelW,
  tick,
  animations,
  counts,
  lastRun,
  project,
  workers,
  projectsCount,
  onPickProject,
  onOpenArticle,
  availW,
  delArmed,
  log,
  logLabel,
  sys,
}: {
  panels: DashPanel[]
  focus: number
  cols: number
  panelW: number
  tick: number
  animations: boolean
  counts: { running: number; total: number }
  lastRun: string
  project: ProjectInfo | null
  workers: Worker[]
  projectsCount: number
  onPickProject: () => void
  onOpenArticle: () => void
  availW: number
  delArmed: boolean
  log: AisEvent[]
  logLabel: string
  sys: SysStats
}) {
  const rows: DashPanel[][] = []
  const ordered = panels.map((p, i) => ({ p, i }))
  for (let i = 0; i < ordered.length; i += cols) rows.push(ordered.slice(i, i + cols).map((x) => x.p))
  const fullW = Math.min(availW - 4, 132)
  const halfW = Math.max(30, Math.floor((fullW - 1) / 2))
  const art = articleFor(project?.name)
  const wb = project ? workboard(project, workers, 3) : null
  const active = workers.filter((x) => x.status === "running" || x.status === "queued")
  const doneN = project?.stages.filter((s) => s.status === "done").length ?? 0
  const totalN = project?.stages.length ?? 5
  const prog = totalN ? doneN / totalN : 0
  const barW = Math.max(10, Math.floor(fullW / 3))
  const bar = "█".repeat(Math.round(prog * barW)) + "░".repeat(barW - Math.round(prog * barW))
  const spin = animations && (project?.running ?? 0) > 0 ? SPINNERS[tick % SPINNERS.length] : "⚇"

  const idea: IdeaCard | null = project ? selectedIdea(project, projectIdeas(project.name)) : null
  const textW = halfW - 4

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <scrollbox flexGrow={1} scrollY paddingLeft={0} paddingRight={1}>
        {project ? (
          <>
            <box flexDirection="row" justifyContent="space-between" onMouseUp={onPickProject}>
              <text>
                <span fg={C.dim}>{"research ▸ "}</span>
                <b fg={C.primary}>{project.name}</b>
                <span fg={C.warn}>{` ${spin}`}</span>
                <b fg={C.faint}>{`  ${project.totalRuns} run${project.totalRuns === 1 ? "" : "s"}`}</b>
              </text>
              <text>
                <span fg={C.dim}>{`${projectsCount} проектов · ctrl+x p — сменить`}</span>
              </text>
            </box>

            {/* r1: IDEA | HAVE */}
            <box flexDirection="row" marginTop={1}>
              <Block head="IDEA — что исследуем" col={HEAD.idea} w={halfW}>
                {idea ? (
                  <>
                    <text>
                      <b fg={C.text}>{idea.name.length > textW ? `${idea.name.slice(0, textW - 1)}…` : idea.name}</b>
                    </text>
                    {wrapText(idea.title, textW, 2).map((l, i) => (
                      <text key={i}>
                        <span fg={C.faint}>{l}</span>
                      </text>
                    ))}
                  </>
                ) : (
                  <text>
                    <span fg={C.faint}>{`— нет идей в templates/${project.name}/ideas.json — /run сгенерирует`}</span>
                  </text>
                )}
              </Block>
              <Block head="HAVE — чем располагаем" col={HEAD.have} w={fullW - halfW}>
                {wrapText(project.description || "описание не задано в prompt.json", fullW - halfW - 4, 2).map((l, i) => (
                  <text key={i}>
                    <span fg={C.text}>{l}</span>
                  </text>
                ))}
                <text>
                  <span fg={C.dim}>{"baseline run_0  "}</span>
                  <span fg={hasBaseline(project.name) ? C.ok : C.err}>{hasBaseline(project.name) ? "есть ✓" : "нет ✗ (нужен для experiments)"}</span>
                </text>
                <text>
                  <span fg={C.dim}>{"ideas  "}</span>
                  <span fg={C.text}>{project.ideas ? `${project.ideas.total} (reviewed: ${project.ideas.byStatus["reviewed"] ?? 0})` : "—"}</span>
                  <span fg={C.dim}>{`   last run: ${lastRun}`}</span>
                </text>
              </Block>
            </box>

            {/* r2: HYPOTHESIS | CHECK */}
            <box flexDirection="row">
              <Block head="HYPOTHESIS — проверим, что…" col={HEAD.hyp} w={halfW}>
                {idea?.experiment ? (
                  wrapText(idea.experiment, textW, 3).map((l, i) => (
                    <text key={i}>
                      <span fg={C.faint}>{l}</span>
                    </text>
                  ))
                ) : (
                  <text>
                    <span fg={C.faint}>{"— формулировка эксперимента появится вместе с идеей —"}</span>
                  </text>
                )}
              </Block>
              <Block head="CHECK — где прогон" col={HEAD.check} w={fullW - halfW}>
                <text>
                  <b fg={C.dim}>{"pipeline "}</b>
                  {project.stages.map((s, i) => (
                    <StagePill key={s.key} s={s} first={i === 0} />
                  ))}
                </text>
                <text>
                  <span fg={C.dim}>{"progress "}</span>
                  <span fg={prog > 0.99 ? C.ok : C.warn}>{bar}</span>
                  <b fg={C.text}>{` ${Math.round(prog * 100)}%`}</b>
                </text>
                {wb && (
                  <text>
                    <b fg={C.ok}>{`✓ done (${wb.done.length})`}</b>
                    <span fg={C.dim}>{" · "}</span>
                    <b fg={C.warn}>{`▶ doing (${wb.doing.length})`}</b>
                    <span fg={C.dim}>{" · "}</span>
                    <b fg={C.dim}>{`· planned (${wb.planned.length})`}</b>
                    {wb.doing[0] && wb.doing[0] !== "— idle" && <span fg={C.text}>{`  ◂ ${wb.doing[0]}`}</span>}
                  </text>
                )}
              </Block>
            </box>

            {/* r3: NOW | PAPERS */}
            <box flexDirection="row">
              <BoxNow w={halfW} project={project} log={log} active={active} />
              <PaperBlock a={art} project={project.name} w={fullW - halfW} onOpen={onOpenArticle} />
            </box>
          </>
        ) : (
          <box flexDirection="column" marginTop={1}>
            <text>
              <b fg={C.dim}>{"no project"}</b>
              <span fg={C.faint}>{` — ${projectsCount} доступны: P — открыть, N — создать`}</span>
            </text>
            <box flexDirection="row" marginTop={1}>
              <PaperBlock a={null} project="" w={halfW} onOpen={onOpenArticle} />
            </box>
          </box>
        )}

        <box flexDirection="row" justifyContent="space-between" marginTop={1} marginBottom={1}>
          <text>
            <b fg={C.text}>{"▦ experiments "}</b>
            <span fg={C.warn}>{`${counts.running} running`}</span>
            <span fg={C.dim}>{` / ${counts.total} total`}</span>
          </text>
          <text>
            <span fg={C.dim}>{`↑↓←→ select · enter events · x stop/kill · d remove record · a article`}</span>
          </text>
        </box>
        {panels.length === 0 ? (
          <box flexDirection="column" alignItems="flex-start" paddingTop={1} paddingLeft={1}>
            <text>
              <b fg={C.dim}>{"no experiments yet"}</b>
            </text>
            <text>
              <span fg={C.faint}>{`/run ${project?.name ?? "<template>"} — then follow stages, agents and results here`}</span>
            </text>
          </box>
        ) : (
          <box flexDirection="column">
            {rows.map((r, ri) => (
              <box key={ri} flexDirection="row">
                {r.map((p) => (
                  <Panel key={p.id} p={p} focused={panels[focus]?.id === p.id} w={panelW} tick={tick} animations={animations} />
                ))}
              </box>
            ))}
          </box>
        )}
      </scrollbox>
      <box flexDirection="row" flexShrink={0}>
        <SysPanel sys={sys ?? EMPTY_SYS} w={halfW} />
        <LiveLog log={log} label={logLabel} spin={project && project.running > 0 ? spin : " "} tail={5} w={fullW - halfW} />
      </box>
      <box border={["top"]} borderColor={C.border}>
        <text>
          <span fg={C.dim}>{`1 Dashboard · 2 Chat · 3 Explorer · 4 Notes · 5 Agents · 6 Article — a открыть статью, tab цикл${project ? ` · ${counts.running} running / ${counts.total} total${delArmed ? " — d ещё раз: удалить запись" : ""}` : ""}`}</span>
        </text>
      </box>
    </box>
  )
}

function BoxNow({ w, project, log, active }: { w: number; project: ProjectInfo; log: AisEvent[]; active: Worker[] }) {
  const lastEv = [...log].reverse().find((e) => e.stage !== "run")
  const runningAgent = project.agents.find((a) => a.status === "running")
  const lastAgent = project.agents[0]
  const sc = lastEv ? STAGE_COLOR[lastEv.stage] ?? C.dim : C.dim
  return (
    <Block head="NOW — текущий момент" col={HEAD.now} w={w}>
      <text>
        {runningAgent ? (
          <>
            <span fg={C.warn}>{"▶ "}</span>
            <b fg={C.text}>{`run #${runningAgent.jobId}`}</b>
            <span fg={C.dim}>{` · ${runningAgent.idea} · ${runningAgent.model}`}</span>
          </>
        ) : lastAgent ? (
          <>
            <span fg={C.dim}>{"○ "}</span>
            <b fg={C.faint}>{`run #${lastAgent.jobId} ${lastAgent.status}`}</b>
          </>
        ) : (
          <span fg={C.faint}>{"— ни одного прогона — /run " + project.name}</span>
        )}
      </text>
      {lastEv ? (
        <text>
          <span fg={C.faint}>{`${evTime(lastEv.ts)} `}</span>
          <span fg={sc}>{"[" + lastEv.stage + "] "}</span>
          <span fg={C.text}>{lastEv.message.length > w - 22 ? `${lastEv.message.slice(0, w - 23)}…` : lastEv.message}</span>
        </text>
      ) : (
        <text>
          <span fg={C.faint}>{"нет событий — logs появятся здесь live"}</span>
        </text>
      )}
      <text>
        <span fg={C.dim}>{"agents  "}</span>
        {active.length === 0 && <span fg={C.faint}>{"idle — 5 Agents · d — делегировать"}</span>}
        {active.slice(0, 5).map((wk, i) => (
          <span key={wk.id}>
            {i > 0 && <span fg={C.border}>{" · "}</span>}
            <span fg={wk.status === "running" ? C.ok : C.dim}>{wk.status === "running" ? "●" : "○"}</span>
            <span fg={wk.status === "running" ? C.text : C.faint}>{` ${wk.name}${wk.kind !== "job" && wk.progress >= 0 ? ` ${Math.round(wk.progress * 100)}%` : ""}`}</span>
          </span>
        ))}
        {active.length > 5 && <span fg={C.dim}>{` +${active.length - 5}`}</span>}
      </text>
    </Block>
  )
}
