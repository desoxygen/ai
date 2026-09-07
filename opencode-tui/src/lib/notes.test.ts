import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNote, deleteNote, listNotes, notesDir, parseNote, sanitizeName, setLabels, toggleLabel } from "./notes.ts"

const dir = mkdtempSync(join(tmpdir(), "ais-notes-"))
process.env.AIS_NOTES_DIR = dir

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.AIS_NOTES_DIR
})

test("notesDir uses AIS_NOTES_DIR override", () => {
  expect(notesDir()).toBe(dir)
})

test("sanitizeName strips unsafe chars", () => {
  expect(sanitizeName('a/b\\c:d*e?f"g<h>i#j^k[l]m')).toBe("a_b_c_d_e_f_g_h_i_j_k_l_m")
  expect(sanitizeName("   ")).toBe("untitled")
})

test("createNote writes obsidian-compatible frontmatter", () => {
  const n = createNote("Clamp idea")
  expect(n.title).toBe("Clamp idea")
  const raw = readFileSync(n.path, "utf8")
  expect(raw.startsWith("---\n")).toBe(true)
  expect(raw).toContain("  - note")
  expect(raw).toContain("created:")
  expect(raw).toContain("# Clamp idea")
})

test("duplicate titles get -deduped filenames", () => {
  const a = createNote("Dup note")
  const b = createNote("Dup note")
  expect(a.path).not.toBe(b.path)
  expect(b.name).toBe("Dup note 2")
})

test("labels roundtrip as label/<color> tags and preserve other fields", () => {
  const n = createNote("Tagged note")
  setLabels(n.path, ["red", "green"])
  let parsed = parseNote(n.path)
  expect(parsed.labels).toEqual(["red", "green"])
  const raw = readFileSync(n.path, "utf8")
  expect(raw).toContain("  - label/red")
  expect(raw).toContain("  - label/green")
  expect(raw).toContain("created:")
  expect(raw).toContain("# Tagged note")
  parsed = toggleLabel(n.path, "red")
  expect(parsed.labels).toEqual(["green"])
  parsed = toggleLabel(n.path, "red")
  expect(parsed.labels).toEqual(["green", "red"])
})

test("setLabels on a file without frontmatter prepends it and keeps body", () => {
  const path = join(dir, "legacy.md")
  writeFileSync(path, "# Legacy\n\nplain body\n", "utf8")
  setLabels(path, ["blue"])
  const parsed = parseNote(path)
  expect(parsed.labels).toEqual(["blue"])
  expect(parsed.title).toBe("Legacy")
  expect(parsed.preview).toContain("plain body")
})

test("listNotes returns md files sorted by mtime desc; deleteNote removes", async () => {
  const first = createNote("First in time")
  await Bun.sleep(30)
  const second = createNote("Second in time")
  const all = listNotes()
  expect(all.length).toBeGreaterThanOrEqual(2)
  expect(all[0].path).toBe(second.path)
  expect(all.findIndex((n) => n.path === first.path)).toBeGreaterThan(all.findIndex((n) => n.path === second.path))
  deleteNote(first.path)
  expect(listNotes().some((n) => n.path === first.path)).toBe(false)
})
