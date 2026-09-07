"""Core REPL for `aiscientist` — msfconsole-style interactive console.

Commands: help, banner/home/fetch/status, search, use, back, show, set, unset,
run, jobs, sessions, logs, stop, loot, results, edit, shell, exit, lang.
Keys: r (run), e (edit idea.md), ! (shell), j (jobs), ? (help), 1..6 (.md).

Home screen (neofetch-style) drawn at start, on `banner`/`home`/`fetch`/
`status` and on Enter with empty line.

Rules:
  * `use <module>` does NOT start pipeline — only selects module and prepares options;
  * unknown command — error message, no crash;
  * output via rich (if available), else print.
"""
import json
import os
import os.path as osp
import shutil
import subprocess
import sys
import threading
from pathlib import Path

from ai_scientist import settings
from ai_scientist.console import VERSION, ensure_utf8_stdio
from ai_scientist.console.config import load_defaults
from ai_scientist.console.events import emit_factory, read_events
from ai_scientist.console.i18n import get as _t, set_language, current_language
from ai_scientist.console.jobs import JobRegistry
from ai_scientist.console.registry import ModuleRegistry
from ai_scientist.loop_guard import RunAborted

try:
    from rich.console import Console as RichConsole
    _rich = RichConsole()
except Exception:  # pragma: no cover
    _rich = None

BANNER = _t("banner", VERSION)

HELP = _t("help_quickstart")

_HELP_TOPICS = {
    "start": lambda: _t("help_start"),
    "modules": lambda: _t("help_modules"),
    "run": lambda: _t("help_run"),
    "keys": lambda: _t("help_keys"),
    "cli": lambda: _t("help_cli"),
    "files": lambda: _t("help_files"),
}

_SHORTCUTS = {"r": "run", "e": "edit", "j": "jobs", "?": "help", "!": "shell"}

_HOME_FILE_NAMES = ("idea.md", "have.md", "hypothesis.md", "papers.md",
                    "Journal.md", "README-BETA1.md")

_STATUS_ICON = {"started": "[*]", "log": "   ", "done": "[+]", "fail": "[-]"}


def format_event(ev) -> str:
    """Single-line event representation for console/CLI output."""
    icon = _STATUS_ICON.get(ev.get("status"), "   ")
    return f"{icon} [{ev.get('stage', '')}] {ev.get('message', '')}"


