import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import { App } from "./App.tsx"
import { resetSettings } from "./theme.ts"
import { PROJECT_ROOT } from "./lib/aiscientist.ts"

process.env.AISC_TUI_OFFLINE = "1"
// every artifact dir the App touches must be a throwaway temp: tests may not
// read (or leak into) the developer's real results/, agents or sessions state
const tmpAgents = mkdtempSync(join(tmpdir(), "ais-agents-test-"))
const tmpSessions = mkdtempSync(join(tmpdir(), "ais-sessions-test-"))
const tmpResults = mkdtempSync(join(tmpdir(), "ais-results-test-"))
const tmpVault = mkdtempSync(join(tmpdir(), "ais-vault-test-"))
// set in beforeAll: bun may evaluate several files before running tests, so
// module-level assignment lets the last-loaded file win for ALL of them
beforeAll(() => {
  process.env.AISC_AGENTS_DIR = tmpAgents
  process.env.AISC_SESSIONS_DIR = tmpSessions
  process.env.AISC_RESULTS_DIR = tmpResults
  // Notes must never depend on the developer's real .env having a vault
  process.env.OBSIDIAN_VAULT_PATH = tmpVault
})

const STATE = join(import.meta.dir, "..", "state.json")

// Every UI test starts from a clean slate: the settings singleton is mutated by
// patchSettings() at runtime, so deleting state.json alone leaks project/model/theme
// from one test into the next.
beforeEach(() => {
  resetSettings()
  if (existsSync(STATE)) rmSync(STATE)
})

async function frameUntil(setup: TestRendererSetup, pred: (f: string) => boolean, ms = 6000): Promise<string> {
  const deadline = Date.now() + ms
  let last = ""
  while (Date.now() < deadline) {
    await setup.renderOnce()
    last = setup.captureCharFrame()
    if (pred(last)) return last
    await Bun.sleep(20)
  }
  throw new Error(`frame predicate not met within ${ms}ms; last frame:\n${last}`)
}

async function toChat(setup: TestRendererSetup) {
  setup.mockInput.pressKey("2")
  await Bun.sleep(120)
  return frameUntil(setup, (f) => f.includes("Ask anything"))
}

async function pickProject(setup: TestRendererSetup, name: string) {
  await toChat(setup)
  await setup.mockInput.typeText(`/project ${name}`, 10)
  setup.mockInput.pressEnter()
  return frameUntil(setup, (f) => f.includes(`project: ${name}`))
}

test("boot opens the doom-style research menu with a centered prompt", async () => {
  const setup = await testRender(<App />, { width: 120, height: 36 })
  try {
    await setup.renderOnce()
    const home = await frameUntil(setup, (f) => f.includes("research menu"))
    expect(home).toContain("open project")
    expect(home).toContain("new project")
    expect(home).toContain("run pipeline")
    expect(home).toContain("Ask anything")
    // lowercase typing must NOT be hijacked by the Shift-menu
    await setup.mockInput.typeText("run the tests please")
    const typed = await frameUntil(setup, (f) => f.includes("run the tests please"), 3000)
    expect(typed).toContain("run the tests please")
    for (let i = 0; i < 21; i++) setup.mockInput.pressBackspace()
    setup.mockInput.pressKey("p", { shift: true })
    const dlg = await frameUntil(setup, (f) => f.includes("Select project"))
    expect(dlg).toContain("trains small")
    setup.mockInput.pressEscape()
    await frameUntil(setup, (f) => !f.includes("Select project") && f.includes("research menu"))
  } finally {
    setup.renderer.destroy()
    if (existsSync(STATE)) rmSync(STATE)
  }
})

