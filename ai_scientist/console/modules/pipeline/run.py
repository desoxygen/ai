"""pipeline/run — wrapper for the actual `ai_scientist.pipeline.PipelineRunner`.

Thin wrapper: does not rewrite science. Passes events (emit) and stop flag
(stop_event) to the runner; stages publish started/log/done/fail.

Smoke: one idea, one stage —
    use pipeline/run
    set TEMPLATE nanoGPT_lite
    set NUM_IDEAS 1
    set STAGES ideas
    run

stop — cooperative: checked at stage/idea boundaries (RunAborted).
"""
import os.path as osp

MANIFEST = {
    "type": "pipeline",
    "description": "run current idea through existing stages",
    "options": {
        "TEMPLATE": {"required": True, "type": "str", "default": ""},
        "MODEL": {"required": False, "type": "str", "default": ""},
        "IDEA": {"required": False, "type": "str", "default": ""},
        "NUM_IDEAS": {"required": False, "type": "int", "default": 1},
        "NUM_REFLECTIONS": {"required": False, "type": "int", "default": 3},
        "STAGES": {"required": False, "type": "csv",
                   "default": "ideas,novelty,experiments,writeup,review"},
        "ENGINE": {"required": False, "type": "choice",
                   "choices": ["semanticscholar", "openalex"], "default": "semanticscholar"},
        "IMPROVE": {"required": False, "type": "choice",
                    "choices": ["on", "off"], "default": "off"},
        "IMPROVE_MIN_SCORE": {"required": False, "type": "int", "default": 6},
        "IMPROVE_ROUNDS": {"required": False, "type": "int", "default": 1},
    },
}


def _default_model():
    from ai_scientist import openrouter
    return openrouter.default_model()


def _client_model(raw: str) -> str:
    from ai_scientist import openrouter
    return openrouter.as_client_model(raw)


def _parse_stages(raw):
    stages = {s.strip() for s in (raw or "").split(",") if s.strip()}
    return stages or {"ideas"}


def _has_failed(summary):
    failed = {"failed", "experiments_failed", "writeup_failed", "review_failed"}
    for st in summary.get("statuses", {}).values():
        if isinstance(st, dict) and st.get("status") in failed:
            return True
    return False


def run(options, job, emit, stop_event=None):
    from ai_scientist.console.i18n import get as _t
    from ai_scientist.pipeline import PipelineRunner

    template = (options.get("TEMPLATE") or "").strip()
    if not template:
        raise ValueError(_t("pipeline_template_not_set"))
    base_dir = osp.join("templates", template)
    if not osp.isdir(base_dir):
        raise ValueError(_t("pipeline_template_not_found", template, base_dir))

    model = (options.get("MODEL") or "").strip() or _default_model()
    stages = _parse_stages(options.get("STAGES"))
    num_ideas = int(options.get("NUM_IDEAS") or 1)
    num_reflections = int(options.get("NUM_REFLECTIONS") or 3)
    engine = options.get("ENGINE") or "semanticscholar"
    idea_filter = (options.get("IDEA") or "").strip()
    improvement = str(options.get("IMPROVE") or "off").lower() in ("on", "true", "1", "yes")
    improve_min_score = float(options.get("IMPROVE_MIN_SCORE") or 6)
    improve_rounds = int(options.get("IMPROVE_ROUNDS") or 1)

    runner = PipelineRunner(
        template, model,
        num_ideas=num_ideas, num_reflections=num_reflections,
        engine=engine, stages=stages, run_id=job.run_id,
        emit=emit, stop_event=stop_event, idea_filter=idea_filter,
        improvement=improvement,
        improve_min_score=improve_min_score, improve_rounds=improve_rounds,
    )
    summary = runner.run()
    ok = (not summary.get("aborted")) and (not _has_failed(summary))
    return {**summary, "ok": ok}
