import { spawn } from "node:child_process"

const write = (s: string) => {
  try {
    process.stdout.write(s)
  } catch {}
}

export function setTitle(title: string): void {
  write(`\x1b]0;${title}\x07`)
}

export function bell(): void {
  write("\x07")
}

export function copyToClipboard(text: string): void {
  // OSC 52 works in Windows Terminal, kitty, alacritty, tmux — but not in
  // classic conhost or many emulators, where it silently does nothing.
  const b64 = Buffer.from(text, "utf8").toString("base64")
  write(`\x1b]52;c;${b64}\x07`)
  if (process.platform === "win32") {
    try {
      const clip = spawn("clip", [], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true })
      clip.stdin?.end(text, "utf8")
    } catch {}
  }
}
