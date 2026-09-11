import { useMemo } from "react"
import { C } from "../theme.ts"
import type { AisEvent, AisJob } from "../lib/aiscientist.ts"
import { paperProgress, paperSectionStates, type Phase } from "../lib/paper.ts"

const PHASE_LABEL: Record<Phase, string> = {
  pending: "…",
  draft: "draft",
  cite: "cite",
  refine: "refine",
  final: "polish",
  compile: "compile",
  done: "done",
  failed: "FAILED",
}

function phaseColor(p: Phase): string {
  if (p === "done") return C.ok
  if (p === "failed") return C.err
  if (p === "pending") return C.faint
  return C.warn
}

function stColor(s: string): string {
  return s === "done" ? C.ok : s === "failed" ? C.err : s === "running" ? C.warn : C.faint
}

export function PaperWorkspace({
  project,
  job,
  events,
  pdfPath,
  availW,
  running,
}: {
  project: string
  job: AisJob | undefined
  events: AisEvent[]
  pdfPath: string
  availW: number
  running: boolean
}) {
  const sections = useMemo(() => paperSectionStates(events), [events])
  const prog = useMemo(() => paperProgress(events), [events])
  const tail = useMemo(
    () =>
      events
        .filter((e) => ["writeup", "review", "improve", "run"].includes(e.stage) && e.status !== "started")
        .slice(-14),
    [events],
  )
  const half = Math.max(30, Math.floor((availW - 6) / 2))
  const fmt = (ts: string) => (ts ? ts.slice(11, 19) : "––:––:––")

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={C.bg}>
      <box flexDirection="column" flexShrink={0} paddingLeft={2} paddingTop={1} paddingBottom={1} border={["bottom"]} borderColor={C.border}>
        <text>
          <b fg={C.primary}>{"✎ Paper — writing the article"}</b>
          <span fg={C.dim}>{`  ${project || "(no project)"}${job ? ` · job #${job.id} · ${job.status}` : ""}${running ? "  ● live" : ""}`}</span>
        </text>
        <text>
          <span fg={C.dim}>{`folder: ${prog.folder || "—"}  ·  idea: ${prog.idea || "—"}  ·  ${pdfPath ? `pdf: ${pdfPath}` : "pdf: not compiled yet"}`}</span>
        </text>
      </box>

      <box flexDirection="row" flexGrow={1}>
        {/* left: section checklist built from detail={section,phase} events */}
        <box flexDirection="column" width={half} paddingLeft={2} border={["right"]} borderColor={C.borderSubtle}>
          <text><b fg={C.faint}>SECTIONS</b></text>
          {sections.map((s) => (
            <text key={s.section}>
              <span fg={phaseColor(s.phase)}>{s.phase === "done" ? "✔ " : s.phase === "failed" ? "✖ " : s.phase === "pending" ? "· " : "▶ "}</span>
              <span fg={s.phase === "pending" ? C.faint : C.text}>{s.section.padEnd(20)}</span>
              <span fg={phaseColor(s.phase)}>{` ${PHASE_LABEL[s.phase]}`}</span>
              <span fg={C.borderSubtle}>{`  ${fmt(s.ts)}`}</span>
            </text>
          ))}
        </box>

        {/* right: stage summary + model roles + live tail */}
        <box flexDirection="column" flexGrow={1} paddingLeft={2}>
          <text><b fg={C.faint}>STAGES</b></text>
          <text>
            <span fg={stColor(prog.writeup)}>{`writeup ${prog.writeup}`}</span>
            <span fg={C.borderSubtle}>{" → "}</span>
            <span fg={stColor(prog.review)}>{`review ${prog.review}`}</span>
            {prog.improve && (
              <>
                <span fg={C.borderSubtle}>{" → "}</span>
                <span fg={stColor(prog.improve)}>{`improve ${prog.improve}`}</span>
              </>
            )}
          </text>
          {prog.score !== null && <text><span fg={C.ok}>{`review score: ${prog.score}/10`}</span></text>}
          {prog.beforeAfter && <text><span fg={C.warn}>{`repair: ${prog.beforeAfter}`}</span></text>}
          <text>
            <b fg={C.faint}>MODELS</b>
          </text>
          <text><span fg={C.dim}>{`plan  = ${prog.models.plan || job?.model || "(default)"}`}</span></text>
          <text><span fg={C.dim}>{`code  = ${job?.module?.startsWith("writeup") ? "aider (project coder model)" : "aider"}`}</span></text>
          <text><span fg={C.dim}>{"review= auto-pick unless AISC_REVIEW_MODEL"}</span></text>
          <text><b fg={C.faint}>LIVE LOG</b></text>
          <box flexDirection="column" flexGrow={1}>
            {tail.map((e, i) => (
              <text key={i}>
                <span fg={C.borderSubtle}>{`${e.ts.slice(11, 19)} `}</span>
                <span fg={e.status === "fail" ? C.err : e.status === "done" ? C.ok : C.dim}>{`[${e.stage}] `}</span>
                <span fg={C.text}>{e.message.slice(0, availW - half - 16)}</span>
              </text>
            ))}
            {!tail.length && <text><span fg={C.faint}>{"nothing yet — /paper starts writing for the newest run of this project"}</span></text>}
          </box>
          <text><span fg={C.dim}>{"p start/redo paper · enter open Article"}</span></text>
        </box>
      </box>
    </box>
  )
}
