"""Тесты журнала куратора: модели, openapi, статусы."""

from datetime import date

from fastapi.testclient import TestClient

from app.main import app
from app.models.curator_journal import (
    CuratorCourseFlow,
    CuratorFlowMembership,
    CuratorJournalComplaint,
    CuratorJournalEntry,
)
from app.schemas.curator_journal import COMPLAINT_CATEGORIES, CuratorFlowCreate
from app.services.curator_journal_access import can_access_curator_journal, can_manage_all_flows
from app.models import UserRole


def test_curator_journal_openapi_paths():
    client = TestClient(app)
    r = client.get("/openapi.json")
    assert r.status_code == 200
    paths = r.json()["paths"]
    assert "/api/curator-journal/flows" in paths
    assert "/api/curator-journal/flows/{flow_id}/month" in paths
    assert "/api/curator-journal/flows/{flow_id}/entries" in paths


def test_curator_journal_tables_mapped():
    assert CuratorCourseFlow.__tablename__ == "curator_course_flows"
    assert CuratorFlowMembership.__tablename__ == "curator_flow_memberships"
    assert CuratorJournalEntry.__tablename__ == "curator_journal_entries"
    assert CuratorJournalComplaint.__tablename__ == "curator_journal_complaints"


def test_complaint_categories_complete():
    expected = {
        "temperature",
        "vomiting",
        "stool",
        "sleep",
        "nutrition",
        "medication",
        "recommendations",
        "weight",
        "pain",
        "rash_or_allergy",
        "other",
    }
    assert set(COMPLAINT_CATEGORIES) == expected


def test_flow_create_schema_period():
    ok = CuratorFlowCreate(
        course_name="Основной курс",
        flow_number=12,
        starts_on=date(2026, 9, 15),
        ends_on=date(2026, 12, 15),
    )
    assert ok.flow_number == 12


def test_journal_role_access_matrix():
    assert can_access_curator_journal(UserRole.curator)
    assert can_access_curator_journal(UserRole.administrator)
    assert can_access_curator_journal(UserRole.owner)
    assert not can_access_curator_journal(UserRole.manager)
    assert not can_manage_all_flows(UserRole.curator)
    assert can_manage_all_flows(UserRole.administrator)
