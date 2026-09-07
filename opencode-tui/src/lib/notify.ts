import { spawn } from "node:child_process"

// Best-effort OS notification: PowerShell toast on Windows, notify-send on
// Linux, osascript on macOS. Failure is always silent — the in-app toast and
// terminal bell remain the primary signals.
export function notifyOS(title: string, message: string): void {
  try {
    if (process.platform === "win32") {
      const ps =
        `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;` +
        `$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);` +
        `$x = $t.GetXml();` +
        `$t.GetElementsByTagName('text').Item(0).AppendChild($t.CreateTextNode('${title.replace(/'/g, "''")}')) | Out-Null;` +
        `$t.GetElementsByTagName('text').Item(1).AppendChild($t.CreateTextNode('${message.replace(/'/g, "''").slice(0, 180)}')) | Out-Null;` +
        `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('AI-Scientist').Show([Windows.UI.Notifications.ToastNotification]::new($t))`
      spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {
        stdio: "ignore",
        windowsHide: true,
        detached: true,
      }).unref?.()
    } else if (process.platform === "darwin") {
      const esc = message.replace(/"/g, '\\"')
      spawn("osascript", ["-e", `display notification "${esc}" with title "${title}"`], {
        stdio: "ignore",
        detached: true,
      }).unref?.()
    } else {
      spawn("notify-send", [title, message], { stdio: "ignore", detached: true }).unref?.()
    }
  } catch {}
}
