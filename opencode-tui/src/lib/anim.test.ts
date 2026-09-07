import { expect, test } from "bun:test"
import { animFrame, SCENE_NAMES } from "./anim.ts"

test("animFrame returns the requested height for every scene", () => {
  for (let s = 0; s < SCENE_NAMES.length; s++) {
    const f = animFrame(s * 7000 + 1200, 60, 5)
    expect(f.lines.length).toBe(5)
    expect(SCENE_NAMES).toContain(f.name)
  }
})

test("scene rotates every 7 seconds", () => {
  expect(animFrame(0, 60, 5).name).toBe(SCENE_NAMES[0])
  expect(animFrame(7000, 60, 5).name).toBe(SCENE_NAMES[1])
  expect(animFrame(28000, 60, 5).name).toBe(SCENE_NAMES[0])
})

test("frames evolve with time but keep the width contract", () => {
  const a = animFrame(100, 58, 4).lines
  const b = animFrame(3400, 58, 4).lines
  expect(a).not.toEqual(b)
  for (const ln of [...a, ...b]) expect(ln.length).toBeLessThanOrEqual(58)
})

test("scramble scene produces non-empty text lines", () => {
  const f = animFrame(21000 + 6000, 50, 4)
  expect(f.name).toBe("scramble")
  expect(f.lines[0].length).toBeGreaterThan(0)
  expect(f.accent).toContain(0)
})
