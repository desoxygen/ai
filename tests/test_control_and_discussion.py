"""Тесты дискуссии (интерактивный исследовательский REPL)."""
from ai_scientist import discussion
from ai_scientist.discussion import DiscussionSession


def test_send_records_messages_and_history(fake_llm):
    fake_llm("ai_scientist.discussion")
    fake_llm.responses.append("Первая реплика ассистента")
    s = DiscussionSession(topic="т", model="fake")
    out = s.send("привет")
    assert out == "Первая реплика ассистента"
    assert s.messages == [("user", "привет"), ("assistant", out)]
    assert fake_llm.calls == ["привет"]
    # вторая реплика получает историю
    fake_llm.responses.append("вторая")
    s.send("ещё")
    assert len(s._msg_history) == 4  # 2 пары user/assistant


def test_save_to_obsidian(tmp_vault, fake_llm):
    fake_llm("ai_scientist.discussion")
    s = DiscussionSession(topic="тест сохранения", model="fake")
    s.send("вопрос")
    path = s.save_to_obsidian()
    from pathlib import Path
    txt = Path(path).read_text(encoding="utf-8")
    assert "вопрос" in txt and "тест сохранения" in txt
    from ai_scientist import settings
    j = (settings.obsidian_root() / "Journal.md").read_text(encoding="utf-8")
    assert "Дискуссия" in j


def test_load_template_context(tmp_vault):
    s = DiscussionSession(model="fake", template="nanoGPT_lite")
    ctx = s.load_template_context("nanoGPT_lite")
    assert "Task description" in ctx
    assert s.topic  # тема подставилась