class Console:
    def __init__(self):
        ensure_utf8_stdio()
        self.running = True
        self.registry = ModuleRegistry()
        self.jobs = JobRegistry()
        self.current_module = None   # Module
        self.current_options = {}    # option name -> value
        self._active_stops = {}      # job_id -> threading.Event
        self._config = load_defaults()

    # ------------------------------------------------------------------ io
    def _print(self, text=""):
        # markup=False: stage/messages contain [brackets] which rich would
        # interpret as markup tags and "eat".
        if _rich is not None:
            _rich.print(text, markup=False)
        else:
            print(text)

    def _err(self, text=""):
        self._print(f"[!] {text}")

    def _prompt(self):
        if self.current_module is None:
            return "aiscientist > "
        return f"aiscientist ({self.current_module.name}) > "

    # ------------------------------------------------------------------ home
    def banner(self):
        self.show_home()

    def _block_roots(self):
        roots = []
        try:
            roots.append(str(settings.obsidian_root(create=False)))
        except Exception:
            pass
        roots.append(str(settings.PROJECT_ROOT))
        wd = self._workdir()
        if wd not in roots:
            roots.append(wd)
        return roots

    def _job_status(self):
        running = self.jobs.running()
        if running:
            j = running[-1]
            evs = read_events(j.id)
            stage = evs[-1].get("stage", "") if evs else ""
            return j, f"running #{j.id} {stage}".strip()
        return self.jobs.last(), "idle"

    @staticmethod
    def _now_line(job):
        if job is None:
            return "\u2014"
        evs = read_events(job.id)
        if not evs:
            return "\u2014"
        last = evs[-1]
        return f"{last.get('stage', '')} \u00b7 {last.get('message', '')}"

    @staticmethod
    def _check_line(job):
        if job is None:
            return "not tested"
        return {
            "done": f"pass #{job.id}",
            "failed": f"fail #{job.id}",
            "aborted": f"hold #{job.id}",
            "running": f"running #{job.id}",
        }.get(job.status, "not tested")

    def show_home(self):
        import socket
        from ai_scientist.console import home

        job, job_line = self._job_status()
        roots = self._block_roots()
        blocks = {
            "idea": home.read_block("idea.md", roots, max_lines=2),
            "have": home.read_block("have.md", roots, max_lines=1),
            "hypothesis": home.read_block("hypothesis.md", roots, max_lines=1),
            "papers": home.read_block("papers.md", roots, max_lines=3),
        }
        ctx = {
            "version": VERSION,
            "host": socket.gethostname(),
            "model": os.environ.get("AISC_DEFAULT_MODEL", "\u2014"),
            "workdir": self._workdir(),
            "job": job_line,
            "editor": self._pick_editor(),
            "shell": self._pick_shell(),
            "blocks": blocks,
            "check": self._check_line(job),
            "now": self._now_line(job),
            "color": home.is_color(),
            "width": shutil.get_terminal_size((80, 24)).columns,
        }
        print(home.render(ctx))

    # ------------------------------------------------------------------ dispatch
    def handle(self, line):
        line = (line or "").strip()
        if not line:
            self.show_home()
            return
        parts = line.split()
        cmd, args = parts[0].lower(), parts[1:]

        if cmd == "e":
            return self.cmd_e(args)
        if cmd in ("1", "2", "3", "4", "5", "6"):
            return self._open_home_file(int(cmd))
        cmd = _SHORTCUTS.get(cmd, cmd)

        method = getattr(self, "cmd_" + cmd, None)
        if method is None:
            self._err(_t("unknown_command", cmd))
            return
        try:
            method(args)
        except KeyboardInterrupt:
            raise
        except SystemExit:
            raise
        except Exception as e:
            self._err(_t("command_error", cmd, e))

    # ------------------------------------------------------------------ commands
    def cmd_help(self, args):
        topic = args[0].lower() if args else ""
        if topic in _HELP_TOPICS:
            self._print(_HELP_TOPICS[topic]())
        elif topic:
            self._err(_t("no_topic", topic, ", ".join(_HELP_TOPICS)))
        else:
            self._print(HELP)

    def cmd_lang(self, args):
        if not args:
            self._print(_t("lang_current", current_language()))
            return
        lang = args[0].lower()
        if set_language(lang):
            # update module-level banner and HELP for new language
            global BANNER, HELP
            BANNER = _t("banner", VERSION)
            HELP = _t("help_quickstart")
            self._print(_t("lang_set", lang))
        else:
            self._err(_t("lang_usage"))

    def cmd_banner(self, args):
        self.show_home()

    def cmd_home(self, args):
        self.show_home()

    def cmd_fetch(self, args):
        self.show_home()

    def cmd_status(self, args):
        self.show_home()

    def cmd_search(self, args):
        query = args[0] if args else ""
        hits = self.registry.search(query)
        if not hits:
            self._print(f"[*] {_t('search_empty', query)}")
            return
        for m in hits:
            self._print(f"  {m.name:<20} {m.description}")

    def cmd_use(self, args):
        name = args[0] if args else ""
        mod = self.resolve_module(name)
        if mod is None:
            if name:
                self._err(_t("module_not_found", name))
            return
        self._select_module(mod)

    def _select_module(self, mod):
        self.current_module = mod
        self.current_options = {
            k: spec.get("default")
            for k, spec in mod.options.items()
        }
        self._apply_config_defaults()
        self._print(_t("module_selected", mod.name, mod.description))
        if mod.options:
            self._print(_t("module_options_hint"))

    def resolve_module(self, name):
        """Resolve module name: exact -> tail -> type/substring -> menu."""
        name = (name or "").strip()
        if not name:
            return self._module_menu()
        mod = self.registry.get(name)
        if mod is not None:
            return mod
        mods = self.registry.list()
        # unique tail after "/" (env -> auxiliary/env)
        tail = [m for m in mods if m.name.split("/")[-1] == name]
        if len(tail) == 1:
            return tail[0]
        if len(tail) > 1:
            return self._module_menu(tail)
        # type or substring (auxiliary -> all auxiliary/*)
        typed = [m for m in mods
                 if m.type == name or m.name.startswith(name + "/") or name in m.name]
        if len(typed) == 1:
            return typed[0]
        if len(typed) > 1:
            return self._module_menu(typed)
        return None

    def _module_menu(self, mods=None):
        mods = mods or self.registry.list()
        if not mods:
            self._err(_t("no_modules"))
            return None
        names = [m.name for m in mods]
        labels = [f"{m.name}  — {m.description}" for m in mods]
        pick = self._select_menu(_t("module_menu_title"), labels, values=names)
        if pick is None:
            return None
        return self.registry.get(pick)

    def _select_menu(self, question, choices, values=None):
        """Arrow menu (questionary) with fallback to numbered input.

        Returns values[i] (or choices[i]) for selected item, or None on cancel.
        Does not crash on non-TTY or without questionary.
        """
        cancel = _t("cancel")
        try:
            if not sys.stdin.isatty():
                raise RuntimeError("not a tty")
            import questionary
            items = list(choices) + [cancel]
            pick = questionary.select(question, choices=items).ask()
            if pick in (None, cancel):
                return None
            idx = items.index(pick)
            return (values or choices)[idx]
        except Exception:
            for i, c in enumerate(choices, 1):
                self._print(f"  {i}) {c}")
            self._print(f"  0) {cancel}")
            try:
                raw = input(_t("choose")).strip()
            except (EOFError, KeyboardInterrupt):
                return None
            if raw in ("", "0"):
                return None
            try:
                idx = int(raw) - 1
            except ValueError:
                return None
            if 0 <= idx < len(choices):
                return (values or choices)[idx]
            return None

    # ------------------------------------------------------------------ defaults
    def _list_templates(self):
        base = settings.PROJECT_ROOT / "templates"
        if not base.exists():
            return []
        return sorted(d.name for d in base.iterdir()
                      if d.is_dir() and (d / "prompt.json").exists())

    def _list_ideas(self, template):
        p = settings.PROJECT_ROOT / "templates" / template / "ideas.json"
        if not p.exists():
            return []
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            return [i for i in data if isinstance(i, dict) and i.get("Name")]
        except Exception:
            return []

    def _apply_config_defaults(self):
        """Apply default_template/default_idea from aiscientist.toml."""
        mod = self.current_module
        if mod is None:
            return
        if "TEMPLATE" in mod.options and not self.current_options.get("TEMPLATE"):
            t = self._config.get("default_template") or \
                (self._list_templates()[:1] or [""])[0]
            if t:
                self.current_options["TEMPLATE"] = t
        if "IDEA" in mod.options and not self.current_options.get("IDEA"):
            i = self._config.get("default_idea")
            if i:
                self.current_options["IDEA"] = i

    def _select_default_module(self):
        """Select default module (does not crash if missing)."""
        name = self._config.get("default_module") or "pipeline/run"
        mod = self.registry.get(name) or self.resolve_module(name)
        if mod is None:
            return
        self.current_module = mod
        self.current_options = {
            k: spec.get("default") for k, spec in mod.options.items()
        }
        self._apply_config_defaults()

    def cmd_back(self, args):
        if self.current_module is None:
            return self._err(_t("no_module"))
        name = self.current_module.name
        self.current_module = None
        self.current_options = {}
        self._print(_t("module_reset", name))

    def cmd_show(self, args):
        what = args[0] if args else "options"
        if what == "modules":
            mods = self.registry.list()
            if not mods:
                return self._print(f"[*] {_t('modules_empty_hint')}")
            for m in mods:
                self._print(f"  {m.name:<20} {m.description}")
        elif what == "info":
            m = self.current_module
            if m is None:
                m = self.registry.get(self._config.get("default_module") or "pipeline/run")
            if m is None:
                return self._err(_t("no_module"))
            self._print(f"  name: {m.name}\n  type: {m.type}\n  description: {m.description}")
        elif what == "options":
            if self.current_module is None:
                return self._err(_t("no_module"))
            self._show_options()
        else:
            self._err(f"show: unknown `{what}` (options|info|modules)")

    def _show_options(self):
        m = self.current_module
        if not m.options:
            return self._print(f"[*] {_t('no_options')}")
        for key, spec in m.options.items():
            req = "required" if spec.get("required") else "optional"
            cur = self.current_options.get(key)
            extra = []
            if spec.get("choices"):
                extra.append("choices=" + ",".join(spec["choices"]))
            if spec.get("default") not in (None, ""):
                extra.append(f"default={spec['default']}")
            suffix = f"  ({'; '.join(extra)})" if extra else ""
            self._print(f"  {key:<12} {req:<9} = {cur!r}{suffix}")

    def cmd_set(self, args):
        if self.current_module is None:
            return self._err(_t("no_module"))
        if len(args) < 2:
            return self._err(_t("set_usage"))
        key, value = args[0], " ".join(args[1:])
        spec = self.current_module.options.get(key)
        if spec is None:
            return self._err(_t("unknown_option", key))
        try:
            value = self._coerce(value, spec)
        except ValueError as e:
            return self._err(f"{_t('unknown_option', key).split('.')[0]}: {e}")
        self.current_options[key] = value
        self._print(_t("option_set", key, value))

    def cmd_unset(self, args):
        if self.current_module is None:
            return self._err(_t("no_module"))
        if not args:
            return self._err(_t("unset_usage"))
        key = args[0]
        if key not in self.current_module.options:
            return self._err(_t("unknown_option", key))
        self.current_options[key] = self.current_module.options[key].get("default")
        self._print(_t("option_reset", key))

    @staticmethod
    def _coerce(value, spec):
        vtype = spec.get("type", "str")
        if vtype == "int":
            return int(value)
        if vtype == "choice":
            choices = spec.get("choices", [])
            if value not in choices:
                raise ValueError(_t("invalid_choice", ", ".join(choices)))
            return value
        if vtype == "bool":
            return str(value).lower() in ("1", "true", "yes", "on")
        return value  # str, csv

    def cmd_exploit(self, args):
        """Alias for `run`."""
        return self.cmd_run(args)

    def cmd_run(self, args):
        # bare `run` without use — take default module
        if self.current_module is None:
            self._select_default_module()
        if self.current_module is None:
            return self._err(_t("no_modules_run"))
        mod = self.current_module
        self._fill_run_options()
        missing = [k for k, spec in mod.options.items()
                   if spec.get("required") and not self.current_options.get(k)]
        if missing:
            return self._err(_t("missing_required", ", ".join(missing)))

        opts = dict(self.current_options)
        job = self.jobs.create(
            module=mod.name,
            template=str(opts.get("TEMPLATE", "") or ""),
            model=str(opts.get("MODEL", "") or ""),
            idea=str(opts.get("IDEA", "") or ""),
        )
        self._spawn(mod, job, opts)

    def _fill_run_options(self):
        """If TEMPLATE/IDEA empty — menu (or auto-first on non-TTY)."""
        mod = self.current_module
        opts = self.current_options
        if "TEMPLATE" in mod.options and not opts.get("TEMPLATE"):
            tpls = self._list_templates()
            if tpls:
                if len(tpls) == 1 or not sys.stdin.isatty():
                    opts["TEMPLATE"] = tpls[0]
                else:
                    pick = self._select_menu(_t("template"), tpls)
                    if pick:
                        opts["TEMPLATE"] = pick
                self._print(_t("template_label", opts.get("TEMPLATE")))
        if "IDEA" in mod.options and not opts.get("IDEA") and opts.get("TEMPLATE"):
            ideas = self._list_ideas(opts["TEMPLATE"])
            if ideas and sys.stdin.isatty():
                nofilter = _t("no_filter")
                names = [i.get("Name", "?") for i in ideas]
                pick = self._select_menu(_t("idea"), [nofilter] + names)
                if pick and pick != nofilter:
                    opts["IDEA"] = pick

    def _spawn(self, mod, job, options):
        stop_event = threading.Event()
        self._active_stops[job.id] = stop_event

        def target():
            execute_job(mod, options, self.jobs, self._print_event,
                        stop_event=stop_event, job=job)
            self._active_stops.pop(job.id, None)

        self._print(_t("job_started", job.id, mod.name))
        threading.Thread(target=target, daemon=True).start()

    def _print_event(self, ev):
        self._print(format_event(ev))

    def cmd_jobs(self, args):
        self._show_jobs()
        jobs = self.jobs.list()
        # arrow menu: select job -> its log (interactive only)
        if jobs and not args and sys.stdin.isatty():
            labels = [f"#{j.id}  {j.status:<8} {j.module or '-'}" for j in jobs]
            pick = self._select_menu(_t("job_menu_title"), labels,
                                     values=[j.id for j in jobs])
            if pick is not None:
                self._show_job_logs(pick)

    def cmd_sessions(self, args):
        self._show_jobs()

    def _show_jobs(self):
        jobs = self.jobs.list()
        if not jobs:
            return self._print(f"[*] {_t('no_jobs')}")
        for j in jobs:
            extra = []
            if j.idea:
                extra.append(f"idea={j.idea}")
            if j.template:
                extra.append(f"template={j.template}")
            suffix = f"  ({' '.join(extra)})" if extra else ""
            self._print(f"  {j.id:<4} {j.status:<8} {j.module or '-'}{suffix}")

    def _show_job_logs(self, job_id):
        events = read_events(job_id)
        if not events:
            return self._print(f"[*] {_t('no_job_events', job_id)}")
        for ev in events:
            self._print_event(ev)

    def cmd_logs(self, args):
        follow = "-f" in args or "--follow" in args
        job = self.jobs.last_or_current()
        if job is None:
            return self._print(f"[*] {_t('no_logs')}")
        events = read_events(job.id)
        if not events:
            self._print(f"[*] {_t('no_job_events', job.id)}")
        for ev in events:
            self._print_event(ev)
        if follow:
            if job.status in ("done", "failed", "aborted"):
                self._print(_t("job_completed", job.id, job.status))
                return
            self._print(_t("follow_mode", job.id))
            seen = len(events)
            try:
                while True:
                    import time
                    time.sleep(1)
                    new_events = read_events(job.id)
                    for ev in new_events[seen:]:
                        self._print_event(ev)
                    seen = len(new_events)
                    if job.status in ("done", "failed", "aborted"):
                        self._print(_t("follow_done", job.id, job.status))
                        break
            except KeyboardInterrupt:
                self._print(_t("follow_stopped"))

    def cmd_stop(self, args):
        running = self.jobs.running()
        if not running:
            return self._print(f"[*] {_t('no_active_jobs')}")
        for j in running:
            ev = self._active_stops.get(j.id)
            if ev is not None:
                ev.set()
            self._print(_t("stop_requested", j.id))

    def cmd_loot(self, args):
        self._show_loot()

    def cmd_results(self, args):
        self._show_loot()

    def _list_runs(self):
        base = settings.RESULTS_DIR
        runs = []
        if base.exists():
            for tpl in base.iterdir():
                if not tpl.is_dir() or tpl.name in ("events",):
                    continue
                for run in tpl.iterdir():
                    if run.is_dir():
                        runs.append(run)
        runs.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return runs

    def _show_run_contents(self, run):
        self._print(_t("run_show", run))
        for f in sorted(run.iterdir()):
            mark = "/" if f.is_dir() else ""
            self._print(f"   {f.name}{mark}")

    def _show_loot(self):
        runs = self._list_runs()
        if not runs:
            return self._print(f"[*] {_t('no_results')}")
        if not sys.stdin.isatty():
            # non-interactive — just show latest run
            self._show_run_contents(runs[0])
            return
        labels = [f"{r.parent.name}/{r.name}" for r in runs[:15]]
        pick = self._select_menu(_t("run_menu_title"), labels,
                                 values=runs[:15])
        if pick is not None:
            self._show_run_contents(pick)

    def _pick_editor(self):
        """$EDITOR from env, otherwise first available: nvim -> hx -> vim -> nano."""
        env = os.environ.get("EDITOR", "").strip()
        if env:
            return env
        for cand in ("nvim", "hx", "vim", "nano"):
            if shutil.which(cand):
                return cand
        return "nano"

    def _pick_shell(self):
        return (os.environ.get("SHELL") or shutil.which("bash")
                or shutil.which("sh") or os.environ.get("COMSPEC") or "bash")

    def _workdir(self):
        """Experiment folder: templates/<TEMPLATE> if set, else repo root."""
        tpl = (self.current_options or {}).get("TEMPLATE", "")
        if tpl:
            d = osp.join(settings.PROJECT_ROOT, "templates", tpl)
            if osp.isdir(d):
                return d
        return str(settings.PROJECT_ROOT)

    def _edit_target(self, args):
        """File for `edit`: explicit path, or template root file, or workdir."""
        if args:
            return args[0]
        tpl = (self.current_options or {}).get("TEMPLATE", "")
        if tpl:
            p = osp.join(settings.PROJECT_ROOT, "templates", tpl, "prompt.json")
            if osp.exists(p):
                return p
        return self._workdir()

    def _open_editor(self, target):
        editor = self._pick_editor()
        try:
            subprocess.call([editor, target], cwd=self._workdir())
        except FileNotFoundError:
            self._err(_t("editor_not_found", editor))
        except OSError as e:
            self._err(_t("editor_open_error", target, e))

    def cmd_edit(self, args):
        self._open_editor(self._edit_target(args))

    def cmd_e(self, args):
        """Key `e`: $EDITOR on idea.md (or current experiment file)."""
        from ai_scientist.console import home
        p = home.find_file("idea.md", self._block_roots())
        if p is None:
            p = self._edit_target([])
        self._open_editor(p)

    def _home_file_paths(self):
        from ai_scientist.console import home
        roots = self._block_roots()
        return [home.find_file(name, roots) for name in _HOME_FILE_NAMES]

    def _open_home_file(self, n):
        paths = self._home_file_paths()
        if n < 1 or n > len(paths):
            return self._err(_t("no_file"))
        p = paths[n - 1]
        if p is None:
            return self._err(_t("file_not_found", n))
        self._open_editor(p)

    def cmd_shell(self, args):
        shell = self._pick_shell()
        self._print(_t("shell_started", shell, self._workdir()))
        try:
            subprocess.call([shell], cwd=self._workdir())
        except (FileNotFoundError, OSError) as e:
            self._err(_t("shell_error", e))

    def cmd_exit(self, args):
        self.running = False

    # ------------------------------------------------------------------ loop
    def run(self) -> int:
        self.show_home()
        self._env_check_quiet()
        self._select_default_module()
        session = self._make_prompt_session()
        if session is not None:
            self._print(f"[*] {_t('tab_hint')}")
        while self.running:
            try:
                if session is not None:
                    line = session.prompt(self._prompt())
                else:
                    line = input(self._prompt())
            except EOFError:
                self._print()
                break
            except KeyboardInterrupt:
                # Ctrl+C — cancel input, not exit
                self._print("^C")
                continue
            self.handle(line)
        return 0

    def _env_check_quiet(self):
        """Once quietly: is there a key. Without key — one red line."""
        key = (os.environ.get("OPENROUTER_API_KEY")
               or os.environ.get("OPENAI_API_KEY")
               or os.environ.get("ANTHROPIC_API_KEY"))
        if key:
            return
        from ai_scientist.console import home
        red = "\033[31m" if home.is_color() else ""
        rst = "\033[0m" if home.is_color() else ""
        print(f"{red}[!] {_t('no_api_key')}{rst}")

    def _commands(self):
        return ["help", "banner", "home", "fetch", "status", "search", "use",
                "back", "show", "set", "unset", "run", "exploit", "jobs",
                "sessions", "logs", "stop", "loot", "results", "edit", "shell",
                "lang", "exit", "r", "e", "j", "?"]

    def _history_path(self):
        try:
            d = Path.home() / ".local" / "share" / "aiscientist"
            d.mkdir(parents=True, exist_ok=True)
            return d / "history"
        except Exception:
            return settings.PROJECT_ROOT / ".aiscientist_history"

    def _make_prompt_session(self):
        """prompt_toolkit session (history + Tab). None -> fallback to input()."""
        try:
            if not (sys.stdin.isatty() and sys.stdout.isatty()):
                return None
            from prompt_toolkit import PromptSession
            from prompt_toolkit.history import FileHistory
            return PromptSession(history=FileHistory(str(self._history_path())),
                                 completer=self._make_completer())
        except Exception:
            return None

    def _make_completer(self):
        try:
            from prompt_toolkit.completion import Completer, Completion
        except Exception:
            return None
        console = self

        class ConsoleCompleter(Completer):
            def get_completions(self, document, complete_event):
                text = document.text_before_cursor
                parts = text.split()
                word = "" if text.endswith(" ") else (parts[-1] if parts else "")
                nwords = len(parts) if text.endswith(" ") else len(parts) - 1
                first = parts[0] if parts else ""
                if nwords <= 0:
                    for c in console._commands():
                        if c.startswith(word):
                            yield Completion(c, -len(word))
                elif first in ("use", "search"):
                    names = []
                    for m in console.registry.list():
                        names.append(m.name)
                        names.append(m.name.split("/")[-1])
                    for n in sorted(set(names)):
                        if n.startswith(word):
                            yield Completion(n, -len(word))
                elif first == "set" and nwords == 1 and console.current_module:
                    for k in console.current_module.options:
                        if k.startswith(word):
                            yield Completion(k, -len(word))
                elif first == "help" and nwords == 1:
                    for t in _HELP_TOPICS:
                        if t.startswith(word):
                            yield Completion(t, -len(word))
                elif first == "edit" and nwords >= 1:
                    import glob
                    for p in glob.glob(word + "*"):
                        yield Completion(p, -len(word))

        return ConsoleCompleter()


