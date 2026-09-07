import { expect, test } from "bun:test"
import { fuzzyFilter, fuzzyMatch, highlight } from "./fuzzy.ts"
import { fmtSec } from "../components/ChatLog.tsx"

test("fuzzyMatch: exact word-start match beats mid-word consecutive match", () => {
  const exact = fuzzyMatch("model", "model")
  const buried = fuzzyMatch("model", "xmmodelx")
  expect(exact).not.toBeNull()
  expect(buried).not.toBeNull()
  expect(exact!.score).toBeGreaterThan(buried!.score)
  expect(fuzzyMatch("xyz", "src/App.tsx")).toBeNull()
})

test("fuzzyMatch: empty query matches everything with zero indices", () => {
  const m = fuzzyMatch("", "anything")
  expect(m).not.toBeNull()
  expect(m!.indices.length).toBe(0)
})

test("fuzzyMatch: indices point at matched characters", () => {
  const m = fuzzyMatch("st", "src/smoke.test.tsx")!
  expect("src/smoke.test.tsx"[m.indices[0]]).toBe("s")
  expect("src/smoke.test.tsx"[m.indices[1]]).toBe("t")
})

test("fuzzyFilter sorts by score", () => {
  const items = ["package.json", "src/App.tsx", "apple.md"]
  const r = fuzzyFilter("app", items, (s) => s)
  expect(r.length).toBeGreaterThan(0)
  expect(r[0].item).toBe("apple.md")
  for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score)
})

test("highlight splits text at matched indices", () => {
  const slices = highlight("app", [0, 2])
  expect(slices.map((s) => s.text).join("")).toBe("app")
  expect(slices[0].hit).toBe(true)
  expect(slices[1].hit).toBe(false)
  expect(slices[2].hit).toBe(true)
})

test("fmtSec formats ms/s/min honestly", () => {
  expect(fmtSec(320)).toBe("320ms")
  expect(fmtSec(2450)).toBe("2.5s")
  expect(fmtSec(95_000)).toBe("1m 35s")
})
