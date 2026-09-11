"""JobRegistry — активные/завершённые прогоны.

Job описывает один запуск модуля. Хранится in-memory и персистентно в
`results/jobs.jsonl`, чтобы CLI (`aiscientist status|logs`) видел те же прогоны
из отдельного процесса.
"""
import datetime
import json
import os
import threading
import time
from dataclasses import asdict, dataclass

from ai_scientist import settings

STATUSES = ("queued", "running", "done", "failed", "aborted")


class _ProcLock:
    """Sidecar exclusive lock: TUI spawns one runner process per job, and
    several can register at the same instant. Reads-then-appends must be
    serialized across processes, not just threads."""

    def __init__(self, path, timeout=10.0, stale=30.0):
        self.path = str(path) + ".lock"
        self.timeout = timeout
        self.stale = stale

    def __enter__(self):
        deadline = time.time() + self.timeout
        while True:
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.close(fd)
                return self
            except (FileExistsError, PermissionError):
                # Windows: an existing-but-open lock surfaces as PermissionError
                try:
                    if time.time() - os.path.getmtime(self.path) > self.stale:
                        os.remove(self.path)
                        continue
                except OSError:
                    pass
                if time.time() > deadline:
                    raise TimeoutError(f"jobs store lock busy: {self.path}")
                time.sleep(0.03)

    def __exit__(self, *exc):
        try:
            os.remove(self.path)
        except OSError:
            pass


@dataclass
class Job:
    id: int
    run_id: str = ""
    module: str = ""
    template: str = ""
    model: str = ""
    idea: str = ""
    status: str = "queued"
    started_at: str = ""
    finished_at: str = ""
    pid: int = 0
    deleted: bool = False