test("new project wizard: enforces required info, creates prompt.json + seed_ideas.json", async () => {
  const dir = join(PROJECT_ROOT, "templates", "smoke_wizard_proj")
  rmSync(dir, { recursive: true, force: true })
  const setup = await testRender(<App />, { width: 120, height: 36 })
  try {
    await setup.renderOnce()
    await frameUntil(setup, (f) => f.includes("research menu"))
    setup.mockInput.pressKey("n", { shift: true })
    await frameUntil(setup, (f) => f.includes("new project — step 1/6"))
    await setup.mockInput.typeText("smoke_wizard_proj", 10)
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("task description"))
    setup.mockInput.pressEnter()
    const err = await frameUntil(setup, (f) => f.includes("required"))
    expect(err).toContain("prompt.json")
    await setup.mockInput.typeText("Study grokking dynamics on tiny transformers with a new optimizer.", 5)
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("seed idea"))
    setup.mockInput.pressEnter()
    expect(setup.captureCharFrame()).toContain("required")
    await setup.mockInput.typeText("Grokking speed depends on weight decay scheduling.", 5)
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("system persona"))
    setup.mockInput.pressEnter()
    const skel = await frameUntil(setup, (f) => f.includes("AI skeleton?"))
    expect(skel).toContain("step 5/6")
    setup.mockInput.pressKey("n")
    const conf = await frameUntil(setup, (f) => f.includes("step 6/6"))
    expect(conf).toContain("smoke_wizard_proj")
    expect(conf).toContain("Grokking speed")
    expect(conf).toContain("/skeleton")
    setup.mockInput.pressKey("y")
    const done = await frameUntil(setup, (f) => f.includes("Project «smoke_wizard_proj» created"), 8000)
    expect(done).toContain("prompt.json")
    const prompt = JSON.parse(readFileSync(join(dir, "prompt.json"), "utf8"))
    expect(prompt.task_description).toContain("grokking")
    const seeds = JSON.parse(readFileSync(join(dir, "seed_ideas.json"), "utf8"))
    expect(seeds[0].Title).toContain("Grokking")
    expect(existsSync(join(dir, "README.md"))).toBe(true)
  } finally {
    setup.renderer.destroy()
    rmSync(dir, { recursive: true, force: true })
    if (existsSync(STATE)) rmSync(STATE)
  }
})

test("dashboard shows the real project document card (no mock articles)", async () => {
  const setup = await testRender(<App />, { width: 120, height: 34 })
  try {
    await setup.renderOnce()
    await pickProject(setup, "nanoGPT_lite")
    setup.mockInput.pressKey("1")
    const dash = await frameUntil(setup, (f) => f.includes("▮ 1 Dashboard"))
    expect(dash).toContain("research ▸ nanoGPT_lite")
    expect(dash).toContain("pipeline")
    expect(dash).toContain("done")
    expect(dash).toContain("doing")
    expect(dash).toContain("planned")
    expect(dash).toContain("NanoGPT Lite")
    expect(dash).not.toContain("Attention Is All You Need")
    expect(dash).toContain("▦ experiments")
  } finally {
    setup.renderer.destroy()
    if (existsSync(STATE)) rmSync(STATE)
  }
})

test("dashboard renders the btop research grid: IDEA/HAVE/HYPOTHESIS/CHECK/NOW + live log", async () => {
  const setup = await testRender(<App />, { width: 120, height: 38 })
  try {
    await setup.renderOnce()
    await pickProject(setup, "nanoGPT_lite")
    setup.mockInput.pressKey("1")
    const dash = await frameUntil(setup, (f) => f.includes("▦ experiments"))
    for (const head of ["IDEA —", "HAVE —", "HYPOTHESIS —", "CHECK —", "NOW —", "LIVE LOG"]) {
      expect(dash).toContain(head)
    }
    expect(dash).toContain("adaptive_block_size")
    expect(dash).toMatch(/ide─.nov─.exp─.wru─.rev/)
    expect(dash).toContain("RES")
    expect(dash).toContain("MB")
    expect(dash).toContain("PROCESS")
    expect(dash).toContain("PID")
  } finally {
    setup.renderer.destroy()
    if (existsSync(STATE)) rmSync(STATE)
  }
})

