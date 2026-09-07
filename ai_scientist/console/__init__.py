"""Консоль-лаборатория `aiscientist` (Beta 1).

Пакет для новой консоли в духе msfconsole. Entry point — `ai_scientist.console.cli`;
ядро REPL — `ai_scientist.console.repl`; каталог модулей — `ai_scientist.console.modules`.
"""
import sys

VERSION = "0.1-beta1"
__version__ = VERSION


def ensure_utf8_stdio():
    """Переводит stdout/stderr в UTF-8 там, где это поддерживается.

    В WSL кодировка уже UTF-8 (no-op); на Windows с cp1252-консолью это
    предотвращает UnicodeEncodeError на кириллице/тире. Ошибки заменяются,
    а не роняют процесс.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
