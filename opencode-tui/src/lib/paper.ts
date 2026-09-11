/**
 * Pure view-model for the Paper workspace (docs/PLAN-PAPER-ROLES-TUI.md §T).
 * Derives the article-building state from the same JSON-line event stream the
 * Dashboard reads — writeup section events carry detail={section, phase},
 * review/improve stages carry scores. No fs, no network: everything here is
 * testable with in-memory events.
 */
import type { AisEvent } from "./aiscientist.ts"

export type Phase = "pending" | "draft" | "cite" | "refine" | "final" | "compile" | "done" | "failed"

export interface SectionRow {
  section: string
  phase: Phase
  ts: string
}

/** Canonical writing order of perform_writeup (matches progress() hooks). */
export const PAPER_SECTIONS = [
  "Title & Abstract",
  "Introduction",
  "Background",
  "Method",
  "Experimental Setup",
  "Results",
  "Conclusion",
  "Related Work",
  "Title",
  "Paper",
] as const

const RANK: Record<Phase, number> = { pending: 0, draft: 1, cite: 2, refine: 3, final: 4, compile: 5, done: 6, failed: 6 }

/** Section checklist in canonical order; unknown sections appended after. */
export function paperSectionStates(events: AisEvent[]): SectionRow[] {
  const bySection = new Map<string, SectionRow>()
  const touch = (section: string, phase: Phase, ts: string) => {
    const cur = bySection.get(section)
    if (!cur || RANK[phase] > RANK[cur.phase] || (RANK[phase] === RANK[cur.phase] && ts >= cur.ts)) {
      bySection.set(section, { section, phase, ts })
    }
  }
  for (const e of events) {
    if (e.stage !== "writeup") continue
    if (e.status === "log" && e.detail?.section) {
      const p = (e.detail.phase ?? "draft") as Phase
      touch(e.detail.section, RANK[p] !== undefined ? p : "draft", e.ts)
    } else if (e.status === "done") {
      for (const s of bySection.keys()) touch(s, "done", e.ts)
      touch("Paper", "done", e.ts)
    } else if (e.status === "fail") {
      for (const [s, row] of bySection) if (row.phase !== "done") touch(s, "failed", e.ts)
    }
  }
  const rows: SectionRow[] = []
  for (const s of PAPER_SECTIONS) rows.push(bySection.get(s) ?? { section: s, phase: "pending", ts: "" })
  for (const [s, r] of bySection) if (!PAPER_SECTIONS.includes(s as (typeof PAPER_SECTIONS)[number])) rows.push(r)
  return rows
}

export interface PaperProgress {
  folder: string
  writeup: "pending" | "running" | "done" | "failed"
  review: "pending" | "running" | "done" | "failed"
  improve: "running" | "done" | "failed" | null
  score: number | null
  beforeAfter: string
  models: { plan: string; code: string; review: string }
  idea: string
}

/** Stage summary for the right rail. */
export function paperProgress(events: AisEvent[]): PaperProgress {
  const p: PaperProgress = {
    folder: "", writeup: "pending", review: "pending", improve: null,
    score: null, beforeAfter: "", models: { plan: "", code: "", review: "" }, idea: "",
  }
  for (const e of events) {
    if (e.stage === "writeup") {
      p.folder = e.detail?.folder ?? p.folder
      p.idea = e.idea_id || p.idea
      p.models.plan = e.model || p.models.plan
      p.writeup = e.status === "started" ? "running" : e.status === "done" ? "done" : e.status === "fail" ? "failed" : p.writeup
    } else if (e.stage === "review") {
      p.review = e.status === "started" ? "running" : e.status === "done" ? "done" : e.status === "fail" ? "failed" : p.review
      const m = /score=([\d.]+)/.exec(e.message ?? "")
      if (m) p.score = Number(m[1])
    } else if (e.stage === "improve") {
      p.improve = e.status === "started" || e.status === "log" ? "running" : e.status === "done" ? "done" : e.status === "fail" ? "failed" : p.improve
      if (e.detail && "before" in e.detail) {
        p.beforeAfter = `${e.detail.before ?? "?"}/10 -> ${e.detail.after ?? "?"}/10`
      }
    } else if (e.stage === "system" && /resume folder/.test(e.message ?? "")) {
      p.folder = e.detail?.folder ?? e.message.split(":").slice(1).join(":").trim()
    }
  }
  return p
}

/** Latest paper job (module writeup/paper); falls back to the newest job. */
export function latestPaperJob<T extends { module?: string; id: number; status: string }>(jobs: T[]): T | undefined {
  const papers = jobs.filter((j) => (j.module ?? "").startsWith("writeup/paper"))
  const pool = papers.length ? papers : jobs
  return pool.length ? pool[pool.length - 1] : undefined
}

/** PDF page count probe — pure text, so it is testable without pdfjs. */
export function describePdf(exists: boolean, folder: string, idea: string): string {
  if (!folder || !idea) return "PDF: unknown run folder yet"
  return exists ? `PDF: ${folder}/${idea}.pdf` : "PDF: not compiled yet"
}
