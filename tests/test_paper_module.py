"""writeup/paper — discovery, folder resolution and argument mapping."""
import os
import time

import pytest

from ai_scientist.console.modules.writeup import paper
from ai_scientist.console.registry import ModuleRegistry


def test_module_registered():
    mod = ModuleRegistry().get("writeup/paper")
    assert mod is not None
    assert "paper" in mod.description.lower() or "write" in mod.description.lower()


def test_manifest_defaults():
    assert paper.MANIFEST["options"]["STAGES"]["default"] == "writeup,review"
    assert paper.MANIFEST["options"]["TEMPLATE"]["required"] is True


def test_latest_folder_picks_newest_with_notes(tmp_path):
    old = tmp_path / "20260101_old"
    new = tmp_path / "20260102_new"
    skipped = tmp_path / "20260103_no_notes"
    for d in (old, new, skipped):
        d.mkdir()
    (old / "notes.txt").write_text("x", encoding="utf-8")
    (new / "notes.txt").write_text("y", encoding="utf-8")
    time.sleep(0.02)
    os.utime(new, None)
    assert paper._latest_folder(str(tmp_path)) == str(new)
    assert paper._latest_folder(str(skipped)) == ""


def test_run_requires_existing_template_and_folder(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "templates" / "foo").mkdir(parents=True)
    with pytest.raises(ValueError, match="not found"):
        paper.run({"TEMPLATE": "foo", "FOLDER": "nope"}, None, lambda *a, **k: None)
    with pytest.raises(ValueError, match="not set"):
        paper.run({"TEMPLATE": ""}, None, lambda *a, **k: None)
