"""Тесты settings: .env-парсер, маскирование секретов, конвертация путей."""
import os


from ai_scientist import settings


def test_load_dotenv_parses_quotes_and_comments(tmp_path):
    env = tmp_path / ".env"
    env.write_text(
        "# комментарий\n"
        "A=1\n"
        "B = \"значение с пробелами\" \n"
        "C='одинарные'\n"
        "export D=4\n"
        "\n"
        "без_равно\n",
        encoding="utf-8",
    )
    loaded = settings.load_dotenv(env, override=True)
    assert loaded["A"] == "1"
    assert loaded["B"] == "значение с пробелами"
    assert loaded["C"] == "одинарные"
    assert loaded["D"] == "4"


def test_load_dotenv_does_not_override_existing(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("X=from_file\n", encoding="utf-8")
    monkeypatch.setenv("X", "from_env")
    settings.load_dotenv(env, override=False)
    assert os.environ["X"] == "from_env"
    settings.load_dotenv(env, override=True)
    assert os.environ["X"] == "from_file"
    monkeypatch.delenv("X")


def test_mask_secret():
    assert settings.mask_secret("") == "(не задан)"
    assert settings.mask_secret("abc") == "***"
    s = settings.mask_secret("sk-1234567890abcdef")
    assert s.startswith("sk-123") and "…" in s and s.endswith("*" * 8)


def test_win_to_wsl_and_back():
    import sys
    src = "C:\\Users\\test\\Documents\\root"
    native = settings._win_to_wsl(src)
    if sys.platform == "win32":
        assert native.as_posix() == "C:/Users/test/Documents/root"
        assert native.is_absolute()
        assert settings._wsl_to_win(native) == str(native)
    else:
        assert str(native) == "/mnt/c/Users/test/Documents/root"
        assert settings._wsl_to_win("/mnt/c/Users/test/Documents/root") == src
    # non-mappable path passes through unchanged
    assert settings._wsl_to_win("/home/user/x") == "/home/user/x"


def test_save_env_value_replaces_and_appends(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "PROJECT_ROOT", tmp_path)
    settings.save_env_value("KEY1", "a")
    settings.save_env_value("KEY1", "b")
    settings.save_env_value("KEY2", "c")
    text = (tmp_path / ".env").read_text(encoding="utf-8")
    assert "KEY1=b" in text and "KEY1=a" not in text
    assert "KEY2=c" in text
    assert os.environ["KEY1"] == "b"


def test_guard_reload_from_env(monkeypatch):
    monkeypatch.setenv("AISC_LLM_MAX_TRIES", "3")
    g = settings.reload_guard()
    assert g.llm_max_tries == 3
    monkeypatch.setenv("AISC_LLM_MAX_TRIES", "8")
    settings.reload_guard()


def test_get_vault_path_env_wins(tmp_vault):
    assert settings.get_vault_path().is_absolute()
    assert "vault" in str(settings.get_vault_path())