test("a opens the project's real README fullscreen; esc returns", async () => {
  const setup = await testRender(<App />, { width: 110, height: 30 })
  try {
    await setup.renderOnce()
    await pickProject(setup, "nanoGPT_lite")
    setup.mockInput.pressKey("1")
    await frameUntil(setup, (f) => f.includes("▮ 1 Dashboard"))
    setup.mockInput.pressKey("a")
    const art = await frameUntil(setup, (f) => f.includes("▍ NanoGPT Lite"))
    expect(art).toContain("character-level")
    expect(art).toContain("back to dashboard")
    setup.mockInput.pressEscape()
    await frameUntil(setup, (f) => f.includes("▮ 1 Dashboard") && !f.includes("back to dashboard"))
  } finally {
    setup.renderer.destroy()
    if (existsSync(STATE)) rmSync(STATE)
  }
})

test("with no project picked the dashboard stays honest (no fake defaults)", async () => {
  if (existsSync(STATE)) rmSync(STATE)
  const setup = await testRender(<App />, { width: 120, height: 34 })
  try {
    await setup.renderOnce()
    setup.mockInput.pressKey("1")
    const dash = await frameUntil(setup, (f) => f.includes("▮ 1 Dashboard"))
    expect(dash).toContain("документ проекта")
    expect(dash).not.toContain("research ▸ 2d_diffusion")
    expect(dash).not.toContain("Attention Is All You Need")
  } finally {
    setup.renderer.destroy()
  }
})

test("start-menu prompt is the advisor: answers in place, never enters build/research", async () => {
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText("which project should I run first", 10)
    setup.mockInput.pressEnter()
    const consult = await frameUntil(setup, (f) => f.includes("▣ advisor"), 8000)
    expect(consult).toContain("which project should I run first")
    expect(consult).toContain("research menu")
    expect(consult).not.toContain("▮ 1 Dashboard")
    const answered = await frameUntil(setup, (f) => f.includes("LLM backend is not available"), 8000)
    expect(answered).toContain("▣ advisor")
  } finally {
    setup.renderer.destroy()
  }
})

test("chat home shows model, honest llm badge and hints", async () => {
  const setup = await testRender(<App />, { width: 120, height: 34 })
  try {
    await setup.renderOnce()
    const home = await toChat(setup)
    expect(home).toContain("Ask anything")
    expect(home).toContain("Advisor ·")
    expect(home).toContain("LLM offline")
    expect(home).toContain("Tip")
    expect(home).toContain("research menu")
    expect(home).toContain("ctrl+p commands")
  } finally {
    setup.renderer.destroy()
  }
})

test("ctrl+p opens Commands palette with categories and key hints", async () => {
  const setup = await testRender(<App />, { width: 120, height: 36 })
  try {
    await setup.renderOnce()
    setup.mockInput.pressKey("p", { ctrl: true })
    const palette = await frameUntil(setup, (f) => f.includes("Commands"))
    expect(palette).toContain("Session")
    expect(palette).toContain("type to filter")
    await setup.mockInput.typeText("model", 20)
    const filtered = await frameUntil(setup, (f) => f.includes("select model"))
    expect(filtered).toContain("<ctrl+x> m")
  } finally {
    setup.renderer.destroy()
  }
})

