"""Фиксированная локация клиники для исходящих WhatsApp-пинов."""

from __future__ import annotations

from app.config import settings


def clinic_whatsapp_location() -> dict[str, str | float]:
    return {
        "name_location": (settings.clinic_wa_location_name or "Metodi Clinic").strip() or "Metodi Clinic",
        "address": (settings.clinic_wa_location_address or "").strip(),
        "latitude": float(settings.clinic_wa_location_lat),
        "longitude": float(settings.clinic_wa_location_lng),
    }
