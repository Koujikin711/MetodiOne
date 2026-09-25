"""Display labels for product kinds — UI only; canonical kinds unchanged."""

from __future__ import annotations

# kind → пользовательское имя. Catalog KPI «Курс» ↔ kind main_course.
PRODUCT_KIND_LABELS: dict[str, str] = {
    "course_15": "Курс 15",
    "main_course": "Курс",
    "protocol": "Протокол",
    "other_service": "Другая услуга",
    "visit": "Визит",
    "desk": "Desk",
    "extra": "Доп. услуга",
}


def product_display_label(kind: str | None, name: str | None = None) -> str:
    """Prefer catalog name when present; map known kinds for generic/legacy names."""
    k = (kind or "").strip()
    n = (name or "").strip()
    if k == "main_course":
        # KPI item often «Курс»; always show «Курс» for this kind.
        return PRODUCT_KIND_LABELS["main_course"]
    if n:
        if k in PRODUCT_KIND_LABELS and n.casefold() in {
            k.casefold(),
            "main course",
            "основной курс",
            "курс",
        }:
            return PRODUCT_KIND_LABELS[k]
        return n
    if k in PRODUCT_KIND_LABELS:
        return PRODUCT_KIND_LABELS[k]
    return k or "—"
