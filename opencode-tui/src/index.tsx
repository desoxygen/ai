import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "./App.tsx"
import { postProcess, setActiveEffect } from "./lib/fx.ts"
import { applyTheme, loadSettings } from "./theme.ts"

const settings = loadSettings()
applyTheme(settings.theme)
setActiveEffect(settings.effect)

try {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
    postProcessFns: [postProcess],
  })
  createRoot(renderer).render(<App />)
} catch (err) {
  console.error("Не удалось запустить TUI-рендерер:", err)
  process.exit(1)
}
