"""Interactive research discussion with the LLM.

Runs a REPL chat about a research topic/template, with slash commands:
  /help            — show commands
  /topic <text>    — set or replace the discussion topic
  /idea [N]        — pull context from ideas.json (optionally idea #N)
  /template <name> — load task description + seeds from a template
  /save            — save the transcript to Obsidian (Discussions/…)
  /summary         — one-paragraph summary of the discussion so far
  /exit            — quit (auto-saves if there was any conversation)
"""
import json
import os
import os.path as osp

from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel

from ai_scientist.llm import get_response_from_llm, create_client, AVAILABLE_LLMS
from ai_scientist import obsidian_notes

console = Console()

DISCUSS_SYSTEM = """You are a senior AI research advisor discussing a research topic with a colleague.
Discuss ideas critically and constructively: point out weaknesses, suggest concrete
experiments, datasets, baselines and evaluation metrics; reference relevant literature
when you are confident it exists.
Respond in the same language the user writes in (Russian in → Russian out).
Be concise: prefer a few sharp paragraphs over long essays, unless asked to elaborate.
"""


class DiscussionSession:
    def __init__(self, client=None, model=None, topic: str = "", template: str = ""):
        self.model = model or os.environ.get("AISC_DISCUSS_MODEL") \
            or os.environ.get("AISC_DEFAULT_MODEL") \
            or "openrouter/z-ai/glm-5.2:free"
        self.client, self.client_model = (None, None)
        self.client_ready = False
        self.topic = topic
        self.template = template
        self.messages = []  # [(role, text)] as displayed/saved
        self._msg_history = []  # provider-format history

    # -- context -------------------------------------------------------------
    def _ensure_client(self):
        if not self.client_ready:
            self.client, self.client_model = create_client(self.model)
            self.client_ready = True

    def load_template_context(self, template: str):
        base = osp.join("templates", template)
        ctx = []
        try:
            with open(osp.join(base, "prompt.json"), "r", encoding="utf-8") as f:
                ctx.append("Task description:\n" + json.load(f)["task_description"])
        except Exception as e:
            ctx.append(f"(prompt.json недоступен: {e})")
        try:
            with open(osp.join(base, "ideas.json"), "r", encoding="utf-8") as f:
                ideas = json.load(f)
            ctx.append("Existing ideas:\n" + "\n".join(
                f"- {i.get('Name')}: {i.get('Title', '')}" for i in ideas if isinstance(i, dict)))
        except Exception:
            pass
        self.template = template
        self.topic = self.topic or f"Исследовательское направление «{template}»"
        return "\n\n".join(ctx)

    # -- conversation ----------------------------------------------------------
    def send(self, user_text: str) -> str:
        self._ensure_client()
        self.messages.append(("user", user_text))
        text, self._msg_history = get_response_from_llm(
            user_text,
            client=self.client,
            model=self.client_model,
            system_message=DISCUSS_SYSTEM,
            msg_history=self._msg_history,
            temperature=0.7,
        )
        self.messages.append(("assistant", text))
        return text

    def ask_summary(self) -> str:
        return self.send("/summary: дай краткое резюме нашей дискуссии в 3-5 пунктах. "
                         "(это служебный запрос, просто ответь содержанием)")

    # -- persistence -------------------------------------------------------------
    def save_to_obsidian(self) -> str:
        if not self.messages:
            return "Нечего сохранять."
        path = obsidian_notes.write_discussion_note(self.topic, self.model, self.messages)
        obsidian_notes.append_journal(
            f"Дискуссия «{self.topic or 'свободная'}» сохранена "
            f"({len(self.messages)} реплик, {self.model})")
        return str(path)


HELP = """[bold]/help[/] — команды  ·  [bold]/topic текст[/] — сменить тему
[bold]/idea N[/] — подгрузить идею №N из ideas.json  ·  [bold]/template имя[/] — контекст шаблона
[bold]/save[/] — сохранить в Obsidian  ·  [bold]/summary[/] — резюме дискуссии
[bold]/exit[/] — выход (автосохранение)"""


def run_repl(session: DiscussionSession = None):
    session = session or DiscussionSession()
    console.print(Panel(
        "[bold]Дискуссия по теме исследования[/]\n"
        f"Модель: [cyan]{session.model}[/] · Тема: [cyan]{session.topic or 'не задана'}[/]\n\n" + HELP,
        title="💬 Discussion", border_style="cyan"))
    while True:
        try:
            user = console.input("[bold green]🧑 Вы >[/] ").strip()
        except (EOFError, KeyboardInterrupt):
            user = "/exit"
        if not user:
            continue
        cmd = user.split(" ", 1)
        if cmd[0] == "/exit":
            if session.messages:
                console.print(f"[dim]Сохранено: {session.save_to_obsidian()}[/]")
            break
        elif cmd[0] == "/help":
            console.print(HELP)
        elif cmd[0] == "/topic":
            session.topic = cmd[1] if len(cmd) > 1 else ""
            console.print(f"[cyan]Тема:[/] {session.topic or 'сброшена'}")
        elif cmd[0] == "/template":
            if len(cmd) < 2:
                console.print("[red]Укажите имя шаблона, напр. /template nanoGPT_lite[/]")
                continue
            console.print(Markdown(session.load_template_context(cmd[1].strip())))
        elif cmd[0] == "/idea":
            try:
                with open(osp.join("templates", session.template or ".", "ideas.json")) as f:
                    ideas = json.load(f)
                idx = int(cmd[1]) - 1 if len(cmd) > 1 else None
                idea = ideas[idx] if idx is not None else ideas[-1]
                text = f"Обсудим эту идею:\n{json.dumps(idea, ensure_ascii=False)}"
                console.print(Markdown(session.send(text)))
            except Exception as e:
                console.print(f"[red]Не удалось загрузить идею: {e}[/]")
        elif cmd[0] == "/save":
            console.print(f"[cyan]Сохранено:[/] {session.save_to_obsidian()}")
        elif cmd[0] == "/summary":
            if not session.messages:
                console.print("[yellow]Дискуссия пока пуста.[/]")
            else:
                console.print(Markdown(session.ask_summary()))
        else:
            try:
                reply = session.send(user)
                console.print(Markdown(reply))
            except KeyboardInterrupt:
                console.print("\n[yellow]Прервано.[/]")
            except Exception as e:
                console.print(f"[red]Ошибка LLM: {e}[/]")


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="Research discussion REPL")
    p.add_argument("--model", default=None, choices=AVAILABLE_LLMS)
    p.add_argument("--topic", default="")
    p.add_argument("--template", default="")
    a = p.parse_args()
    run_repl(DiscussionSession(model=a.model, topic=a.topic, template=a.template))
