import { useEffect, useState } from "react"
import type { RefObject } from "react"
import type { InputRenderable } from "@opentui/core"
import { C, TIPS, VERSION, type ModelInfo } from "../theme.ts"
import { llmReady, routerLabel } from "../lib/llm.ts"
import type { ProjectInfo } from "../lib/project.ts"
import type { Worker } from "../lib/orchestrator.ts"
import { AsciiStage } from "./AsciiStage.tsx"
import { ProjectPanel } from "./ProjectPanel.tsx"
import { SlashMenu } from "./SlashMenu.tsx"

export function HomeScreen({
  inputRef,
  model,
  agentLabel,
  agentColor,
  effectName,
  menu,
  menuActive,
  atItems,
  atActive,
  cwd,
  branch,
  tipsEnabled,
  project,
  projectsCount,
  onPickProject,
  onContinue,
  onNewProject,
  onRunProject,
  onGoDashboard,
  consult,
  busy,
  thinking,
  workers,
  now,
  animations,
  maxW = 75,
  onSend,
  onValueChange,
}: {
  inputRef: RefObject<InputRenderable | null>
  model: ModelInfo
  agentLabel: string
  agentColor: string
  effectName: string
  menu: { name: string; desc: string }[]
  menuActive: number
  atItems: { name: string; desc: string }[]
  atActive: number
  cwd: string
  branch: string | null
  tipsEnabled: boolean
  project: ProjectInfo | null
  projectsCount: number
  onPickProject: () => void
  onContinue: () => void
  onNewProject: () => void
  onRunProject: () => void
  onGoDashboard: () => void
  consult: { q: string; a: string; running: boolean } | null
  busy: boolean
  thinking: string | null
  workers: Worker[]
  now: number
  animations: boolean
  maxW?: number
  onSend: (text: string) => void
  onValueChange: (value: string) => void
}) {
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length))
  const [ph, setPh] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 6000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const t = setInterval(() => setPh((i) => (i + 1) % 99), 4500)
    return () => clearInterval(t)
  }, [])

  const placeholder = ph % 4 === 3 ? "!git status  (shell mode)" : 'Ask anything... the advisor answers right here'
  const trunc = (s: string, w: number) => (s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s)

  const MENU: { key: string; label: string; hint: string; run: () => void }[] = [
    { key: "C", label: "continue project", hint: project ? `«${project.name}» — run #${project.running} live / open dashboard` : "no previous project — press P first", run: onContinue },
    { key: "P", label: "open project", hint: `${projectsCount} research projects`, run: onPickProject },
    { key: "N", label: "new project", hint: "wizard — writes prompt.json + seed_ideas.json", run: onNewProject },
    { key: "R", label: "run pipeline", hint: project ? `/run ${project.name}` : "/run <template>", run: onRunProject },
    { key: "D", label: "dashboard", hint: "1 — experiments, agents, article", run: onGoDashboard },
    { key: "I", label: "AGENTS.md", hint: "/init — bootstrap project context", run: () => onSend("/init") },
  ]

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={C.bg}>
      <box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
        <AsciiStage w={maxW} now={now} animated={animations} />

        <box flexDirection="column" width={maxW}>
          <ProjectPanel info={project} w={maxW} projectsCount={projectsCount} workers={workers} onPick={onPickProject} onContinue={project ? onContinue : undefined} />
        </box>

        <box flexDirection="column" width={maxW} marginTop={1} border borderStyle="rounded" borderColor={C.borderSubtle} backgroundColor={C.element} paddingLeft={1} paddingRight={1}>
          <text>
            <b fg={C.dim}>{"  research menu "}</b>
            <span fg={C.faint}>{"— press the key with shift while the prompt is empty · click to run"}</span>
          </text>
          {MENU.map((m) => (
            <box key={m.key} flexDirection="row" onMouseUp={m.run}>
              <text selectable={false}>
                <b fg={C.primary}>{`    ${m.key.padEnd(3)}`}</b>
                <b fg={C.text}>{m.label.padEnd(16)}</b>
                <span fg={C.dim}>{m.hint}</span>
              </text>
            </box>
          ))}
        </box>

        {consult && (
          <box flexDirection="column" width={maxW} marginTop={1} border borderStyle="rounded" borderColor={agentColor} backgroundColor={C.element} paddingLeft={1} paddingRight={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text>
                <b fg={agentColor}>{"▣ advisor"}</b>
                <span fg={C.faint}>{" · consults, never runs"}</span>
              </text>
              <text>
                <span fg={C.dim}>{consult.running ? `${thinking ?? "thinking"}…` : "2 — full chat"}</span>
              </text>
            </box>
            <text>
              <b fg={C.faint}>{"you  "}</b>
              <span fg={C.text}>{trunc(consult.q, maxW - 8)}</span>
            </text>
            {consult.a ? (
              consult.a
                .split("\n")
                .filter((l) => l.trim())
                .slice(0, 8)
                .map((l, i) => (
                  <text key={i}>
                    <span fg={C.text}>{trunc(l, maxW - 4)}</span>
                  </text>
                ))
            ) : (
              <text>
                <b fg={agentColor}>{"▌ thinking…"}</b>
              </text>
            )}
            {consult.a.split("\n").filter((l) => l.trim()).length > 8 && (
              <text>
                <span fg={C.dim}>{`… press 2 to open the full chat and see the rest`}</span>
              </text>
            )}
            {consult.running && consult.a !== "" && (
              <text>
                <b fg={agentColor}>▌</b>
              </text>
            )}
          </box>
        )}

        <box flexDirection="column" marginTop={1} width={maxW}>
          <box
            border
            borderStyle="rounded"
            borderColor={busy ? agentColor : C.borderActive}
            backgroundColor={C.element}
            paddingLeft={1}
            paddingRight={1}
          >
            <input
              ref={inputRef}
              focused
              placeholder={placeholder}
              placeholderColor={C.dim}
              textColor={C.text}
              cursorColor={agentColor}
              backgroundColor={C.element}
              onInput={(v: string) => onValueChange(v)}
              onSubmit={(e: unknown) => onSend(typeof e === "string" ? e : (inputRef.current?.value ?? ""))}
            />
          </box>
          <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
            <text>
              <b fg={agentColor}>{agentLabel}</b>
              <span fg={C.dim}>{" · "}</span>
              <span fg={C.faint}>{model.id.length > 42 ? `${model.id.slice(0, 41)}…` : model.id}</span>
              <span fg={C.dim}>{` ${model.provider}`}</span>
            </text>
            <text>
              <b fg={C.text}>{"2"}</b>
              <span fg={C.dim}>{" chat · "}</span>
              <b fg={C.text}>{"ctrl+p"}</b>
              <span fg={C.dim}>{" commands"}</span>
            </text>
          </box>
        </box>

        {atItems.length > 0 && (
          <box width={maxW} marginTop={1}>
            <SlashMenu items={atItems} active={atActive} />
          </box>
        )}

        {menu.length > 0 && (
          <box width={maxW} marginTop={1}>
            <SlashMenu items={menu} active={menuActive} />
          </box>
        )}

        {tipsEnabled && (
          <box marginTop={1} width={maxW}>
            <text selectable={false}>
              <span fg={C.warn}>{"Tip  "}</span>
              <span fg={C.faint}>{TIPS[tip]}</span>
            </text>
          </box>
        )}
      </box>

      <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text>
          <span fg={C.faint}>{`${cwd}${branch ? `:${branch}` : ""}`}</span>
          <span fg={C.dim}>{"   "}</span>
          <span fg={llmReady() ? C.ok : C.warn}>{"⊙"}</span>
          <span fg={C.dim}>{" "}</span>
          <b fg={C.text}>{llmReady() ? routerLabel() : "LLM offline"}</b>
          <span fg={C.dim}>{"  "}</span>
          <span fg={C.info}>{"/status"}</span>
        </text>
        <text>
          <span fg={C.dim}>{effectName !== "none" ? `fx: ${effectName} · ` : ""}</span>
          <span fg={C.faint}>{VERSION}</span>
        </text>
      </box>
    </box>
  )
}

