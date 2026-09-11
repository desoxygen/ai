"""assistant — модель вызывает команды пайплайна КАК тулзы.

Идея: исследователю не нужно знать `/run`, `/paper`, `/skeleton` — он
формулирует задачу словами, а LLM сам выбирает инструменты из
ModuleRegistry (каждый manifest модуля превращается в OpenAI tool spec).
Каждый вызов инструмента — это обычный job через `execute_job`: он попадает
в jobs.jsonl, на Dashboard, под loop-guard'и и single-flight — то есть
"тулза модели" это ровно тот же безопасный путь, что и команда.

Headless entry: `aiscientist -q ask --task "..." [--model M]`.
"""
import json
import re

from ai_scientist import settings
from ai_scientist.console.jobs import JobRegistry
from ai_scientist.console.registry import ModuleRegistry
from ai_scientist.console.runner import execute_job

# model-visible tool name -> registry module. Commands are hidden plumbing;
# these are the only research verbs the model is allowed to pull.
TOOL_MODULES = {
    "run_pipeline": "pipeline/run",
    "write_paper": "writeup/paper",
    "skeleton_project": "generate/skeleton",
    "last_report": "report/last",
    "doctor": "auxiliary/env",
    "list_ideas": "auxiliary/ideas",
}

_OPTION_TYPES = {"str": "string", "int": "integer", "csv": "string", "choice": "string"}


def list_templates():
    root = settings.PROJECT_ROOT / "templates"
    try:
        return sorted(
            d.name for d in root.iterdir()
            if d.is_dir() and not d.name.startswith(("_", "."))
        )
    except OSError:
        return []


def tool_specs():
    """ModuleRegistry manifests -> OpenAI function-calling tool schemas."""
    reg = ModuleRegistry()
    specs = []
    for tool_name, mod_name in TOOL_MODULES.items():
        mod = reg.get(mod_name)
        if mod is None:
            continue
        props, required = {}, []
        for key, spec in (mod.manifest.get("options") or {}).items():
            p = {"type": _OPTION_TYPES.get(spec.get("type", "str"), "string"),
                 "description": f"option {key}"}
            if spec.get("choices"):
                p["enum"] = list(spec["choices"])
            props[key] = p
            if spec.get("required"):
                required.append(key)
        specs.append({
            "type": "function",
            "function": {
                "name": tool_name,
                "description": mod.manifest.get("description", tool_name),
                "parameters": {"type": "object", "properties": props,
                               "required": required},
            },
        })
    return specs


def system_prompt(model_note=""):
    tpls = ", ".join(list_templates()) or "(нет ни одного шаблона)"
    return (
        "You are the research director of the AI-Scientist pipeline: ideas -> novelty -> "
        "experiments -> writeup -> review -> improve. The user states a research goal in "
        "plain language; you achieve it with the provided tools instead of asking them to "
        "type commands.\n"
        f"Available project templates (research domains): {tpls}.\n"
        "Guidance:\n"
        "- 'run a study / try idea X on project Y' -> run_pipeline (choose STAGES: ideas,"
        " novelty, experiments, writeup, review; add IMPROVE=on for a full paper loop).\n"
        "- 'write/repair the paper, raise the review score' -> write_paper with IMPROVE=on.\n"
        "- 'start a new research direction Z' -> skeleton_project (NAME ascii lowercase, DESCRIPTION rich).\n"
        "- 'what did the last run give' -> last_report; 'is everything set up' -> doctor.\n"
        "- Tools are synchronous and may take minutes; one pipeline at a time per template is enforced.\n"
        "- Never invent results: only report what a tool returned. After tools finish, answer in the "
        "user's language, briefly, with the job ids and the next concrete step.\n"
        "- If the request is just a question, answer without tools."
        + (f"\n{model_note}" if model_note else "")
    )


def _api_model(model: str) -> str:
    # mirror ai_scientist.llm: provider prefixes are stripped before the API call
    if "/" in model and model.split("/", 1)[0] in ("openrouter", "ollama", "deepseek", "bedrock", "vertex_ai"):
        return model.split("/", 1)[1]
    return model


_TC_JSON = re.compile(r"<tool_call\s*>\s*(\{.*?\})\s*(?:<\|?im_end\|?>|</tool_call\s*>)", re.S)
# bare {"name": "<known tool>", "arguments": {...}} emitted inline as text — some
# runtimes (notably Ollama's OpenAI shim) put the call in `content`, not `tool_calls`.
_BARE_TC = re.compile(r"(\{\s*\\?\"name\\?\"\s*:\s*\\?\"[a-z_]+\\?\"\s*,\s*\\?\"arguments\\?\"\s*:\s*\{.*?\}\s*\})", re.S)


