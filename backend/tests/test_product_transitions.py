"""Product Transitions from consecutive Purchase Events."""

from __future__ import annotations

from datetime import UTC, datetime

from app.services.patient_journey_paths import (
    LeadJourneyFacts,
    LeadPurchaseFact,
    aggregate_product_transitions,
    consecutive_transitions,
    transition_product_key,
)


def _p(kind: str, day: int, name: str | None = None) -> LeadPurchaseFact:
    return LeadPurchaseFact(
        product_kind=kind,
        product_name=name,
        purchased_at=datetime(2026, 1, day, tzinfo=UTC),
    )


def test_transition_key_uses_catalog_name_for_other_service():
    assert transition_product_key(_p("other_service", 1, "Массаж")) == "Массаж"
    assert transition_product_key(_p("main_course", 1, "Курс")) == "main_course"


def test_allows_a_to_a_and_a_to_b():
    f = LeadJourneyFacts(
        purchases=[
            _p("other_service", 1, "TMS"),
            _p("other_service", 5, "TMS"),
            _p("other_service", 10, "Массаж"),
        ],
    )
    edges = consecutive_transitions(f)
    assert edges[0][:2] == ("TMS", "TMS")
    assert edges[1][:2] == ("TMS", "Массаж")
    assert edges[0][2] == 4


def test_aggregate_share_denominator_is_from_out():
    facts = [
        LeadJourneyFacts(
            purchases=[_p("course_15", 1), _p("main_course", 10)],
        ),
        LeadJourneyFacts(
            purchases=[_p("course_15", 2), _p("protocol", 8)],
        ),
        LeadJourneyFacts(
            purchases=[_p("course_15", 3), _p("main_course", 20)],
        ),
    ]
    rows = aggregate_product_transitions(facts, lead_ids=[1, 2, 3])
    by = {(r["from_product"], r["to_product"]): r for r in rows}
    main = by[("course_15", "main_course")]
    proto = by[("course_15", "protocol")]
    assert main["transition_count"] == 2
    assert main["patients"] == 2
    assert main["from_out_count"] == 3
    assert main["share_of_from"] == round(2 / 3, 4)
    assert proto["transition_count"] == 1
    assert proto["share_of_from"] == round(1 / 3, 4)
    assert main["avg_interval_days"] is not None
    assert main["median_interval_days"] is not None
