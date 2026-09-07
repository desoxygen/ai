import { join } from "node:path"
import { readFileSync, writeFileSync } from "node:fs"

export interface ThemeTokens {
  name: string
  bg: string
  panel: string
  element: string
  border: string
  borderSubtle: string
  borderActive: string
  selected: string
  selectedText: string
  primary: string
  secondary: string
  accent: string
  accentDim: string
  text: string
  faint: string
  dim: string
  tool: string
  ok: string
  warn: string
  err: string
  info: string
  black: string
}

type Palette = Partial<Record<keyof ThemeTokens, string>>

function hexToRgb(c: string): [number, number, number] {
  const h = c.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const to = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0")
  return `#${to(r1, r2)}${to(g1, g2)}${to(b1, b2)}`
}

// The default `opencode` theme: exact colors from
// packages/opencode/src/cli/cmd/tui/context/theme/opencode.json (dark variant).
export const PALETTES: Record<string, Palette> = {
  opencode: {
    bg: "#0a0a0a",
    panel: "#141414",
    element: "#1e1e1e",
    borderSubtle: "#3c3c3c",
    border: "#484848",
    borderActive: "#606060",
    selected: "#282828",
    primary: "#fab283",
    secondary: "#5c9cf5",
    accent: "#9d7cd8",
    text: "#eeeeee",
    faint: "#808080",
    dim: "#606060",
    tool: "#9d7cd8",
    ok: "#7fd88f",
    warn: "#f5a742",
    err: "#e06c75",
    info: "#56b6c2",
    black: "#000000",
  },
  tokyonight: {
    bg: "#1a1b26",
    panel: "#16161e",
    border: "#292e42",
    selected: "#292e42",
    primary: "#7aa2f7",
    secondary: "#bb9af7",
    text: "#c0caf5",
    faint: "#a9b1d6",
    dim: "#565f89",
    tool: "#bb9af7",
    ok: "#9ece6a",
    warn: "#e0af68",
    err: "#f7768e",
    black: "#1a1b26",
  },
  catppuccin: {
    bg: "#1e1e2e",
    panel: "#181825",
    border: "#313244",
    selected: "#313244",
    primary: "#cba6f7",
    secondary: "#f5c2e7",
    text: "#cdd6f4",
    faint: "#bac2de",
    dim: "#6c7086",
    tool: "#89b4fa",
    ok: "#a6e3a1",
    warn: "#f9e2af",
    err: "#f38ba8",
    black: "#1e1e2e",
  },
  gruvbox: {
    bg: "#1d2021",
    panel: "#282828",
    border: "#3c3836",
    selected: "#3c3836",
    primary: "#d8a657",
    secondary: "#83a598",
    text: "#ebdbb2",
    faint: "#a89984",
    dim: "#665c54",
    tool: "#d3869b",
    ok: "#b8bb26",
    warn: "#fe8019",
    err: "#fb4934",
    black: "#1d2021",
  },
  dracula: {
    bg: "#282a36",
    panel: "#21222c",
    border: "#44475a",
    selected: "#44475a",
    primary: "#bd93f9",
    secondary: "#ff79c6",
    text: "#f8f8f2",
    faint: "#bfc7db",
    dim: "#6272a4",
    tool: "#8be9fd",
    ok: "#50fa7b",
    warn: "#f1fa8c",
    err: "#ff5555",
    black: "#282a36",
  },
  nord: {
    bg: "#2e3440",
    panel: "#272c36",
    border: "#3b4252",
    selected: "#434c5e",
    primary: "#88c0d0",
    secondary: "#b48ead",
    text: "#eceff4",
    faint: "#d8dee9",
    dim: "#4c566a",
    tool: "#81a1c1",
    ok: "#a3be8c",
    warn: "#ebcb8b",
    err: "#bf616a",
    black: "#2e3440",
  },
  solarized: {
    bg: "#002b36",
    panel: "#073642",
    border: "#0e4553",
    selected: "#0e4553",
    primary: "#268bd2",
    secondary: "#6c71c4",
    text: "#eee8d5",
    faint: "#93a1a1",
    dim: "#586e75",
    tool: "#2aa198",
    ok: "#859900",
    warn: "#b58900",
    err: "#dc322f",
    black: "#002b36",
  },
}

export const THEME_NAMES = Object.keys(PALETTES)

export function isTheme(name: string): name is string {
  return name in PALETTES
}

export function themeOf(name: string): ThemeTokens {
  const p = PALETTES[name] ?? PALETTES.opencode
  const bg = p.bg ?? "#0a0a0a"
  const panel = p.panel ?? bg
  const border = p.border ?? mix(panel, p.text ?? "#eeeeee", 0.28)
  const text = p.text ?? "#eeeeee"
  const primary = p.primary ?? "#fab283"
  return {
    name,
    bg,
    panel,
    element: p.element ?? mix(panel, text, 0.05),
    border,
    borderSubtle: p.borderSubtle ?? mix(bg, border, 0.6),
    borderActive: p.borderActive ?? mix(border, text, 0.25),
    selected: p.selected ?? mix(panel, primary, 0.18),
    selectedText: p.selectedText ?? text,
    primary,
    secondary: p.secondary ?? primary,
    accent: p.accent ?? primary,
    accentDim: p.accentDim ?? p.secondary ?? primary,
    text,
    faint: p.faint ?? mix(text, bg, 0.45),
    dim: p.dim ?? mix(text, bg, 0.6),
    tool: p.tool ?? p.accent ?? primary,
    ok: p.ok ?? "#7fd88f",
    warn: p.warn ?? "#f5a742",
    err: p.err ?? "#e06c75",
    info: p.info ?? p.secondary ?? primary,
    black: p.black ?? "#000000",
  }
}

export const C: ThemeTokens = themeOf("opencode")

export function applyTheme(name: string): ThemeTokens {
  Object.assign(C, themeOf(name))
  return C
}

const STATE_PATH = join(import.meta.dir, "..", "state.json")

export interface AppSettings {
  theme: string
  animations: boolean
  effect: string
  verbose: boolean
  project: string
  model: string
  router: string
}

export const DEFAULT_SETTINGS: AppSettings = { theme: "opencode", animations: true, effect: "none", verbose: false, project: "", model: "", router: "openrouter" }

export const settings: AppSettings = { ...DEFAULT_SETTINGS }

export function resetSettings(): void {
  Object.assign(settings, DEFAULT_SETTINGS)
  applyTheme("opencode")
}

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Partial<AppSettings>
    if (typeof raw.theme === "string" && isTheme(raw.theme)) settings.theme = raw.theme
    if (typeof raw.animations === "boolean") settings.animations = raw.animations
    if (typeof raw.effect === "string") settings.effect = raw.effect
    if (typeof raw.verbose === "boolean") settings.verbose = raw.verbose
    if (typeof raw.project === "string") settings.project = raw.project
    if (typeof raw.model === "string") settings.model = raw.model
    if (typeof raw.router === "string") settings.router = raw.router
  } catch {}
  return settings
}

export function patchSettings(p: Partial<AppSettings>): void {
  Object.assign(settings, p)
  try {
    writeFileSync(STATE_PATH, JSON.stringify(settings, null, 2))
  } catch {}
}