test("palette fuzzy filter narrows; enter flows into model dialog; down+enter switches model", async () => {
  const setup = await testRender(<App />, { width: 120, height: 36 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    setup.mockInput.pressKey("p", { ctrl: true })
    await frameUntil(setup, (f) => f.includes("Commands"))
    await setup.mockInput.typeText("selmodel", 15)
    const filtered = await frameUntil(setup, (f) => f.includes("Search selmodel"))
    expect(filtered).toContain("select model")
    expect(filtered).not.toContain("compact context")
    setup.mockInput.pressEnter()
    const models = await frameUntil(setup, (f) => f.includes("Select model"))
    expect(models).toContain("anthropic/claude-sonnet-4.5")
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()
    const picked = await frameUntil(setup, (f) => f.includes("model: anthropic/claude-sonnet-4.5"))
    expect(picked).toContain("Anthropic")
  } finally {
    setup.renderer.destroy()
  }
})

test("leader ctrl+x shows which-key; m opens model dialog", async () => {
  const setup = await testRender(<App />, { width: 120, height: 36 })
  try {
    await setup.renderOnce()
    setup.mockInput.pressKey("x", { ctrl: true })
    const wk = await frameUntil(setup, (f) => f.includes("leader timeout"))
    expect(wk).toContain("select model")
    setup.mockInput.pressKey("m")
    await frameUntil(setup, (f) => f.includes("Select model"))
  } finally {
    setup.renderer.destroy()
  }
})

test("ctrl+r fuzzy history search restores a previous prompt", async () => {
  const setup = await testRender(<App />, { width: 120, height: 36 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText("explain the src folder")
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("▣ advisor"), 8000)
    setup.mockInput.pressKey("r", { ctrl: true })
    const hist = await frameUntil(setup, (f) => f.includes("Prompt history"))
    expect(hist).toContain("explain the src folder")
    await setup.mockInput.typeText("folder", 15)
    const filtered = await frameUntil(setup, (f) => f.includes("Search folder"))
    expect(filtered).toContain("explain the src folder")
    setup.mockInput.pressEnter()
    const back = await frameUntil(setup, (f) => !f.includes("Prompt history"))
    expect(back).toContain("explain the src folder")
  } finally {
    setup.renderer.destroy()
  }
})

test("/theme gruvbox switches and persists", async () => {
  const setup = await testRender(<App />, { width: 120, height: 34 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText("/theme gruvbox")
    setup.mockInput.pressEnter()
    const applied = await frameUntil(setup, (f) => f.includes("theme: gruvbox"))
    expect(applied).toContain("gruvbox")
    const saved = JSON.parse(await Bun.file(STATE).text())
    expect(saved.theme).toBe("gruvbox")
  } finally {
    setup.renderer.destroy()
    if (existsSync(STATE)) rmSync(STATE)
  }
})

test("/effect vignette applies and persists", async () => {
  const setup = await testRender(<App />, { width: 120, height: 34 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText("/effect vignette")
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("post effect: vignette"))
    const saved = JSON.parse(await Bun.file(STATE).text())
    expect(saved.effect).toBe("vignette")
  } finally {
    setup.renderer.destroy()
    if (existsSync(STATE)) rmSync(STATE)
  }
})

test("slash ghost menu completes /verbose", async () => {
  const setup = await testRender(<App />, { width: 120, height: 36 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText("/verb")
    const menu = await frameUntil(setup, (f) => f.includes("/verbose"))
    expect(menu).toContain("toggle tool output")
    setup.mockInput.pressEnter()
    const completed = await frameUntil(setup, (f) => f.includes("/verbose "))
    expect(completed).toContain("/verbose")
  } finally {
    setup.renderer.destroy()
  }
})

test("@ file autocomplete fuzzy-searches the project tree", async () => {
  const setup = await testRender(<App />, { width: 120, height: 36 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await Bun.sleep(2500)
    await setup.mockInput.typeText("@app", 20)
    const menu = await frameUntil(setup, (f) => f.includes("@src/App.tsx"), 15000)
    expect(menu).toContain("file")
    setup.mockInput.pressEnter()
    await Bun.sleep(150)
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("▣ advisor"), 8000)
  } finally {
    setup.renderer.destroy()
  }
})

test("offline chat is honest: it says the LLM backend is unavailable", async () => {
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText("run tests")
    setup.mockInput.pressEnter()
    const thought = await frameUntil(setup, (f) => f.includes("▣ advisor"), 8000)
    expect(thought).toContain("run tests")
    const out = await frameUntil(setup, (f) => f.includes("LLM backend is not available"), 8000)
    expect(out).toMatch(/API_KEY|offline mode/)
  } finally {
    setup.renderer.destroy()
  }
})

test("prompt !echo runs a real shell command and shows output", async () => {
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText("!echo hello-shell")
    setup.mockInput.pressEnter()
    const out = await frameUntil(setup, (f) => f.includes("▣ shell · local"), 6000)
    expect(out).toContain("echo hello-shell")
  } finally {
    setup.renderer.destroy()
  }
})

test("workspaces cycle: dashboard first, explorer shows the tree", async () => {
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    setup.mockInput.pressKey("1")
    const dash = await frameUntil(setup, (f) => f.includes("▮ 1 Dashboard"))
    expect(dash).toContain("▯ 2 Chat")
    expect(dash).toContain("▦ experiments")
    setup.mockInput.pressTab()
    const expl = await frameUntil(setup, (f) => f.includes("▮ 3 Explorer"))
    expect(expl).toContain("ai_scientist")
    setup.mockInput.pressKey("2")
    const home = await toChat(setup)
    expect(home).toContain("Explorer")
    setup.mockInput.pressKey("1")
    await frameUntil(setup, (f) => f.includes("▮ 1 Dashboard"))
    setup.mockInput.pressKey("2")
    await toChat(setup)
    setup.mockInput.pressTab({ shift: true })
    const plan = await frameUntil(setup, (f) => f.includes("Plan ·"))
    expect(plan).toContain("agent: Plan")
  } finally {
    setup.renderer.destroy()
  }
})

