import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PROJECT_ROOT } from "./aiscientist.ts"

export interface NewProjectInput {
  name: string
  description: string
  idea: string
  system?: string
}

export interface NewProjectResult {
  ok: boolean
  error?: string
  path?: string
  files: string[]
  missing: string[]
}

const DEFAULT_SYSTEM =
  "You are an ambitious AI PhD student who is looking to publish a paper that will contribute significantly to the field."

export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
}

export function validateName(name: string): string | null {
  if (!name) return "name is required"
  if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(name)) return "use lowercase latin: letters, digits, _ or - (2-48 chars)"
  if (existsSync(join(PROJECT_ROOT, "templates", name))) return `project «${name}» already exists — open it from the projects menu (p)`
  return null
}

function ideaRecord(name: string, idea: string): Record<string, unknown> {
  const firstLine = idea.split("\n")[0].trim()
  return {
    Name: slugify(firstLine).slice(0, 40) || `${name}_seed_1`,
    Title: firstLine.slice(0, 160),
    Experiment: idea.trim().slice(0, 1200),
    Interestingness: 6,
    Feasibility: 6,
    Novelty: 5,
  }
}

export function createProject(input: NewProjectInput): NewProjectResult {
  const err = validateName(input.name)
  if (err) return { ok: false, error: err, files: [], missing: [] }
  const dir = join(PROJECT_ROOT, "templates", input.name)
  mkdirSync(dir, { recursive: true })
  const files: string[] = []

  writeFileSync(
    join(dir, "prompt.json"),
    JSON.stringify({ system: input.system?.trim() || DEFAULT_SYSTEM, task_description: input.description.trim() }, null, 2) + "\n",
  )
  files.push("prompt.json")

  writeFileSync(join(dir, "seed_ideas.json"), JSON.stringify([ideaRecord(input.name, input.idea)], null, 2) + "\n")
  files.push("seed_ideas.json")

  const readme =
    `# ${input.name}\n\n` +
    `Research project created from the AI-Scientist TUI on ${new Date().toISOString().slice(0, 10)}.\n\n` +
    `## Task\n\n${input.description.trim()}\n\n` +
    `## Seed idea\n\n${input.idea.trim()}\n\n` +
    `## Before the first full run\n\n` +
    `The ideas/novelty/writeup/review stages work out of the box. To run experiments add:\n\n` +
    `- \`experiment.py\` — trains the baseline and writes JSON results to stdout\n` +
    `- \`plot.py\` — turns experiment output into figures for the writeup\n\n` +
    `Copy an \`experiment.py\`/\`plot.py\` skeleton from any sibling template under \`templates/\` (press P in the menu to browse them).\n\n` +
    `Start: \`/run ${input.name}\` in the TUI (Dashboard follows every stage).\n`
  writeFileSync(join(dir, "README.md"), readme)
  files.push("README.md")

  const missing = ["experiment.py", "plot.py"].filter((f) => !existsSync(join(dir, f)))
  return { ok: true, path: dir, files, missing }
}

export function projectReadme(name: string): string | null {
  try {
    return readFileSync(join(PROJECT_ROOT, "templates", name, "README.md"), "utf8")
  } catch {
    return null
  }
}
