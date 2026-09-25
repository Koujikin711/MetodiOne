"""Suggestion classification: phone ≠ identity confirmed."""

from __future__ import annotations

from app.services.program_unresolved import (
    CONF_AMBIGUOUS,
    CONF_HIGH,
    CONF_NONE,
    CONF_REVIEW,
    classify_phone_candidates,
    enrich_single_candidate,
    fio_match_level,
)


def test_fio_match_levels():
    assert fio_match_level("Файзиддинзода Сулаймон", "Файзиддинзода Сулаймон") == "exact"
    assert fio_match_level("Хикматов Холид", "Химатов Холид") in ("partial", "mismatch")
    # shared surname token
    assert fio_match_level("Курбонзода Хусейн", "Курбонзода хусейн") == "exact"
    assert fio_match_level("Кобилчонзода Ёсамин", "Rustamov L") == "mismatch"
    assert fio_match_level("Али", None) == "empty"
    assert fio_match_level("@nickname", "Саидов") == "empty"


def test_classify_phone_ambiguous_and_none():
    index = {"901234567": {10}, "902222222": {20, 21}}
    meta = {
        10: ("Али", "901234567"),
        20: ("Боб", "902222222"),
        21: ("Чарли", "902222222"),
    }
    conf, cands = classify_phone_candidates("901234567", phone_index=index, lead_meta=meta)
    assert conf == "single_phone"
    assert len(cands) == 1

    conf2, cands2 = classify_phone_candidates("902222222", phone_index=index, lead_meta=meta)
    assert conf2 == CONF_AMBIGUOUS
    assert len(cands2) == 2

    conf3, cands3 = classify_phone_candidates("900000000", phone_index=index, lead_meta=meta)
    assert conf3 == CONF_NONE
    assert cands3 == []


def test_enrich_high_vs_review():
    cand = {"lead_id": 1, "lead_name": "Файзиддинзода Сулаймон", "lead_phone": "x"}
    conf, ev = enrich_single_candidate(
        sale_client_name="Файзиддинзода Сулаймон",
        candidate=cand,
        booking_patient_names=[],
    )
    assert conf == CONF_HIGH
    assert ev["fio"] == "exact"
    assert ev["phone"] is True

    cand2 = {"lead_id": 2, "lead_name": "Rustamov L", "lead_phone": "x"}
    conf2, ev2 = enrich_single_candidate(
        sale_client_name="Кобилчонзода Ёсамин",
        candidate=cand2,
        booking_patient_names=["Кобилчонзода Есамин"],
    )
    # booking FIO overlap → high even if Lead.name is Instagram nick
    assert conf2 == CONF_HIGH
    assert ev2["booking"] is True

    cand3 = {"lead_id": 3, "lead_name": "м", "lead_phone": "x"}
    conf3, ev3 = enrich_single_candidate(
        sale_client_name="Махмадов Мавлончон",
        candidate=cand3,
        booking_patient_names=[],
    )
    assert conf3 == CONF_REVIEW
    assert ev3["warning"]
