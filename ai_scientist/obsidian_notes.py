"""Obsidian notes for AI-Scientist.

All notes live inside the user's vault under AI/AI-Scientist/:
  Projects/<template>/<run_id>/Overview.md   — run overview with statuses
  Ideas/<template>__<idea_name>.md           — one note per research idea
  Discussions/<date>_<topic>.md              — saved discussion transcripts
  Journal.md                                 — chronological activity log

Notes use YAML frontmatter, tags and wiki-links so they blend into the graph.
"""
import datetime
import json
import re
from pathlib import Path

from ai_scientist import settings


def _now():
    return datetime.datetime.now()


def sanitize(name: str, maxlen: int = 80) -> str:
    name = re.sub(r'[\\/:*?"<>|#^\[\]]', "_", str(name))
    name = re.sub(r"\s+", " ", name).strip().strip(".")
    return name[:maxlen] or "untitled"


def _fm(fields: dict) -> str:
    lines = ["---"]
    for k, v in fields.items():
        if isinstance(v, bool):
            v = "true" if v else "false"
        if isinstance(v, list):
            lines.append(f"{k}:")
            lines.extend(f"  - {x}" for x in v)
        elif v is None:
            lines.append(f"{k}: ")
        elif isinstance(v, (int, float)):
            lines.append(f"{k}: {v}")
        else:
            s = str(v).replace('"', "'")
            lines.append(f'{k}: "{s}"')
    lines.append("---")
    return "\n".join(lines)


def write_note(rel_path: str, content: str, overwrite=False) -> Path:
    root = settings.obsidian_root(create=True)
    path = root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not overwrite:
        stem, suffix = path.stem, path.suffix
        i = 2
        while path.exists():
            path = path.with_name(f"{stem} {i}{suffix}")
            i += 1
    path.write_text(content, encoding="utf-8")
    return path


def read_note(rel_path: str) -> str:
    return (settings.obsidian_root() / rel_path).read_text(encoding="utf-8")


def append_journal(message: str):
    stamp = _now().strftime("%Y-%m-%d %H:%M")
    root = settings.obsidian_root(create=True)
    path = root / "Journal.md"
    if not path.exists():
        path.write_text("# 📓 Журнал AI-Scientist\n", encoding="utf-8")
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"- **{stamp}** — {message}\n")


def idea_rel_link(idea_name: str, template: str) -> str:
    """Wiki-link target for an idea note (vault-relative, no extension)."""
    return f"AI/AI-Scientist/Ideas/{sanitize(template)}__{sanitize(idea_name)}"


def idea_note_path(idea_name: str, template: str) -> Path:
    return settings.obsidian_root() / "Ideas" / f"{sanitize(template)}__{sanitize(idea_name)}.md"


def write_idea_note(template: str, idea: dict, run_id: str = "", status: str = "new") -> Path:
    name = idea.get("Name", "idea")
    scores = {k: idea.get(k) for k in ("Interestingness", "Feasibility", "Novelty")}
    score_line = " | ".join(f"{k}: {v}" for k, v in scores.items() if v is not None)
    fm = _fm({
        "tags": ["ai-scientist", "idea", template],
        "template": template,
        "status": status,
        "run_id": run_id,
        "interestingness": idea.get("Interestingness"),
        "feasibility": idea.get("Feasibility"),
        "novelty_score": idea.get("Novelty"),
        "novel": idea.get("novel"),
        "created": _now().strftime("%Y-%m-%d %H:%M"),
    })
    body = f"""# {idea.get('Title', name)}

> [!info] Идея исследования, сгенерированная AI-Scientist
> {score_line}{' | Novelty check: ' + str(idea.get('novel')) if 'novel' in idea else ''}

## Суть
**Name:** `{name}`

## План эксперимента
{idea.get('Experiment', '—')}

## Статус выполнения
- [ ] Эксперименты
- [ ] Статья
- [ ] Рецензия

## Результаты
_Заполняется пайплайном по мере выполнения._

"""
    path = write_note(f"Ideas/{sanitize(template)}__{sanitize(name)}.md", fm + "\n" + body,
                      overwrite=True)
    append_journal(f"Идея [[{idea_rel_link(name, template)}|{name}]] создана ({template}, status={status})")
    return path


def update_idea_status(template: str, idea_name: str, status: str,
                       checklist: dict = None, review: dict = None, error: str = ""):
    path = idea_note_path(idea_name, template)
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"^status: \"?[^\"]*\"?", f'status: "{status}"', text, count=1, flags=re.M)
    mapping = checklist or {}
    for key in ("Эксперименты", "Статья", "Рецензия"):
        state = mapping.get(key, None)
        if state is None:
            continue
        mark = "x" if state is True else ("-" if state == "skip" else " ")
        text = text.replace(f"- [ ] {key}", f"- [{mark}] {key}", 1)
    if review:
        rev = json.dumps(review, ensure_ascii=False, indent=2)
        text += f"\n## Рецензия\n```json\n{rev[:4000]}\n```\n"
    if error:
        text += f"\n> [!warning] Ошибка\n> {error[:500]}\n"
    path.write_text(text, encoding="utf-8")
    append_journal(f"Идея [[{idea_rel_link(idea_name, template)}|{idea_name}]] → status: **{status}**"
                   + (f" ({error[:80]})" if error else ""))
    return path


