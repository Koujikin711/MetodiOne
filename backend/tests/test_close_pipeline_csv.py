from app.services.close_pipeline import safe_filename_part


def test_safe_filename_part_strips_unsafe():
    assert " " not in safe_filename_part("A B/C")
    assert safe_filename_part("!!!") == "pipeline"
    assert len(safe_filename_part("x" * 100)) <= 48