test("explorer right pane previews the selected entry", async () => {
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    setup.mockInput.pressKey("3")
    const ex = await frameUntil(setup, (f) => f.includes("▮ 3 Explorer") && f.includes("entries"))
    expect(ex).toContain("ai_scientist")
    expect(ex).toContain("ai_scientist/")
    expect(ex).toContain("README.md")
  } finally {
    setup.renderer.destroy()
  }
})

test("Notes workspace: create note, hang color labels, two-x delete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ais-notes-tui-"))
  process.env.AIS_NOTES_DIR = dir
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    setup.mockInput.pressKey("4")
    const ideasTab = await frameUntil(setup, (f) => f.includes("▮ 4 Notes"))
    expect(ideasTab).toContain("— Detail")
    setup.mockInput.pressKey("t")
    const empty = await frameUntil(setup, (f) => f.includes("no notes yet"))
    expect(empty).toContain("press n to create")
    setup.mockInput.pressKey("n")
    await setup.mockInput.typeText("идея clamp", 20)
    setup.mockInput.pressEnter()
    const created = await frameUntil(setup, (f) => f.includes("1 / 1"))
    expect(created).toContain("идея clamp")
    setup.mockInput.pressKey("l")
    await frameUntil(setup, (f) => f.includes("Note color"))
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("■red"))
    setup.mockInput.pressKey("l")
    await frameUntil(setup, (f) => f.includes("Note color"))
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("■orange"))
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"))
    expect(files.length).toBe(1)
    const raw = readFileSync(join(dir, files[0]), "utf8")
    expect(raw).toContain("label/orange")
    expect(raw).not.toContain("label/red")
    expect(raw).toContain("# идея clamp")
    setup.mockInput.pressKey("x")
    const armed = await frameUntil(setup, (f) => f.includes("x again deletes"))
    expect(armed).toContain("идея clamp")
    setup.mockInput.pressKey("x")
    await frameUntil(setup, (f) => f.includes("no notes yet"))
    expect(readdirSync(dir).filter((f) => f.endsWith(".md")).length).toBe(0)
  } finally {
    setup.renderer.destroy()
    delete process.env.AIS_NOTES_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})