def write_discussion_note(topic: str, model: str, messages: list) -> Path:
    stamp = _now().strftime("%Y-%m-%d %H:%M")
    slug = sanitize(topic or "discussion", 40).replace(" ", "_")
    lines = [
        _fm({
            "tags": ["ai-scientist", "discussion"],
            "topic": topic or "свободная дискуссия",
            "model": model,
            "date": stamp,
            "turns": len(messages),
        }),
        f"# 💬 Дискуссия: {topic or 'свободная'}",
        f"*{stamp} · модель: `{model}` · реплик: {len(messages)}*",
        "",
    ]
    for role, text in messages:
        who = "🧑 Вы" if role == "user" else "🤖 AI"
        text = text.replace("[[", "\\[\\[").replace("]]", "\\]\\]")
        lines.append(f"### {who}")
        lines.append(text.strip())
        lines.append("")
    return write_note(f"Discussions/{_now().strftime('%Y-%m-%d')}_{sanitize(slug)}.md",
                      "\n".join(lines))


def write_run_overview(template: str, run_id: str, model: str, ideas: list,
                       statuses: dict, results_dir: str = "", notes: str = "") -> Path:
    rows = []
    for idea in ideas:
        name = idea.get("Name", "?")
        st = statuses.get(name, {})
        link = f"[[{idea_rel_link(name, template)}|{name}]]"
        rows.append(
            f"| {link} | {idea.get('Interestingness', '—')} | {idea.get('Feasibility', '—')} "
            f"| {idea.get('novel', '—')} | {st.get('status', '—')} | {st.get('note', '')} |"
        )
    content = f"""{_fm({
        "tags": ["ai-scientist", "run", template],
        "template": template,
        "run_id": run_id,
        "model": model,
        "date": _now().strftime("%Y-%m-%d %H:%M"),
        "ideas_total": len(ideas),
    })}
# 🚀 Прогон «{template}» ({run_id})

**Модель:** `{model}`  **Результаты:** `{results_dir or '—'}`

| Идея | Int | Feas | Novel | Статус | Заметка |
|---|---|---|---|---|---|
{chr(10).join(rows) if rows else '| — | | | | | |'}

## Журнал прогона
{notes or '—'}

Связанные: [[AI/AI-Scientist/Journal|Журнал]]
"""
    path = write_note(f"Projects/{sanitize(template)}/{sanitize(run_id)}.md", content,
                      overwrite=True)
    append_journal(f"Прогон «{template}» ({run_id}) завершён — "
                   f"[[AI/AI-Scientist/Projects/{sanitize(template)}/{sanitize(run_id)}|обзор]]")
    return path


def append_experiment_results(template: str, idea_name: str, folder_name) -> dict:
    """Собирает метрики из run_*/final_info.json и пишет их в заметку идеи.

    Возвращает {"runs": N, "note": path} или None, если метрик нет.
    """
    folder = Path(folder_name)
    runs = []
    for d in folder.glob("run_*"):
        if not d.is_dir() or not re.fullmatch(r"run_\d+", d.name):
            continue
        info = d / "final_info.json"
        if not info.exists():
            continue
        try:
            data = json.loads(info.read_text(encoding="utf-8"))
            means = {k: v.get("means", v) for k, v in data.items()
                     if isinstance(v, dict)}
            runs.append((d.name, means))
        except Exception:
            continue
    if not runs:
        return None

    def fmt(v):
        try:
            return f"{float(v):.4g}"
        except (TypeError, ValueError):
            return str(v)[:40]

    lines = [f"### Метрики экспериментов ({_now().strftime('%Y-%m-%d %H:%M')})"]
    for run_name, means in runs:
        lines.append(f"**{run_name}**")
        for k, v in means.items():
            if isinstance(v, dict):
                v = ", ".join(f"{kk}: {fmt(vv)}" for kk, vv in list(v.items())[:8])
            else:
                v = fmt(v)
            lines.append(f"- {k}: {v}")

    path = idea_note_path(idea_name, template)
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    block = "\n".join(lines) + "\n"
    placeholder = "_Заполняется пайплайном по мере выполнения._"
    if placeholder in text:
        text = text.replace("## Результаты\n" + placeholder,
                            "## Результаты\n\n" + block)
    else:
        text += "\n" + block
    path.write_text(text, encoding="utf-8")
    return {"runs": len(runs), "note": str(path)}


def sync_ideas_from_json(template_base_dir: str, template: str, run_id: str = "") -> list:
    """Create/update Obsidian notes for every idea in <template>/ideas.json."""
    ideas_file = Path(template_base_dir) / "ideas.json"
    if not ideas_file.exists():
        return []
    ideas = json.loads(ideas_file.read_text(encoding="utf-8"))
    paths = []
    for idea in ideas:
        if not isinstance(idea, dict) or "Name" not in idea:
            continue
        paths.append(write_idea_note(template, idea, run_id=run_id,
                                     status=idea.get("status", "new")))
    return paths


def open_vault_in_explorer():
    try:
        import subprocess
        win_path = settings.vault_win_path()
        subprocess.run(["cmd.exe", "/c", "start", "", win_path], check=False)
        return win_path
    except Exception as e:
        return f"Не удалось открыть: {e}"
