"""Central settings for the AI-Scientist control layer.

Loads .env from the project root (no external dependency), exposes guard
limits (loop protection) and resolves the Obsidian vault location.
"""
import os
import sys
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
# AISC_RESULTS_DIR lets tests (and sandboxed runs) redirect all artifacts;
# the TUI mirrors this in opencode-tui/src/lib/aiscientist.ts.
RESULTS_DIR = Path(os.environ.get("AISC_RESULTS_DIR") or (PROJECT_ROOT / "results"))
GUARD_LOG = RESULTS_DIR / "guard_events.jsonl"


def load_dotenv(path=None, override=False):
    """Tiny .env parser. Existing environment variables win unless override=True."""
    path = Path(path) if path else PROJECT_ROOT / ".env"
    if not path.exists():
        return {}
    loaded = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        value = value.strip().strip('"').strip("'")
        loaded[key] = value
        if override or key not in os.environ:
            os.environ[key] = value
    return loaded


load_dotenv()


@dataclass
class GuardLimits:
    """Artificial limits protecting the pipeline from runaway loops."""

    llm_max_tries: int            # bounded retries for backoff on LLM calls
    stage_max_failures: int       # consecutive stage failures before asking the user
    max_repeat_signatures: int    # identical consecutive outputs before asking
    interactive: str              # auto | yes | no
    on_limit: str                 # ask | continue | skip | abort  (non-interactive default)
    extend_by: int                # how many extra attempts "continue" grants
    max_stage_minutes: int        # wall-clock budget per guarded stage (0 = off)


def _guard_limits() -> GuardLimits:
    env = os.environ.get
    return GuardLimits(
        llm_max_tries=int(env("AISC_LLM_MAX_TRIES", "8")),
        stage_max_failures=int(env("AISC_STAGE_MAX_FAILURES", "3")),
        max_repeat_signatures=int(env("AISC_MAX_REPEAT_SIGNATURES", "3")),
        interactive=env("AISC_INTERACTIVE", "auto"),
        on_limit=env("AISC_ON_LIMIT", "ask"),
        extend_by=int(env("AISC_EXTEND_BY", "5")),
        max_stage_minutes=int(env("AISC_MAX_STAGE_MINUTES", "0")),
    )


GUARD = _guard_limits()


def reload_guard():
    """Re-read guard limits from the environment (after .env edits)."""
    global GUARD
    GUARD = _guard_limits()
    return GUARD


def is_interactive() -> bool:
    if GUARD.interactive == "yes":
        return True
    if GUARD.interactive == "no":
        return False
    try:
        return sys.stdin.isatty() and sys.stdout.isatty()
    except Exception:
        return False


def mask_secret(value: str, keep: int = 6) -> str:
    if not value:
        return "(не задан)"
    if len(value) <= keep:
        return "*" * len(value)
    return value[:keep] + "…" + "*" * 8


# ---------------------------------------------------------------------------
# Obsidian vault resolution
# ---------------------------------------------------------------------------

_ON_WINDOWS = sys.platform == "win32"


def _candidate_vaults_from_obsidian_config():
    """Read vault list from the Windows-side Obsidian config.

    Works both on native Windows (C:/Users/...) and under WSL (/mnt/c/Users/...).
    """
    candidates = []
    users_dir = Path("C:/Users") if _ON_WINDOWS else Path("/mnt/c/Users")
    if not users_dir.exists():
        return candidates
    for cfg in users_dir.glob("*/AppData/Roaming/obsidian/obsidian.json"):
        try:
            import json
            data = json.loads(cfg.read_text(encoding="utf-8"))
            for entry in data.get("vaults", {}).values():
                win_path = entry.get("path")
                if not win_path:
                    continue
                native = _win_to_wsl(win_path)
                if native and native.exists():
                    candidates.append((native, bool(entry.get("open"))))
        except Exception:
            continue
    return candidates


def _win_to_wsl(win_path: str):
    """Normalize a Windows path (C:\\...) to a path usable on the current OS.

    On native Windows the path is returned as-is (forward slashes, drive kept).
    On WSL/Linux it is mapped to /mnt/<drive>/... so the Windows file is reachable.
    """
    p = win_path.replace("\\", "/")
    if len(p) >= 2 and p[1] == ":":
        drive = p[0].lower()
        if _ON_WINDOWS:
            return Path(p)
        return Path(f"/mnt/{drive}{p[2:]}")
    return None


def _wsl_to_win(path) -> str:
    """Inverse of _win_to_wsl: return a Windows-style path string.

    On native Windows the path is already Windows-native, return it unchanged.
    On WSL/Linux a /mnt/<drive>/... path is converted back to <DRIVE>:\\....
    """
    p = str(path)
    if _ON_WINDOWS:
        return p
    if p.startswith("/mnt/"):
        parts = p.split("/", 3)
        if len(parts) >= 3:
            drive = parts[2].upper()
            rest = parts[3] if len(parts) > 3 else ""
            return drive + ":\\" + rest.replace("/", "\\")
    return p


def get_vault_path(create=False) -> Path:
    """Resolve the Obsidian vault root.

    OBSIDIAN_VAULT_PATH env is authoritative (used as-is, created on demand);
    otherwise: open vault from Obsidian config → first configured vault →
    (create=True) fail-safe vault in home dir.
    """
    env_path = os.environ.get("OBSIDIAN_VAULT_PATH")
    if env_path:
        p = _win_to_wsl(env_path) if (":" in env_path or "\\" in env_path) else Path(env_path)
        if p:
            return p
    vaults = _candidate_vaults_from_obsidian_config()
    for v, is_open in vaults:
        if is_open:
            return v
    for v, _ in vaults:
        return v
    if create:
        fallback = Path.home() / "ObsidianVault"
        (fallback / ".obsidian").mkdir(parents=True, exist_ok=True)
        return fallback
    raise FileNotFoundError(
        "Obsidian vault not found. Set OBSIDIAN_VAULT_PATH in AI-Scientist/.env"
    )


def obsidian_root(create=True) -> Path:
    """Subfolder of the vault that holds all AI-Scientist notes."""
    sub = os.environ.get("AISC_OBSIDIAN_ROOT", "AI/AI-Scientist")
    root = get_vault_path(create=create) / sub
    if create:
        for d in ("Projects", "Ideas", "Discussions"):
            (root / d).mkdir(parents=True, exist_ok=True)
    return root


def vault_win_path() -> str:
    """Windows-side path of the vault (for 'open in explorer')."""
    return _wsl_to_win(get_vault_path(create=True))


def save_env_value(key: str, value: str):
    """Persist a KEY=VALUE into the project .env (replace or append)."""
    path = PROJECT_ROOT / ".env"
    lines = []
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    replaced = False
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}=") or line.strip().startswith(f"export {key}="):
            lines[i] = f"{key}={value}"
            replaced = True
            break
    if not replaced:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[key] = value
