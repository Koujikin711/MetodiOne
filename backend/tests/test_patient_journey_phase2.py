"""Phase 2–4 journey helpers."""

from datetime import UTC, datetime

from app.models.patient_purchase import PatientPurchase
from app.services.patient_journey import month_bucket_for_episode, purchase_is_fulfilled
from decimal import Decimal


def test_month_bucket_relative_to_episode_start():
    start = datetime(2026, 1, 1, tzinfo=UTC)
    assert month_bucket_for_episode(start, datetime(2026, 1, 15, tzinfo=UTC)) == 1
    assert month_bucket_for_episode(start, datetime(2026, 2, 5, tzinfo=UTC)) == 2
    assert month_bucket_for_episode(start, datetime(2026, 3, 10, tzinfo=UTC)) == 3
    assert month_bucket_for_episode(start, datetime(2026, 6, 1, tzinfo=UTC)) == 3


def test_purchase_fulfilled():
    p = PatientPurchase(
        id=1,
        company_id=1,
        source_type="kpi_manual_sale",
        source_id=1,
        product_kind="course_15",
        product_name="Курс 15",
        service_amount=Decimal("1300"),
        paid_amount=Decimal("1300"),
        status="active",
    )
    assert purchase_is_fulfilled(p) is True
    p.paid_amount = Decimal("100")
    assert purchase_is_fulfilled(p) is False
    p.status = "returned"
    assert purchase_is_fulfilled(p) is False
