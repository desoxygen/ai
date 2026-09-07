export interface Inline {
  t: string
  b?: boolean
  i?: boolean
  c?: boolean
  l?: boolean
}

export type BlockKind = "h1" | "h2" | "h3" | "h4" | "blank" | "bullet" | "quote" | "code" | "hr" | "p"

export interface Block {
  kind: BlockKind
  segs: Inline[]
}

export interface Article {
  id: string
  title: string
  subtitle: string
  tags: string[]
  md: string
  src: string
}

function inline(s: string): Inline[] {
  const out: Inline[] = []
  let i = 0
  let cur: Inline = { t: "" }
  const flush = () => {
    if (cur.t) out.push(cur)
    cur = { t: "" }
  }
  while (i < s.length) {
    if (s.startsWith("**", i)) {
      const end = s.indexOf("**", i + 2)
      if (end !== -1) {
        flush()
        out.push({ t: s.slice(i + 2, end), b: true })
        i = end + 2
        continue
      }
    }
    if (s[i] === "*" && i + 1 < s.length && s[i + 1] !== "*") {
      const end = s.indexOf("*", i + 1)
      if (end !== -1) {
        flush()
        out.push({ t: s.slice(i + 1, end), i: true })
        i = end + 1
        continue
      }
    }
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1)
      if (end !== -1) {
        flush()
        out.push({ t: s.slice(i + 1, end), c: true })
        i = end + 1
        continue
      }
    }
    if (s[i] === "[") {
      const m = /\[([^\]]+)\]\(([^)]*)\)/.exec(s.slice(i))
      if (m && m.index === 0) {
        flush()
        out.push({ t: m[1], l: true })
        i += m[0].length
        continue
      }
    }
    cur.t += s[i]
    i++
  }
  flush()
  return out
}

export function parseMarkdown(md: string): Block[] {
  const out: Block[] = []
  let inCode = false
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\s+$/, "")
    if (line.startsWith("```")) {
      inCode = !inCode
      continue
    }
    if (inCode) {
      out.push({ kind: "code", segs: [{ t: line, c: true }] })
      continue
    }
    if (!line.trim()) out.push({ kind: "blank", segs: [] })
    else if (line.startsWith("#### ")) out.push({ kind: "h4", segs: [{ t: line.slice(5), i: true }] })
    else if (line.startsWith("### ")) out.push({ kind: "h3", segs: [{ t: line.slice(4), b: true }] })
    else if (line.startsWith("## ")) out.push({ kind: "h2", segs: [{ t: line.slice(3), b: true }] })
    else if (line.startsWith("# ")) out.push({ kind: "h1", segs: [{ t: line.slice(2), b: true }] })
    else if (line.startsWith("---")) out.push({ kind: "hr", segs: [{ t: "" }] })
    else if (/^\s*[-•]\s/.test(line)) {
      const indent = line.length - line.trimStart().length
      out.push({ kind: "bullet", segs: [{ t: " ".repeat(indent) + "• " }, ...inline(line.trimStart().slice(2))] })
    } else if (line.trimStart().startsWith("> ")) {
      out.push({ kind: "quote", segs: [{ t: "│ " }, ...inline(line.trimStart().slice(2))] })
    } else out.push({ kind: "p", segs: inline(line) })
  }
  return out
}

const vis = (b: Block): number => b.segs.reduce((n, s) => n + s.t.length, 0)

export function wrapBlock(b: Block, width: number): Block[] {
  if (b.kind !== "p" && b.kind !== "bullet" && b.kind !== "quote") return [b]
  const prefixLen = b.kind === "bullet" ? (b.segs[0]?.t.length ?? 0) : b.kind === "quote" ? 2 : 0
  const prefix = b.segs.slice(0, b.kind === "p" ? 0 : 1)
  const rest = b.segs.slice(b.kind === "p" ? 0 : 1)
  const lines: Block[] = []
  let cur: Inline[] = []
  let curLen = prefixLen
  const push = () => {
    lines.push({ kind: b.kind, segs: [...prefix, ...cur] })
    cur = []
    curLen = prefixLen
  }
  for (const seg of rest) {
    const words = seg.t.split(/(\s+)/)
    for (const w of words) {
      if (!w) continue
      if (curLen + w.length > width && curLen > prefixLen) push()
      if (w.trim() || cur.length) cur.push({ ...seg, t: w })
      curLen += w.length
    }
  }
  if (cur.length) push()
  return lines.length ? lines : [{ kind: b.kind, segs: prefix }]
}

export function wrapBlocks(blocks: Block[], width: number): Block[] {
  const out: Block[] = []
  for (const b of blocks) {
    if (vis(b) <= width || b.kind === "code" || b.kind === "hr") {
      out.push(b)
      continue
    }
    out.push(...wrapBlock(b, width))
  }
  return out
}

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { PROJECT_ROOT } from "./aiscientist.ts"

function docFromMd(md: string, fallbackTitle: string, src: string, subtitle: string): Article {
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallbackTitle
  return { id: src, title, subtitle, tags: [], md, src }
}

/** Newest generated paper for a project, if the pipeline produced one. */
export function paperOf(template: string): Article | null {
  try {
    const root = join(PROJECT_ROOT, "results", template)
    if (!existsSync(root)) return null
    const runs = readdirSync(root)
      .filter((r) => existsSync(join(root, r, "paper.md")))
      .sort()
    const last = runs[runs.length - 1]
    if (!last) return null
    const md = readFileSync(join(root, last, "paper.md"), "utf8")
    return docFromMd(md, `${template} · paper`, `results/${template}/${last}`, `generated paper · ${last} · open with /run writeup stage`)
  } catch {
    return null
  }
}

/**
 * The document shown on the Article tab: the project's real paper if one was
 * generated, otherwise its real README. No content is hardcoded — a project
 * with neither has no document (null), and the UI says so honestly.
 */
export function articleFor(template?: string | null): Article | null {
  if (!template) return null
  const paper = paperOf(template)
  if (paper) return paper
  try {
    const p = join(PROJECT_ROOT, "templates", template, "README.md")
    if (!existsSync(p)) return null
    return docFromMd(readFileSync(p, "utf8"), template, `templates/${template}/README.md`, "project README — edit with /editor")
  } catch {
    return null
  }
}

export function articleWordCount(a: Article): number {
  return a.md.split(/\s+/).filter(Boolean).length
}

export function articleSections(a: Article): number {
  return (a.md.match(/^## /gm) ?? []).length
}

export function articleSummary(a: Article): string {
  const quote = a.md.match(/^>\s+(.+)$/m)?.[1]
  const para = a.md
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith(">") && !l.startsWith("```") && !l.startsWith("---"))
  return (quote ?? para ?? "").replace(/[*_`]/g, "").slice(0, 220)
}
