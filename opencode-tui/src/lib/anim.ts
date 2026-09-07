import { scrambleAt } from "./fx.ts"

const SHADES = ["·", "░", "▒", "▓", "█"]

export interface AnimFrame {
  name: string
  lines: string[]
  accent: number[]
}

function helix(w: number, h: number, t: number): string[] {
  const g: string[][] = Array.from({ length: h }, () => Array(w).fill(" "))
  const mid = (h - 1) / 2
  for (let x = 0; x < w; x++) {
    const p = t * 0.22 + x * 0.28
    const strand = (phase: number, flip: boolean) => {
      const y = Math.round(mid + Math.sin(phase) * ((h - 1) / 2))
      const depth = (Math.cos(phase) + 1) / 2
      const ch = SHADES[Math.min(SHADES.length - 1, Math.round(depth * (SHADES.length - 1)))]
      if (y >= 0 && y < h && (g[y][x] === " " || (flip && depth < 0.5))) g[y][x] = ch
    }
    strand(p, false)
    strand(p + Math.PI, true)
  }
  return g.map((r) => r.join(""))
}

function orbits(w: number, h: number, t: number): string[] {
  const g: string[][] = Array.from({ length: h }, () => Array(w).fill(" "))
  const cx = Math.floor(w / 2)
  const cy = Math.floor(h / 2)
  g[cy][cx] = "✦"
  const rings = [
    { rx: Math.min(w / 2 - 2, 26), ry: h / 2 - 1, n: 2, speed: 1 },
    { rx: Math.min(w / 2 - 2, 18), ry: h / 2 - 1, n: 3, speed: -0.7 },
  ]
  for (const r of rings) {
    for (let i = 0; i < r.n; i++) {
      const a = t * 0.09 * r.speed + (i * Math.PI * 2) / r.n
      const x = Math.round(cx + Math.cos(a) * r.rx)
      const y = Math.round(cy + Math.sin(a) * r.ry)
      if (x >= 0 && x < w && y >= 0 && y < h && g[y][x] === " ") g[y][x] = "◦"
    }
  }
  const trailT = t * 0.05
  const tx = Math.round(cx + Math.cos(trailT) * Math.min(w / 2 - 2, 26))
  const ty = Math.round(cy + Math.sin(trailT) * (h / 2 - 1))
  if (tx >= 0 && tx < w && ty >= 0 && ty < h) g[ty][tx] = "●"
  return g.map((r) => r.join(""))
}

function sparkbars(w: number, h: number, t: number): string[] {
  const g: string[][] = Array.from({ length: h }, () => Array(w).fill(" "))
  for (let x = 0; x < w; x += 2) {
    const v = (Math.sin(x * 0.22 + t * 0.12) + Math.sin(x * 0.07 - t * 0.09) + 2) / 4
    const bar = Math.max(1, Math.round(v * h))
    for (let y = h - 1; y >= h - bar; y--) g[y][x] = y === h - bar ? "▴" : "▂"
  }
  return g.map((r) => r.join(""))
}

function scramble(lines: number, t: number): string[] {
  const title = "AI · S C I E N T I S T"
  const sub = "agent orchestration lab"
  const out: string[] = []
  for (let i = 0; i < lines; i++) {
    const text = i === 0 ? title : i === 1 ? sub : ""
    out.push(text ? scrambleAt(text, Math.floor(t) + (i === 0 ? 0 : 4)) : "")
  }
  return out
}

const SCENE_MS = 7000
const FRAME_MS = 90

export const SCENE_NAMES = ["dna helix", "orbits", "spark field", "scramble"]

export function animFrame(nowMs: number, w: number, h: number): AnimFrame {
  const idx = Math.floor(nowMs / SCENE_MS)
  const local = Math.floor((nowMs % SCENE_MS) / FRAME_MS)
  const name = SCENE_NAMES[idx % SCENE_NAMES.length]
  let lines: string[]
  let accent = -1
  switch (name) {
    case "dna helix":
      lines = helix(w, h, local)
      break
    case "orbits":
      lines = orbits(Math.min(w, 78), h, local)
      accent = 0
      break
    case "spark field":
      lines = sparkbars(Math.min(w, 78), h, local)
      break
    default:
      lines = scramble(h, local)
      accent = 0
      break
  }
  while (lines.length < h) lines.push("")
  return { name, lines: lines.slice(0, h), accent: accent >= 0 ? [accent] : [] }
}
