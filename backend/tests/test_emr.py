"""ЭМК: openapi, классификация услуг, chips только completed."""

from fastapi.testclient import TestClient

from app.main import app
from app.services.emr_chart import build_service_chips, classify_service, visit_kind


def test_emr_openapi_paths():
    client = TestClient(app)
    r = client.get("/openapi.json")
    assert r.status_code == 200
    paths = r.json()["paths"]
    assert "/api/emr/search" in paths
    assert "/api/emr/{lead_id}" in paths


def test_classify_service_keywords():
    assert classify_service("ЭЭГ", None) == "eeg"
    assert classify_service(None, "Массаж спины") == "massage"
    assert classify_service("ТМС", "") == "tms"
    assert classify_service("Остеопатия", None) == "osteo"
    assert classify_service("Неврология", "Консультация") == "consult"
    assert classify_service("Прочее", "Капельница") == "other"


def test_visit_kind():
    assert visit_kind("ЭЭГ", None) == "diag"
    assert visit_kind(None, "Массаж") == "proc"
    assert visit_kind("Неврология", "Приём") == "visit"


def test_chips_count_only_completed():
    rows = [
        ("ЭЭГ", None, "completed"),
        ("ЭЭГ", None, "booked"),
        ("Массаж", None, "completed"),
        ("Массаж", None, "cancelled"),
        ("Неврология", "Консультация", "completed"),
    ]
    chips = {c["key"]: c["count"] for c in build_service_chips(rows)}
    assert chips["eeg"] == 1
    assert chips["massage"] == 1
    assert chips["consult"] == 1
    assert "amount" not in chips
