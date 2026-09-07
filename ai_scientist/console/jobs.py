"""JobRegistry — активные/завершённые прогоны.

Job описывает один запуск модуля. Хранится in-memory и персистентно в
`results/jobs.jsonl`, чтобы CLI (`aiscientist status|logs`) видел те же прогоны
из отдельного процесса.
"""
import datetime
import json
import threading
from dataclasses import asdict, dataclass

from ai_scientist import settings

STATUSES = ("queued", "running", "done", "failed", "aborted")


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


def _now() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


class JobRegistry:
    def __init__(self):
        self._lock = threading.RLock()
        self.jobs = []
        self._load()

    # -- persistence ---------------------------------------------------------
    def _path(self):
        return settings.RESULTS_DIR / "jobs.jsonl"

    def _load(self):
        p = self._path()
        if not p.exists():
            return
        for ln in p.read_text(encoding="utf-8").splitlines():
            try:
                self.jobs.append(Job(**json.loads(ln)))
            except Exception:
                continue

    def _save(self):
        p = self._path()
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            for j in self.jobs:
                f.write(json.dumps(asdict(j), ensure_ascii=False) + "\n")

    # -- api -----------------------------------------------------------------
    def create(self, module="", template="", model="", idea="", run_id="") -> Job:
        with self._lock:
            next_id = max((j.id for j in self.jobs), default=0) + 1
            job = Job(
                id=next_id,
                run_id=run_id or datetime.datetime.now().strftime("%Y%m%d_%H%M%S"),
                module=module,
                template=template,
                model=model,
                idea=idea,
            )
            self.jobs.append(job)
            self._save()
            return job

    def update(self, job: Job, **kw) -> Job:
        with self._lock:
            for k, v in kw.items():
                setattr(job, k, v)
            self._save()
            return job

    def get(self, job_id: int):
        for j in self.jobs:
            if j.id == job_id:
                return j
        return None

    def list(self):
        return list(self.jobs)

    def running(self):
        return [j for j in self.jobs if j.status == "running"]

    def last(self):
        return self.jobs[-1] if self.jobs else None

    def last_or_current(self):
        running = self.running()
        if running:
            return running[-1]
        return self.last()
