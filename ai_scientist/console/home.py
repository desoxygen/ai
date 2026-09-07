"""Домашний экран консоли в духе neofetch.

Рисует сводку: слева компактный ASCII-арт лаборатории, справа ключ:значение,
ниже — живые блоки исследования (IDEA / HAVE / HYPOTHESIS / CHECK / NOW / PAPERS).

Не State Manager и не база: данные читаются из md-файлов в vault/корне опыта,
статус — из существующих job/events. Нет фреймворка, только ANSI-текст.
"""
import os.path as osp
import sys

from ai_scientist.console import VERSION

# 8/16 ANSI-цвета.
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
CYAN = "\033[36m"
GREEN = "\033[32m"
WHITE = "\033[37m"

LOGO = [
    "  ╭──────────╮",
    "  │  AI·SCI  │",
    "  │          │",
    "  │  ······  │",
    "  │  ······  │",
    "  ╰──────────╯",
]

_ART_WIDTH = max(len(l) for l in LOGO)


def shorten(path, maxlen=24):
    p = str(path).replace("\\", "/")
    home = osp.expanduser("~").replace("\\", "/")
    if p.startswith(home):
        p = "~" + p[len(home):]
    if len(p) <= maxlen:
        return p
    head, tail = p.rsplit("/", 1)
    return head[:maxlen - len(tail) - 2] + "…/" + tail


def find_file(name, roots):
    for root in roots:
        p = osp.join(root, name)
        if osp.isfile(p):
            return p
    return None


def read_block(name, roots, max_lines=1, max_len=100):
    """Читает md-блок. Возвращает список строк (до max_lines) или пустой список."""
    p = find_file(name, roots)
    if p is None:
        return []
    try:
        text = open(p, encoding="utf-8").read().strip()
    except Exception:
        return []
    if not text:
        return []
    return [l.strip()[:max_len] for l in text.splitlines() if l.strip()][:max_lines]


def _row(key, value, color):
    if color:
        return f"{CYAN}{key.ljust(8)}:{RESET} {WHITE}{value}{RESET}"
    return f"{key.ljust(8)}: {value}"


def _block(name, lines, color):
    out = []
    pad = " " * 11
    first = lines[0] if lines else "—"
    head = f"  {GREEN}{name.ljust(11)}{RESET} {WHITE}{first}{RESET}" if color \
        else f"  {name.ljust(11)} {first}"
    out.append(head)
    for extra in (lines[1:] if lines else []):
        out.append(f"{pad} {WHITE}{extra}{RESET}" if color else f"{pad} {extra}")
    return out


def render(ctx):
    color = ctx.get("color", False)
    width = ctx.get("width", 80)
    show_art = width >= 70

    title = f"aiscientist  {ctx.get('version', VERSION)}"
    info = [
        ("Host", ctx.get("host", "?")),
        ("Model", ctx.get("model", "—")),
        ("Workdir", shorten(ctx.get("workdir", ""))),
        ("Job", ctx.get("job", "idle")),
        ("Editor", ctx.get("editor", "—")),
        ("Shell", ctx.get("shell", "—")),
    ]

    lines = []
    if show_art:
        n = max(len(LOGO), len(info) + 1)
        for i in range(n):
            left = LOGO[i] if i < len(LOGO) else " " * _ART_WIDTH
            if color:
                left = f"{CYAN}{left}{RESET}"
            if i == 0:
                right = f"{BOLD}{CYAN}{title}{RESET}" if color else title
            else:
                idx = i - 1
                right = _row(info[idx][0], info[idx][1], color) if idx < len(info) else ""
            lines.append(f"{left}   {right}".rstrip())
    else:
        lines.append(f"{BOLD}{CYAN}{title}{RESET}" if color else title)
        for k, v in info:
            lines.append(_row(k, v, color))

    lines.append("")

    blocks = ctx.get("blocks", {})
    for name, lines_in in (
        ("IDEA", blocks.get("idea")),
        ("HAVE", blocks.get("have")),
        ("HYPOTHESIS", blocks.get("hypothesis")),
        ("CHECK", [ctx.get("check") or "not tested"]),
        ("NOW", [ctx.get("now") or "—"]),
        ("PAPERS", blocks.get("papers")),
    ):
        lines.extend(_block(name, lines_in or [], color))

    lines.append("")
    hint = "  [r] run  [e] edit  [!] shell  [j] jobs  [?] help"
    lines.append(f"{DIM}{hint}{RESET}" if color else hint)
    return "\n".join(lines)


def is_color():
    try:
        return sys.stdout.isatty()
    except Exception:
        return False
