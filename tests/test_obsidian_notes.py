"""Тесты Obsidian-заметок: frontmatter, статусы, метрики, дискуссии, обзор."""
import json

from ai_scientist import obsidian_notes as on
from ai_scientist import settings


IDEA = {"Name": "idea_one", "Title": "Первая идея", "Experiment": "делаем раз",
        "Interestingness": 7, "Feasibility": 8, "Novelty": 6, "novel": True}


def test_sanitize_strips_bad_chars():
    assert on.sanitize('a/b\\c:d*e?f"g<h>i|j') == "a_b_c_d_e_f_g_h_i_j"
    assert on.sanitize("") == "untitled"
    assert len(on.sanitize("x" * 300)) == 80


def test_write_note_dedup_naming(tmp_vault):
    p1 = on.write_note("Ideas/dup.md", "первый")
    p2 = on.write_note("Ideas/dup.md", "второй")
    assert p1.exists() and p2.exists()
    assert p1 != p2
    assert p1.read_text(encoding="utf-8") == "первый"


def test_idea_note_and_status_update(tmp_vault):
    p = on.write_idea_note("tpl", IDEA, run_id="R1", status="new")
    txt = p.read_text(encoding="utf-8")
    assert "Первая идея" in txt and 'status: "new"' in txt and "- [ ] Эксперименты" in txt

    on.update_idea_status("tpl", "idea_one", "reviewed",
                          checklist={"Эксперименты": True, "Статья": True, "Рецензия": True},
                          review={"Overall": 7})
    txt = p.read_text(encoding="utf-8")
    assert 'status: "reviewed"' in txt
    assert "- [x] Эксперименты" in txt and "- [x] Статья" in txt and "- [x] Рецензия" in txt
    assert '"Overall": 7' in txt


def test_journal_appends(tmp_vault):
    on.append_journal("первое")
    on.append_journal("второе")
    j = (settings.obsidian_root() / "Journal.md").read_text(encoding="utf-8")
    assert "первое" in j and "второе" in j


def test_discussion_note_escapes_wikilinks(tmp_vault):
    p = on.write_discussion_note("тема", "m", [("user", "см. [[Чужая заметка]]")])
    txt = p.read_text(encoding="utf-8")
    assert "\\[\\[Чужая заметка\\]\\]" in txt


def test_run_overview_writes(tmp_vault):
    p = on.write_run_overview("tpl", "RUN1", "model-x", [IDEA],
                              {"idea_one": {"status": "done", "note": "ок"}})
    txt = p.read_text(encoding="utf-8")
    assert "Прогон «tpl»" in txt and "idea_one" in txt and "done" in txt


def test_append_experiment_results(tmp_vault, tmp_path):
    p = on.write_idea_note("tpl", IDEA, run_id="R", status="experiments")
    folder = tmp_path / "runfolder"
    for i, metrics in enumerate((
        {"gpt": {"means": {"loss": 3.14, "acc": 0.42}}},
        {"gpt": {"means": {"loss": 2.71}}},
    ), start=1):
        rd = folder / f"run_{i}"
        rd.mkdir(parents=True)
        (rd / "final_info.json").write_text(json.dumps(metrics), encoding="utf-8")
    # "мусорная" папка, которую надо игнорировать
    junk = folder / "run_junk"
    junk.mkdir()
    (junk / "final_info.json").write_text("{}", encoding="utf-8")

    res = on.append_experiment_results("tpl", "idea_one", folder)
    assert res and res["runs"] == 2
    txt = p.read_text(encoding="utf-8")
    assert "Метрики экспериментов" in txt
    assert "loss: 3.14" in txt and "run_2" in txt
    # повторное добавление — не портит заметку
    on.append_experiment_results("tpl", "idea_one", folder)
    assert txt.count("## Результаты") <= 2


def test_append_experiment_results_no_note(tmp_vault, tmp_path):
    assert on.append_experiment_results("tpl", "нет_такой", tmp_path) is None
