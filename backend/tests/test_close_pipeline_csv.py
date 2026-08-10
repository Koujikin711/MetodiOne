from app.services.close_pipeline import (
    ascii_filename_fallback,
    attachment_content_disposition,
    safe_filename_part,
)


def test_safe_filename_part_strips_unsafe():
    assert " " not in safe_filename_part("A B/C")
    assert safe_filename_part("!!!") == "pipeline"
    assert len(safe_filename_part("x" * 100)) <= 48


def test_attachment_content_disposition_latin1_safe():
    name = "voronka_Воронка_Тест_leads_20260810.csv"
    header = attachment_content_disposition(name)
    # Starlette encodes header values as latin-1 — must not raise
    header.encode("latin-1")
    assert "filename=" in header
    assert "filename*=UTF-8''" in header
    assert "%D0%92" in header  # URL-encoded Cyrillic
    assert ascii_filename_fallback(name).isascii()
