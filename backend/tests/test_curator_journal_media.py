"""Тесты хранилища фото дневника куратора."""

from pathlib import Path

import pytest

from app.services.curator_journal_media import (
    delete_curator_photo,
    resolve_curator_photo,
    save_curator_photo,
)


def test_save_and_resolve_curator_photo(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.curator_journal_media.curator_journal_media_directory",
        lambda: tmp_path,
    )
    name, mime = save_curator_photo(42, "shot.JPG", b"\xff\xd8\xfffake", mime="image/jpeg")
    assert name == "42.jpg"
    assert mime == "image/jpeg"
    path = resolve_curator_photo(name)
    assert path is not None
    assert path.read_bytes().startswith(b"\xff\xd8")
    delete_curator_photo(name)
    assert resolve_curator_photo(name) is None


def test_reject_non_image(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.curator_journal_media.curator_journal_media_directory",
        lambda: tmp_path,
    )
    with pytest.raises(ValueError, match="изображен"):
        save_curator_photo(1, "a.pdf", b"%PDF", mime="application/pdf")


def test_reject_path_traversal():
    assert resolve_curator_photo("../etc/passwd") is None
    assert resolve_curator_photo("a/b.jpg") is None