test("notes tab is the ideas browser: list, scores, filter, detail", async () => {
  const setup = await testRender(<App />, { width: 140, height: 40 })
  try {
    await setup.renderOnce()
    await pickProject(setup, "nanoGPT_lite")
    setup.mockInput.pressKey("4")
    const b = await frameUntil(setup, (f) => f.includes("— Detail"))
    expect(b).toContain("Ideas")
    expect(b).toContain("50 / 50 ideas")
    expect(b).toContain("adaptive_block_size")
    expect(b).toContain("Interestingness")

    setup.mockInput.pressKey("down")
    await setup.mockInput.typeText("/layerwise", 15)
    const f = await frameUntil(setup, (f) => f.includes("1 / 50 ideas"))
    expect(f).toContain("layerwise_learning_rates")
    expect(f).not.toContain("adaptive_block_size")
    setup.mockInput.pressEscape()
    await frameUntil(setup, (f) => f.includes("50 / 50 ideas"))
    setup.mockInput.pressKey("t")
    await frameUntil(setup, (f) => f.includes("l color"))
  } finally {
    setup.renderer.destroy()
    if (existsSync(STATE)) rmSync(STATE)
  }
})

test("dashboard tracks the active project; ctrl+x p switches it", async () => {
  if (existsSync(STATE)) rmSync(STATE)
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    const home = await frameUntil(setup, (f) => f.includes("no project"))
    expect(home).toContain("research menu")
    setup.mockInput.pressKey("x", { ctrl: true })
    setup.mockInput.pressKey("p")
    const dlg = await frameUntil(setup, (f) => f.includes("Select project"))
    expect(dlg).toContain("trains small")
    await setup.mockInput.typeText("nanoGPT_lite", 20)
    setup.mockInput.pressEnter()
    const switched = await frameUntil(setup, (f) => f.includes("research ▸ nanoGPT_lite"))
    expect(switched).toContain("project: nanoGPT_lite")
  } finally {
    setup.renderer.destroy()
    if (existsSync(STATE)) rmSync(STATE)
  }
})

test("agents board: delegate runs a real worker (offline it fails honestly), log opens", async () => {
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    setup.mockInput.pressKey("5")
    const board = await frameUntil(setup, (f) => f.includes("⚇ agent board"))
    expect(board).toContain("main agent")
    setup.mockInput.pressKey("d")
    await setup.mockInput.typeText("sanity check", 20)
    setup.mockInput.pressEnter()
    const spawned = await frameUntil(setup, (f) => f.includes("sanity check") && !f.includes("task for the main agent"))
    expect(spawned).toContain("assistant")
    const failed = await frameUntil(setup, (f) => f.includes("sanity check") && f.includes("assistant"), 8000)
    expect(failed).toContain("assistant")
    await frameUntil(setup, (f) => f.includes("failed"), 8000)
    for (let i = 0; i < 24; i++) setup.mockInput.pressArrow("down")
    await Bun.sleep(120)
    setup.mockInput.pressEnter()
    const log = await frameUntil(setup, (f) => f.includes("esc close"), 4000)
    expect(log).toContain("worker #")
    expect(log).toContain("LLM backend unavailable")
    setup.mockInput.pressEscape()
    await frameUntil(setup, (f) => f.includes("⚇ agent board") && !f.includes("esc close"))
  } finally {
    setup.renderer.destroy()
  }
})

test("ctrl+x v toggles verbose with a toast", async () => {
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    setup.mockInput.pressKey("x", { ctrl: true })
    setup.mockInput.pressKey("v")
    const out = await frameUntil(setup, (f) => f.includes("tool output: on"))
    expect(out).toContain("tool output")
  } finally {
    setup.renderer.destroy()
    if (existsSync(STATE)) rmSync(STATE)
  }
})

test("sidebar shows context and sparkline after entering the build chat", async () => {
  const setup = await testRender(<App />, { width: 130, height: 40 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText("hi")
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("▣ advisor"), 8000) // advisor consult on the splash
    setup.mockInput.pressKey("2") // now enter the real build chat (sidebar lives here)
    const out = await frameUntil(setup, (f) => f.includes("Context"), 8000)
    expect(out).toContain("tokens")
    expect(out).toContain("tok/s")
  } finally {
    setup.renderer.destroy()
  }
})

test("/compact answers honestly about context size", async () => {
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText("/compact")
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("Compaction") || f.includes("context is light"))
  } finally {
    setup.renderer.destroy()
  }
})

