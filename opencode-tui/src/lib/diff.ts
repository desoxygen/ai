// Minimal line-based diff (LCS) tuned for small files — compare run_1.py vs
// run_2.py style experiment snapshots inside the TUI.
export interface DiffLine {
  kind: "same" | "add" | "del"
  text: string
}

export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  // LCS table; guard against absurd inputs to keep the TUI responsive
  if (n * m > 4_000_000) {
    return [
      ...a.map((t): DiffLine => ({ kind: "del", text: t })),
      ...b.map((t): DiffLine => ({ kind: "add", text: t })),
    ]
  }
  const dp: Uint16Array[] = []
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i++] })
    } else {
      out.push({ kind: "add", text: b[j++] })
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++] })
  while (j < m) out.push({ kind: "add", text: b[j++] })
  return out
}

/** Collapse long runs of unchanged lines, keeping `ctx` lines around changes. */
export function contextualDiff(lines: DiffLine[], ctx = 2): DiffLine[] {
  const keep = new Set<number>()
  lines.forEach((l, idx) => {
    if (l.kind !== "same") {
      for (let k = Math.max(0, idx - ctx); k <= Math.min(lines.length - 1, idx + ctx); k++) keep.add(k)
    }
  })
  const out: DiffLine[] = []
  let skipping = false
  lines.forEach((l, idx) => {
    if (keep.has(idx)) {
      if (skipping) {
        out.push({ kind: "same", text: "⋯" })
        skipping = false
      }
      out.push(l)
    } else {
      skipping = true
    }
  })
  return out
}
