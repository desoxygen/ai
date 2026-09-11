"""auxiliary/ideas — list ideas from templates/<template>/ideas.json."""
import json
import os.path as osp

MANIFEST = {
    "type": "auxiliary",
    "description": "list ideas from a template",
    "options": {
        "TEMPLATE": {"required": True, "type": "str", "default": ""},
    },
}


def run(options, job, emit, stop_event=None):
    from ai_scientist.console.i18n import get as _t

    template = (options.get("TEMPLATE") or "").strip()
    if not template:
        raise ValueError(_t("ideas_empty_template"))
    path = osp.join("templates", template, "ideas.json")
    if not osp.exists(path):
        raise ValueError(_t("ideas_not_found", path))

    with open(path, encoding="utf-8") as f:
        ideas = json.load(f)

    if not ideas:
        emit("system", "log", _t("ideas_empty"))
        return {"ok": True, "count": 0}

    emdash = "—"  # backslashes are illegal inside f-string expressions before 3.12
    for i, idea in enumerate(ideas):
        if not isinstance(idea, dict):
            continue
        name = idea.get("Name", "?")
        title = idea.get("Title", "")
        scores = (f"Int={idea.get('Interestingness', emdash)} "
                  f"Feas={idea.get('Feasibility', emdash)} "
                  f"Nov={idea.get('Novelty', emdash)}")
        novel = f" novel={idea.get('novel', emdash)}" if "novel" in idea else ""
        emit("system", "log", f"{i + 1}. {name}  [{scores}]{novel}")
        if title:
            emit("system", "log", f"    {title}")
    return {"ok": True, "count": len(ideas)}
