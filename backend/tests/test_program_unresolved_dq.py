"""Tests: product lexicon + program unresolved suggestions (no auto-link)."""

from __future__ import annotations

from app.services.product_lexicon import product_display_label
from app.services.program_unresolved import suggest_leads_for_phone


def test_main_course_display_is_kurs():
    assert product_display_label("main_course", "Курс") == "Курс"
    assert product_display_label("main_course", "Здоровый ребёнок") == "Курс"
    assert product_display_label("main_course", None) == "Курс"


def test_protocol_and_course15_labels():
    assert product_display_label("protocol", "Протокол") == "Протокол"
    assert product_display_label("course_15", "Курс 15") == "Курс 15"
    assert product_display_label("other_service", "Массаж") == "Массаж"


def test_suggest_unique_vs_ambiguous():
    index = {"901234567": {10}, "902222222": {20, 21}}
    meta = {
        10: ("Али", "+992901234567"),
        20: ("Боб", "902222222"),
        21: ("Чарли", "902222222"),
    }
    conf, cands, ev = suggest_leads_for_phone("901234567", phone_index=index, lead_meta=meta)
    assert conf == "unique"
    assert len(cands) == 1
    assert cands[0]["lead_id"] == 10
    assert "unique_phone_candidate" in ev

    conf2, cands2, ev2 = suggest_leads_for_phone("902222222", phone_index=index, lead_meta=meta)
    assert conf2 == "ambiguous"
    assert len(cands2) == 2
    assert "ambiguous_phone_candidates" in ev2

    conf3, cands3, _ = suggest_leads_for_phone("900000000", phone_index=index, lead_meta=meta)
    assert conf3 == "none"
    assert cands3 == []