def _now() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def _pid_alive(pid) -> bool:
    """Is this pid a live process? purge must not protect zombie records
    (a killed runner leaves status=running forever — stress C3 case)."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        try:
            code = ctypes.c_ulong()
            if k32.GetExitCodeProcess(h, ctypes.byref(code)):
                return code.value == 259  # STILL_ACTIVE
            return True
        finally:
            k32.CloseHandle(h)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


class JobRegistry:
    """Append-only JSONL journal, folded by id (last record per id wins).

    Full-file rewrites used to race between the TUI's spawned runner
    processes (one would overwrite the other's freshly appended job and
    both could pick the same id — see docs/STRESS-TESTS.md, cycle 1).
    Every mutation now happens under a cross-process lock and writes a
    single line; readers fold duplicates.
    """

    def __init__(self):
        self._lock = threading.RLock()
        self.jobs = []
        self._by_id = {}
        self._load()

    # -- persistence ---------------------------------------------------------
    def _path(self):
        return settings.RESULTS_DIR / "jobs.jsonl"

    @staticmethod
    def _iter_records(p):
        if not p.exists():
            return
        for ln in p.read_text(encoding="utf-8").splitlines():
            try:
                yield Job(**json.loads(ln))
            except Exception:
                continue

    def _fold(self, records):
        by_id = {}
        for j in records:
            by_id[j.id] = j
        self._by_id = by_id
        # tombstoned ids stay in _by_id (ids are never reused) but vanish from
        # every user-facing view
        self.jobs = [j for j in by_id.values() if not j.deleted]

    def _load(self):
        with self._lock:
            self._fold(self._iter_records(self._path()))

    def _append(self, job: Job):
        p = self._path()
        p.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(asdict(job), ensure_ascii=False) + "\n"
        with _ProcLock(p):
            # re-fold from disk under the lock, then append the record and
            # make it the live in-memory state for this id (the fold's copy
            # is stale by definition — it predates the record we just wrote)
            self._fold(self._iter_records(p))
            self._by_id[job.id] = job
            for i, x in enumerate(self.jobs):
                if x.id == job.id:
                    self.jobs[i] = job
                    break
            else:
                if not job.deleted:
                    self.jobs.append(job)
            with open(p, "a", encoding="utf-8") as f:
                f.write(line)

    # -- api -----------------------------------------------------------------
    def create(self, module="", template="", model="", idea="", run_id="") -> Job:
        with self._lock:
            job = Job(
                id=0,  # assigned under the cross-process lock in _create
                run_id=run_id or datetime.datetime.now().strftime("%Y%m%d_%H%M%S"),
                module=module,
                template=template,
                model=model,
                idea=idea,
            )
            p = self._path()
            p.parent.mkdir(parents=True, exist_ok=True)
            with _ProcLock(p):
                self._fold(self._iter_records(p))
                job.id = max(self._by_id, default=0) + 1  # tombstones: no id reuse
                self._by_id[job.id] = job
                with open(p, "a", encoding="utf-8") as f:
                    f.write(json.dumps(asdict(job), ensure_ascii=False) + "\n")
                self.jobs.append(job)
            return job

    def update(self, job: Job, **kw) -> Job:
        with self._lock:
            for k, v in kw.items():
                setattr(job, k, v)
            self._append(job)
            return job

    def purge(self, template=None, keep_running=True):
        """Drop finished job records (and their event files).

        The journal is compacted under the process lock; one tombstone with
        the highest removed id is kept so ids are never reused. Returns the
        list of removed ids. Live jobs survive unless keep_running is False.
        A "running" record whose pid is dead is a zombie — it gets closed as
        aborted and then removed like any finished job (stress C3).
        """
        from ai_scientist.console.events import event_log_path

        p = self._path()
        with self._lock, _ProcLock(p):
            self._fold(self._iter_records(p))
            removed, watermark = [], 0
            for j in list(self.jobs):
                zombie = j.status == "running" and not _pid_alive(j.pid)
                # a "queued" record is usually the live microsecond window
                # between create() and the running update; it's only garbage
                # if its run_id is older than 2 minutes
                if j.status == "queued":
                    zombie = j.pid > 0 and not _pid_alive(j.pid)
                    if not zombie and j.run_id:
                        try:
                            born = datetime.datetime.strptime(j.run_id, "%Y%m%d_%H%M%S")
                            zombie = (datetime.datetime.now() - born) > datetime.timedelta(minutes=2)
                        except ValueError:
                            zombie = False
                if zombie:
                    j.status, j.finished_at = "aborted", (j.finished_at or j.started_at or j.run_id)
                elif keep_running and j.status in ("queued", "running"):
                    continue
                if template and j.template != template:
                    continue
                removed.append(j.id)
                watermark = max(watermark, j.id)
            if not removed:
                return []
            gone = set(removed)
            self.jobs = [j for j in self.jobs if j.id not in gone]
            tmp = str(p) + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                for j in self.jobs:
                    f.write(json.dumps(asdict(j), ensure_ascii=False) + "\n")
                if removed:
                    f.write(json.dumps({"id": watermark, "deleted": True}) + "\n")
            os.replace(tmp, p)
        for jid in removed:
            try:
                os.remove(event_log_path(jid))
            except OSError:
                pass
        return removed

    def get(self, job_id: int):
        for j in self.jobs:
            if j.id == job_id:
                return j
        return None

    def list(self):
        return list(self.jobs)

    def running(self):
        return [j for j in self.jobs if j.status == "running"]

    def live_duplicates(self, module, template, exclude_id=None):
        """Other queued/running jobs with a live pid — same module+template.
        Guards against TUI double-clicks spawning parallel identical jobs
        (stress C4: three /paper jobs raced in 26 seconds)."""
        return [j for j in self.jobs
                if j.id != exclude_id and j.module == module
                and j.template == template
                and j.status in ("queued", "running") and _pid_alive(j.pid)]

    def last(self):
        return self.jobs[-1] if self.jobs else None

    def last_or_current(self):
        running = self.running()
        if running:
            return running[-1]
        return self.last()
