import {
  CloudsEffect,
  CRTRollingBarEffect,
  DistortionEffect,
  FlamesEffect,
  RainbowTextEffect,
  VignetteEffect,
  applyAsciiArt,
  applyScanlines,
  type OptimizedBuffer,
} from "@opentui/core"

export function mixHex(a: string, b: string, t: number): string {
  const hex = (s: string) => {
    const h = s.replace("#", "")
    const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
    return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]
  }
  const A = hex(a)
  const B = hex(b)
  const c = (i: number) => Math.round(A[i] + (B[i] - A[i]) * Math.min(1, Math.max(0, t)))
  const x = (n: number) => n.toString(16).padStart(2, "0")
  return `#${x(c(0))}${x(c(1))}${x(c(2))}`
}

export const outQuad = (t: number): number => 1 - (1 - t) * (1 - t)

const SCRAMBLE_POOL = "\u259A\u259E\u2588\u2593\u2592\u2591#%&@$<>/\\{}[]=+*\u00D7\u2261\u2206\u03A9\u03BB\u00A7"

export function scrambleAt(text: string, frame: number): string {
  const cycle = frame % 14
  return text
    .split("")
    .map((ch, i) => {
      if (ch === " ") return ch
      const settleAt = i * 2 + ((i * 7919) % 4)
      if (cycle >= settleAt + 8) return ch
      return SCRAMBLE_POOL[(cycle * 31 + i * 97) % SCRAMBLE_POOL.length]
    })
    .join("")
}

export const GERUNDS = [
  "Reticulating splines",
  "Unfolding the latent tapestry",
  "Distilling context",
  "Noodling",
  "Pondering softly",
  "Synapsing",
  "Flamb\u00E9ing tokens",
  "Dividing by zero",
  "Teaching the bits to dance",
  "Consulting the oracle",
  "Sharpening pencils",
  "Compiling vibes",
  "Counting electrons",
  "Warming the GPUs",
  "Herding gradients",
  "Turning coffee into code",
  "Aligning moons",
  "Cogitating",
]

export function pickGerund(): string {
  return GERUNDS[Math.floor(Math.random() * GERUNDS.length)]
}

type EffectFn = (buffer: OptimizedBuffer, deltaTime: number) => void

const EFFECT_BUILDERS: Record<string, () => EffectFn> = {
  glitch: () => {
    const e = new DistortionEffect()
    return (b, d) => e.apply(b, d)
  },
  vignette: () => {
    const e = new VignetteEffect(0.6)
    return (b) => e.apply(b)
  },
  clouds: () => {
    const e = new CloudsEffect(0.02, 0.6, 0.5, 0.3)
    return (b, d) => e.apply(b, d)
  },
  flames: () => {
    const e = new FlamesEffect(0.05, 0.9, 0.5)
    return (b, d) => e.apply(b, d)
  },
  crt: () => {
    const e = new CRTRollingBarEffect(0.12, 5, 0.4)
    return (b, d) => e.apply(b, d)
  },
  rainbow: () => {
    const e = new RainbowTextEffect(0.8, 0.7, 0.9)
    return (b, d) => e.apply(b, d)
  },
  scanlines: () => (b) => applyScanlines(b, 0.35, 2),
  ascii: () => (b) => applyAsciiArt(b),
}

export const EFFECT_NAMES = ["none", ...Object.keys(EFFECT_BUILDERS)]

let activeEffect = "none"
let activeFn: EffectFn | null = null

export function setActiveEffect(name: string): void {
  activeEffect = name in EFFECT_BUILDERS ? name : "none"
  activeFn = activeEffect === "none" ? null : EFFECT_BUILDERS[activeEffect]()
}

export function getActiveEffect(): string {
  return activeEffect
}

export function postProcess(buffer: OptimizedBuffer, deltaTime: number): void {
  if (!activeFn) return
  try {
    activeFn(buffer, deltaTime)
  } catch {
    activeFn = null
    activeEffect = "none"
  }
}