def parse_text_tool_calls(content):
    """Salvage tool calls a model emitted as plain text (Ollama shims, hermes tags).

    Returns a list of {"id","name","arguments":dict}. Only recognised tool names
    qualify, so a normal answer that merely mentions JSON is not hijacked.
    """
    if not content:
        return []
    out, seen = [], 0
    # a hermes-wrapped call is also matched by _BARE_TC — dedupe identical blobs
    for blob in dict.fromkeys(_TC_JSON.findall(content) + _BARE_TC.findall(content)):
        try:
            obj = json.loads(blob)
        except json.JSONDecodeError:
            cleaned = re.sub(r"\s+", " ", blob)
            try:
                obj = json.loads(cleaned)
            except json.JSONDecodeError:
                continue
        name = obj.get("name")
        args = obj.get("arguments", obj.get("parameters", {}))
        if name in TOOL_MODULES and isinstance(args, (dict, str)):
            if isinstance(args, str):
                try:
                    args = json.loads(args or "{}")
                except json.JSONDecodeError:
                    args = {}
            seen += 1
            out.append({"id": f"text{seen}", "name": name, "arguments": args})
    return out


def execute_tool(tool_name: str, args: dict, jobs=None, printer=None):
    """Run one model tool call as a real, guarded job. Returns the tool-result dict."""
    jobs = jobs or JobRegistry()
    reg = ModuleRegistry()
    mod = reg.get(TOOL_MODULES[tool_name])
    options = {}
    for key, spec in (mod.manifest.get("options") or {}).items():
        val = args.get(key, spec.get("default", ""))
        if val is True:
            val = "on"
        elif val is False:
            val = "off"
        if val != "":
            options[key] = val
    code = execute_job(mod, options, jobs, printer)
    job = jobs.last_or_current()
    return {
        "tool": tool_name,
        "exit_code": code,
        "job_id": getattr(job, "id", None),
        "job_status": getattr(job, "status", "unknown"),
        "options": {k: str(v)[:120] for k, v in options.items()},
    }


def ask(task: str, model: str = "", max_steps: int = 8, emit=None, printer=None) -> dict:
    """The tool loop: user goal in, tools fired by the model, answer out.

    Returns {"ok", "answer", "tool_calls", "job_ids"}. Raises ValueError for
    non-OpenAI-compatible routers (tools are part of the chat.completions API).
    """
    from ai_scientist import openrouter
    from ai_scientist.llm import create_client

    model = (model or "").strip() or openrouter.default_model()
    client, client_model = create_client(model)
    if not hasattr(client, "chat"):
        raise ValueError(
            "the research assistant needs an OpenAI-compatible router "
            "(OpenRouter / Ollama / DeepSeek); Claude-direct routers are supported "
            "for pipeline stages but not for /ask tools yet")
    emit = emit or (lambda *a, **k: None)

    messages = [{"role": "user", "content": task}]
    tools = tool_specs()
    tool_calls, job_ids = [], []
    for step in range(max_steps):
        resp = client.chat.completions.create(
            model=_api_model(client_model),
            messages=[{"role": "system", "content": system_prompt()}, *messages],
            tools=tools,
            tool_choice="auto",
            temperature=0.3,
        )
        msg = resp.choices[0].message
        raw_calls = getattr(msg, "tool_calls", None) or []
        calls = []
        for c in raw_calls:  # native OpenAI function-calling
            try:
                args = json.loads(c.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            calls.append({"id": c.id, "name": c.function.name, "arguments": args,
                          "echo": c.model_dump()})
        if not calls:
            # Some routers (Ollama's OpenAI shim, hermes-tagged local models)
            # put the call in `content` as text. Salvage it so /ask works
            # everywhere, but only for recognised tool names.
            calls = [{"id": tc["id"], "name": tc["name"], "arguments": tc["arguments"], "echo": None}
                     for tc in parse_text_tool_calls(msg.content)]
        if not calls:
            answer = (msg.content or "").strip()
            emit("ask", "done", answer[:200] or "(empty)")
            return {"ok": True, "answer": answer, "tool_calls": tool_calls, "job_ids": job_ids}
        if raw_calls:
            messages.append({"role": "assistant", "content": msg.content or "",
                             "tool_calls": [c["echo"] for c in calls]})
        else:
            messages.append({"role": "assistant", "content": msg.content or ""})
        for c in calls:
            name, args = c["name"], c["arguments"]
            emit("ask", "log", f"tool → {name} {json.dumps(args, ensure_ascii=False)[:180]}")
            if name not in TOOL_MODULES:
                result = {"error": f"unknown tool {name!r}"}
            else:
                try:
                    result = execute_tool(name, args, printer=printer)
                    if result.get("job_id"):
                        job_ids.append(result["job_id"])
                except Exception as e:  # tool failure is data, not a crash
                    result = {"error": str(e)[:300]}
            tool_calls.append({"tool": name, "args": args, "result": result})
            messages.append({"role": "tool", "tool_call_id": c["id"],
                             "content": json.dumps(result, ensure_ascii=False)[:4000]})
        emit("ask", "log", f"step {step + 1}: {len(calls)} tool call(s) executed")
    emit("ask", "fail", f"tool budget exhausted after {max_steps} steps")
    return {"ok": False, "answer": "", "tool_calls": tool_calls, "job_ids": job_ids,
            "error": f"max_steps={max_steps} reached without a final answer"}