def _now() -> str:
    import datetime
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def execute_job(mod, options, jobs, printer, stop_event=None, job=None) -> int:
    """Synchronously executes a module and returns exit code (0/1/130).

    Shared by REPL (in thread) and CLI (directly): registers job, runs live log
    via emit_factory, distinguishes done/failed/aborted.
    """
    if job is None:
        job = jobs.create(
            module=mod.name,
            template=str(options.get("TEMPLATE", "") or ""),
            model=str(options.get("MODEL", "") or ""),
            idea=str(options.get("IDEA", "") or ""),
        )
    emit = emit_factory(job, printer)
    jobs.update(job, status="running", started_at=_now(), pid=os.getpid())
    emit("run", "started", f"job {job.id} started")
    code = 0
    try:
        result = mod.run(options, job, emit, stop_event)
        if isinstance(result, dict) and result.get("aborted"):
            jobs.update(job, status="aborted")
            emit("run", "fail", _t("pipeline_run_aborted"),
                 detail={"aborted": True, "exit_code": 130})
            code = 130
        elif isinstance(result, dict) and result.get("ok") is False:
            jobs.update(job, status="failed")
            emit("run", "fail", _t("pipeline_run_failed"),
                 detail={"exit_code": 1})
            code = 1
        else:
            jobs.update(job, status="done")
            emit("run", "done", f"job {job.id} completed",
                 detail={"summary": result} if isinstance(result, dict) else None)
    except RunAborted:
        jobs.update(job, status="aborted")
        emit("run", "fail", _t("pipeline_run_aborted"),
             detail={"aborted": True, "exit_code": 130})
        code = 130
    except Exception as e:
        jobs.update(job, status="failed")
        emit("run", "fail", str(e), detail={"error": str(e), "exit_code": 1})
        code = 1
    finally:
        jobs.update(job, finished_at=_now())
    return code


def main() -> int:
    os.chdir(settings.PROJECT_ROOT)
    return Console().run()
