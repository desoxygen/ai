"""report/last — artifacts of the last run (results/<template>/<ts>_<Name>/)."""
import json
import os
import os.path as osp

MANIFEST = {
    "type": "report",
    "description": "collect results of the last run",
    "options": {},
}


def _find_latest_run(results_dir):
    runs = []
    if not osp.isdir(results_dir):
        return None
    for tpl in os.listdir(results_dir):
        tpl_dir = osp.join(results_dir, tpl)
        if not osp.isdir(tpl_dir) or tpl == "events":
            continue
        for run in os.listdir(tpl_dir):
            r = osp.join(tpl_dir, run)
            if osp.isdir(r):
                runs.append(r)
    if not runs:
        return None
    return max(runs, key=osp.getmtime)


def run(options, job, emit, stop_event=None):
    from ai_scientist import settings
    from ai_scientist.console.i18n import get as _t

    latest = _find_latest_run(str(settings.RESULTS_DIR))
    if latest is None:
        emit("system", "log", _t("report_no_results"))
        return {"ok": True, "folder": None}

    emit("system", "log", _t("report_latest", latest))
    for name in sorted(os.listdir(latest)):
        p = osp.join(latest, name)
        mark = "/" if osp.isdir(p) else ""
        emit("system", "log", f"  {name}{mark}")

    review = osp.join(latest, "review.txt")
    if osp.exists(review):
        try:
            with open(review, encoding="utf-8") as f:
                rv = json.load(f)
            if isinstance(rv, dict):
                emit("system", "log",
                     f"  review: Overall={rv.get('Overall')}, Decision={rv.get('Decision')}")
        except Exception:
            pass

    return {"ok": True, "folder": latest}
