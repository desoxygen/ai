export interface Cmd {
  id: string
  title: string
  category: string
  key?: string
}

export const LEADER_KEYS: { key: string; cmd: string }[] = [
  { key: "a", cmd: "agents" },
  { key: "b", cmd: "sidebar" },
  { key: "c", cmd: "compact" },
  { key: "d", cmd: "details" },
  { key: "e", cmd: "editor" },
  { key: "g", cmd: "timeline" },
  { key: "h", cmd: "tips" },
  { key: "l", cmd: "sessions" },
  { key: "m", cmd: "models" },
  { key: "n", cmd: "new" },
  { key: "o", cmd: "notes" },
  { key: "p", cmd: "projects" },
  { key: "w", cmd: "agentboard" },
  { key: "q", cmd: "quit" },
  { key: "r", cmd: "redo" },
  { key: "s", cmd: "status" },
  { key: "t", cmd: "themes" },
  { key: "u", cmd: "undo" },
  { key: "v", cmd: "verbose" },
  { key: "x", cmd: "export" },
  { key: "y", cmd: "copy" },
]

export const COMMANDS: Cmd[] = [
  { id: "new", title: "new session", category: "Session", key: "<ctrl+x> n" },
  { id: "sessions", title: "switch session", category: "Session", key: "<ctrl+x> l" },
  { id: "compact", title: "compact context", category: "Session", key: "<ctrl+x> c" },
  { id: "undo", title: "undo last message", category: "Session", key: "<ctrl+x> u" },
  { id: "redo", title: "redo message", category: "Session", key: "<ctrl+x> r" },
  { id: "copy", title: "copy last assistant message", category: "Session", key: "<ctrl+x> y" },
  { id: "export", title: "export session to markdown", category: "Session", key: "<ctrl+x> x" },
  { id: "timeline", title: "show session timeline", category: "Session", key: "<ctrl+x> g" },
  { id: "agents", title: "select agent", category: "Agent", key: "<ctrl+x> a" },
  { id: "dashboard", title: "go to Dashboard", category: "View", key: "1 · tab" },
  { id: "chat", title: "go to Chat", category: "View", key: "2 · tab" },
  { id: "explorer", title: "go to Explorer", category: "View", key: "3 · tab" },
  { id: "notes", title: "go to Notes (obsidian)", category: "View", key: "4 · <ctrl+x> o" },
  { id: "agentboard", title: "go to Agents board", category: "View", key: "5 · <ctrl+x> w" },
  { id: "article", title: "read the project's real document (paper.md / README.md)", category: "View", key: "6 · a on Dashboard" },
  { id: "delegate", title: "delegate a task to the main agent", category: "Session", key: "/delegate <task>" },
  { id: "jobs", title: "experiments (jump to job)", category: "View", key: "/jobs" },
  { id: "projects", title: "switch research project", category: "View", key: "<ctrl+x> p · /project" },
  { id: "newproject", title: "new research project (wizard)", category: "View", key: "/new-project · n on menu" },
  { id: "routers", title: "switch LLM router (OpenRouter, Anthropic, …)", category: "Provider", key: "/routers" },
  { id: "run", title: "start AI-Scientist run", category: "Session", key: "/run <template>" },
  { id: "improve", title: "auto-improve papers after a weak review", category: "Research", key: "/improve" },
  { id: "skeleton", title: "generate an AI skeleton (experiment.py + plot.py + baseline)", category: "Research", key: "/skeleton <project>" },
  { id: "models", title: "select model", category: "Provider", key: "<ctrl+x> m" },
  { id: "themes", title: "select theme", category: "Provider", key: "<ctrl+x> t" },
  { id: "variants", title: "cycle model variant", category: "Provider", key: "ctrl+t" },
  { id: "status", title: "show status", category: "Provider", key: "<ctrl+x> s" },
  { id: "history", title: "search prompt history", category: "View", key: "ctrl+r" },
  { id: "verbose", title: "toggle tool output", category: "View", key: "<ctrl+x> v" },
  { id: "sidebar", title: "toggle sidebar", category: "View", key: "<ctrl+x> b" },
  { id: "tips", title: "toggle tips", category: "View", key: "<ctrl+x> h" },
  { id: "details", title: "toggle message details", category: "View", key: "<ctrl+x> d" },
  { id: "effect", title: "fullscreen post effect", category: "Visuals", key: "/effect" },
  { id: "animations", title: "toggle animations", category: "Visuals", key: "/animations" },
  { id: "editor", title: "open external editor", category: "System", key: "<ctrl+x> e" },
  { id: "help", title: "show help", category: "System", key: "/help" },
  { id: "quit", title: "quit", category: "System", key: "<ctrl+x> q" },
]

export function cmdTitle(id: string): string {
  return COMMANDS.find((c) => c.id === id)?.title ?? id
}
