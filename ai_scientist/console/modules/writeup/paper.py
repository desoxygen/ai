"""writeup/paper — build/repair the ARTICLE for an existing run folder.

Resume-style entry to the paper half of the loop: writeup -> review (+ optional
improve). Powers the TUI "Paper" workspace and `aiscientist -q paper`:

    FOLDER  explicit results/<template>/<ts>_<idea> folder (empty = newest one)
    STAGES  subset of writeup,review (default both)
    IMPROVE / IMPROVE_MIN_SCORE / IMPROVE_ROUNDS — repair loop from review
    MODEL / PLAN_MODEL / CODE_MODEL / REVIEW_MODEL / ENGINE — as in pipeline/run

Section-level progress flows as regular `writeup` log events with
detail={"section", "phase"} — one event stream for dashboard/report/TUI.
"""
import glob
import os.path as osp

MANIFEST = {
    "type": "pipeline",
    "description": "write/review the paper for a run folder (writeup -> review -> improve)",
    "options": {
        "TEMPLATE": {"required": True, "type": "str", "default": ""},
        "FOLDER": {"required": False, "type": "str", "default": ""},
        "STAGES": {"required": False, "type": "csv", "default": "writeup,review"},
        "ENGINE": {"required": False, "type": "choice",
                   "choices": ["semanticscholar", "openalex"], "default": "semanticscholar"},
        "MODEL": {"required": False, "type": "str", "default": ""},
        "PLAN_MODEL": {"required": False, "type": "str", "default": ""},
        "CODE_MODEL": {"required": False, "type": "str", "default": ""},
        "REVIEW_MODEL": {"required": False, "type": "str", "default": ""},
        "IMPROVE": {"required": False, "type": "choice",
                    "choices": ["on", "off"], "default": "off"},
        "IMPROVE_MIN_SCORE": {"required": False, "type": "int", "default": 6},
        "IMPROVE_ROUNDS": {"required": False, "type": "int", "default": 1},
    },
}


def _latest_folder(results_dir: str) -> str:
    """Newest run folder that still has notes.txt (writeup needs it)."""
    candidates = [d for d in glob.glob(osp.join(results_dir, "*"))
                  if osp.isdir(d) and osp.exists(osp.join(d, "notes.txt"))]
    return max(candidates, key=osp.getmtime) if candidates else ""


def run(options, job, emit, stop_event=None):
    import os

    from ai_scientist.console.i18n import get as _t
    from ai_scientist.pipeline import PipelineRunner

    template = (options.get("TEMPLATE") or "").strip()
    if not template:
        raise ValueError(_t("pipeline_template_not_set"))
    if not osp.isdir(osp.join("templates", template)):
        raise ValueError(_t("pipeline_template_not_found", template,
                            osp.join("templates", template)))

    folder = (options.get("FOLDER") or "").strip()
    if folder:
        if not osp.isdir(folder):
            raise ValueError(_t("paper_folder_missing", folder))
    else:
        from ai_scientist import settings
        results_dir = osp.join(str(settings.RESULTS_DIR), template)
        folder = _latest_folder(results_dir)
        if not folder:
            raise ValueError(_t("paper_no_run", results_dir))

    stages = {s.strip() for s in (options.get("STAGES") or "writeup,review").split(",")
              if s.strip()} or {"writeup", "review"}
    stages &= {"writeup", "review"}
    if not stages:
        raise ValueError(_t("paper_empty_stages"))

    model = (options.get("MODEL") or "").strip() or \
        os.environ.get("AISC_DEFAULT_MODEL", "")
    if not model:
        from ai_scientist import openrouter
        model = openrouter.default_model()
    models = {k.lower(): v for k, v in
              (("plan", options.get("PLAN_MODEL")),
               ("code", options.get("CODE_MODEL")),
               ("review", options.get("REVIEW_MODEL"))) if v}
    improvement = str(options.get("IMPROVE") or "off").lower() in ("on", "true", "1", "yes")

    emit("writeup", "log", f"resume folder: {folder}",
         detail={"folder": folder, "stages": sorted(stages)})
    runner = PipelineRunner(
        template, model,
        engine=options.get("ENGINE") or "semanticscholar",
        stages=stages, run_id=job.run_id, emit=emit, stop_event=stop_event,
        improvement=improvement,
        improve_min_score=float(options.get("IMPROVE_MIN_SCORE") or 6),
        improve_rounds=int(options.get("IMPROVE_ROUNDS") or 1),
        models=models,
    )
    summary = runner.resume_run(folder, stages)
    failed = any(s.get("status", "").endswith("failed")
                 for s in summary.get("statuses", {}).values())
    return {**summary, "ok": (not summary.get("aborted")) and (not failed),
            "folder": folder}
