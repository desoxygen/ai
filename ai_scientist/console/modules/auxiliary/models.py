"""auxiliary/models — browse and select OpenRouter models.

Headless module invoked via the runner (`aiscientist -q search models`); the
TUI has its own model picker. Returns the filtered catalog through the event
stream.
"""
import os

MANIFEST = {
    "type": "auxiliary",
    "description": "browse and select LLM models (OpenRouter, Ollama, direct)",
    "options": {
        "FILTER": {"required": False, "type": "str", "default": "",
                   "description": "search query to filter models"},
    },
}


def run(options, job, emit, stop_event=None):
    from ai_scientist import settings
    from ai_scientist.console.i18n import get as _t
    from ai_scientist import openrouter

    current = os.environ.get("AISC_DEFAULT_MODEL", "")
    emit("system", "log", f"current model: {current or '(not set)'}")
    emit("system", "log", "")

    query = (options.get("FILTER") or "").strip()

    try:
        if query:
            models = openrouter.search(query)
            emit("system", "log", f"OpenRouter search '{query}': {len(models)} results")
        else:
            models = openrouter.list_models()
            emit("system", "log", f"OpenRouter: {len(models)} models available")
    except Exception as e:
        emit("system", "log", f"OpenRouter catalog error: {e}")
        emit("system", "log", "Tip: set OPENROUTER_API_KEY in .env for full catalog")
        models = []

    if models:
        # show free models first, then top paid
        free = [m for m in models if openrouter.is_free(m)]
        paid = [m for m in models if not openrouter.is_free(m)]

        if free:
            emit("system", "log", f"\n--- Free models ({len(free)}) ---")
            for m in free[:20]:
                emit("system", "log", f"  {openrouter.describe(m)}")

        if paid and not query:
            emit("system", "log", f"\n--- Top paid models (first 15) ---")
            for m in paid[:15]:
                emit("system", "log", f"  {openrouter.describe(m)}")
        elif paid and query:
            emit("system", "log", f"\n--- Paid matches ({len(paid)}) ---")
            for m in paid[:20]:
                emit("system", "log", f"  {openrouter.describe(m)}")

    emit("system", "log", "")
    emit("system", "log", "To select a model: set MODEL openrouter/<model-id>")
    emit("system", "log", "Or set AISC_DEFAULT_MODEL in .env for persistence")

    # Show other provider hints
    emit("system", "log", "\n--- Other providers ---")
    emit("system", "log", "  Ollama (local):  set MODEL ollama/<model-name>")
    emit("system", "log", "  OpenAI:          set MODEL openai/gpt-4o")
    emit("system", "log", "  Anthropic:       set MODEL anthropic/claude-sonnet-4-20250514")
    emit("system", "log", "  DeepSeek:        set MODEL deepseek/deepseek-chat")
    emit("system", "log", "  Google Gemini:   set MODEL google/gemini-2.0-flash-001")

    return {"ok": True, "count": len(models)}