test("/init writes a real AGENTS.md into the project root", async () => {
  const agents = join(PROJECT_ROOT, "AGENTS.md")
  const had = existsSync(agents)
  const backup = had ? readFileSync(agents, "utf8") : null
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText(had ? "/init force" : "/init")
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("Wrote"), 8000)
    const raw = readFileSync(agents, "utf8")
    expect(raw).toContain("# AGENTS.md")
    expect(raw).toContain("AI-Scientist")
    expect(raw).toContain("templates")
  } finally {
    setup.renderer.destroy()
    if (backup !== null) writeFileSync(agents, backup)
    else if (existsSync(agents) && !had) rmSync(agents)
  }
})

test("tiny terminal shows an honest too-small state", async () => {
  const setup = await testRender(<App />, { width: 48, height: 10 })
  try {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("terminal too small (48×10)")
  } finally {
    setup.renderer.destroy()
  }
})

test("/run validates template before spawning anything", async () => {
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText("/run no_such_template_zzz")
    setup.mockInput.pressEnter()
    const out = await frameUntil(setup, (f) => f.includes("Unknown template"))
    expect(out).toContain("no_such_template_zzz")
  } finally {
    setup.renderer.destroy()
  }
})

test("/improve sets the auto-improve preset (picker + inline args)", async () => {
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    await toChat(setup)
    await setup.mockInput.typeText("/improve 5:2", 10)
    setup.mockInput.pressEnter()
    const set = await frameUntil(setup, (f) => f.includes("auto-improve: on"))
    expect(set).toContain("≥5")
    await setup.mockInput.typeText("/improve nonsense", 10)
    setup.mockInput.pressEnter()
    const bad = await frameUntil(setup, (f) => f.includes("usage: /improve"))
    expect(bad).toContain("usage: /improve")
    await setup.mockInput.typeText("/improve off", 10)
    setup.mockInput.pressEnter()
    await frameUntil(setup, (f) => f.includes("auto-improve: off"))
  } finally {
    setup.renderer.destroy()
    if (existsSync(STATE)) rmSync(STATE)
  }
})

test("Explorer enter suspends TUI, hands TTY to $EDITOR, resumes with file edited", async () => {
  const editor = join(tmpdir(), "ais_handoff_editor.cjs")
  writeFileSync(editor, 'require("fs").appendFileSync(process.argv[2], "\\n[handoff]\\n")\n')
  const probe = "_handoff_probe_84.txt"
  const probeAbs = join(PROJECT_ROOT, probe)
  writeFileSync(probeAbs, "BEFORE\n")
  const prevEditor = process.env.EDITOR
  process.env.EDITOR = `node ${editor}`
  const setup = await testRender(<App />, { width: 120, height: 40 })
  try {
    await setup.renderOnce()
    await Bun.sleep(500)
    setup.mockInput.pressKey("3")
    await frameUntil(setup, (f) => f.includes("⇄") && f.includes("Explorer"))
    setup.mockInput.pressKey("/")
    await Bun.sleep(50)
    await setup.mockInput.typeText("handoffprobe", 20)
    const found = await frameUntil(setup, (f) => f.includes(probe))
    expect(found).toContain("handoff")
    setup.mockInput.pressEnter()
    await Bun.sleep(600)
    for (let i = 0; i < 6; i++) { await setup.renderOnce(); await Bun.sleep(30) }
    const edited = readFileSync(probeAbs, "utf8")
    expect(edited).toContain("[handoff]")
    const resumed = setup.captureCharFrame()
    expect(resumed).toContain("Explorer")
  } finally {
    setup.renderer.destroy()
    if (prevEditor === undefined) delete process.env.EDITOR
    else process.env.EDITOR = prevEditor
    if (existsSync(probeAbs)) rmSync(probeAbs)
    if (existsSync(editor)) rmSync(editor)
  }
})

afterAll(() => {
  if (existsSync(STATE)) rmSync(STATE)
  delete process.env.AISC_TUI_OFFLINE
  for (const d of [tmpAgents, tmpSessions, tmpResults, tmpVault]) rmSync(d, { recursive: true, force: true })
})



