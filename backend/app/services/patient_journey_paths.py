"""Universal Patient Journey path analytics (без gate-правил).

Masterclass и Course15 — program events / products, НЕ prerequisite
для Main Course / Protocol и НЕ фильтр Paid LTV.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Sequence


COMMERCIAL_KINDS = frozenset({"course_15", "main_course", "protocol", "other_service", "visit", "desk", "extra"})


@dataclass(frozen=True)
class LeadPurchaseFact:
    """Один valid purchase в хронологии."""

    product_kind: str
    purchased_at: datetime | None = None


@dataclass(frozen=True)
class LeadJourneyFacts:
    """Факты Lead для path-analytics. Без fake events."""

    purchases: Sequence[LeadPurchaseFact]
    master_class_at: datetime | None = None
    course_15_status: str = "none"  # none | active | completed


def _kinds(facts: LeadJourneyFacts) -> list[str]:
    return [p.product_kind for p in facts.purchases if p.product_kind]


def first_product_kind(facts: LeadJourneyFacts) -> str | None:
    kinds = _kinds(facts)
    return kinds[0] if kinds else None


def has_kind(facts: LeadJourneyFacts, kind: str) -> bool:
    return kind in _kinds(facts)


def master_class_recorded(facts: LeadJourneyFacts) -> bool:
    return facts.master_class_at is not None


def course15_buyer(facts: LeadJourneyFacts) -> bool:
    return has_kind(facts, "course_15") or facts.course_15_status in ("active", "completed")


def classify_product_origin(facts: LeadJourneyFacts, target: str) -> str | None:
    """Origin path для первого Main Course / Protocol (из реальной sequence).

    Возвращает None, если target-покупки нет.
    Категории:
      as_first_product | after_course15_with_mk | after_course15_mk_not_recorded
      | without_course15 | other_previous_path
    """
    kinds = _kinds(facts)
    if target not in kinds:
        return None
    idx = kinds.index(target)
    before = kinds[:idx]
    if not before:
        return "as_first_product"
    had_c15 = "course_15" in before
    mk = master_class_recorded(facts)
    if had_c15 and mk:
        return "after_course15_with_mk"
    if had_c15 and not mk:
        return "after_course15_mk_not_recorded"
    if not had_c15:
        return "without_course15"
    return "other_previous_path"


def course15_funnel_leaf(facts: LeadJourneyFacts) -> str | None:
    """Лист воронки Course15 (аналитика, не workflow).

    None — пациент не покупал Course15.
    Листья:
      mk_main | mk_protocol | mk_both | mk_none
      no_mk_main | no_mk_protocol | no_mk_both | no_mk_none
    """
    if not course15_buyer(facts):
        return None
    mk = master_class_recorded(facts)
    has_main = has_kind(facts, "main_course")
    has_proto = has_kind(facts, "protocol")
    if has_main and has_proto:
        leaf = "both"
    elif has_main:
        leaf = "main"
    elif has_proto:
        leaf = "protocol"
    else:
        leaf = "none"
    prefix = "mk" if mk else "no_mk"
    return f"{prefix}_{leaf}"


def conversion_flags(facts: LeadJourneyFacts) -> dict[str, bool]:
    """Булевы conversion-факты по одному Lead (для агрегации)."""
    kinds = _kinds(facts)
    c15 = "course_15" in kinds
    main = "main_course" in kinds
    proto = "protocol" in kinds
    mk = master_class_recorded(facts)
    return {
        "course15_to_main": c15 and main,
        "course15_to_protocol": c15 and proto,
        "course15_to_masterclass": c15 and mk,
        "masterclass_to_main": mk and main,
        "masterclass_to_protocol": mk and proto,
        "course15_to_main_without_mk": c15 and main and not mk,
        "course15_to_protocol_without_mk": c15 and proto and not mk,
    }


def empty_path_analytics() -> dict:
    return {
        "course_15_buyers": 0,
        "course_15_completed": 0,
        "master_class_recorded": 0,
        "master_class_not_recorded": 0,
        "funnel": {
            "mk_main": 0,
            "mk_protocol": 0,
            "mk_both": 0,
            "mk_none": 0,
            "no_mk_main": 0,
            "no_mk_protocol": 0,
            "no_mk_both": 0,
            "no_mk_none": 0,
        },
        "conversions": {
            "course15_to_main": 0,
            "course15_to_protocol": 0,
            "course15_to_masterclass": 0,
            "masterclass_to_main": 0,
            "masterclass_to_protocol": 0,
            "course15_to_main_without_mk": 0,
            "course15_to_protocol_without_mk": 0,
        },
        "first_product": {},
        "main_course_origin": {
            "as_first_product": 0,
            "after_course15_with_mk": 0,
            "after_course15_mk_not_recorded": 0,
            "without_course15": 0,
            "other_previous_path": 0,
        },
        "protocol_origin": {
            "as_first_product": 0,
            "after_course15_with_mk": 0,
            "after_course15_mk_not_recorded": 0,
            "without_course15": 0,
            "other_previous_path": 0,
        },
        # legacy counters (совместимость UI)
        "course_15_started": 0,
        "master_class": 0,
        "branch_main_course": 0,
        "branch_protocols": 0,
    }


def aggregate_path_analytics(
    facts_list: Iterable[LeadJourneyFacts],
    *,
    branch_by_lead: dict[int, str] | None = None,
    lead_ids: Sequence[int] | None = None,
) -> dict:
    """Агрегация path/conversion по когорте. Не исключает purchases из LTV."""
    out = empty_path_analytics()
    first_counter: Counter[str] = Counter()
    branch_by_lead = branch_by_lead or {}
    material = list(facts_list)
    ids: list[int] = list(lead_ids) if lead_ids is not None else list(range(len(material)))

    for i, facts in enumerate(material):
        lid = ids[i] if i < len(ids) else i
        fp = first_product_kind(facts)
        if fp:
            first_counter[fp] += 1

        if course15_buyer(facts):
            out["course_15_buyers"] += 1
            out["course_15_started"] += 1
            if facts.course_15_status == "completed":
                out["course_15_completed"] += 1
            if master_class_recorded(facts):
                out["master_class_recorded"] += 1
                out["master_class"] += 1
            else:
                out["master_class_not_recorded"] += 1
            leaf = course15_funnel_leaf(facts)
            if leaf and leaf in out["funnel"]:
                out["funnel"][leaf] += 1

        for k, v in conversion_flags(facts).items():
            if v:
                out["conversions"][k] += 1

        mo = classify_product_origin(facts, "main_course")
        if mo and mo in out["main_course_origin"]:
            out["main_course_origin"][mo] += 1
        po = classify_product_origin(facts, "protocol")
        if po and po in out["protocol_origin"]:
            out["protocol_origin"][po] += 1

        br = branch_by_lead.get(int(lid))
        if br == "main_course":
            out["branch_main_course"] += 1
        elif br == "protocols":
            out["branch_protocols"] += 1

    out["first_product"] = dict(first_counter)
    return out
