"""Фильтры видимости лидов для менеджера / админа воронки."""

from __future__ import annotations

from sqlalchemy import or_

from app.models import Lead


def manager_lead_visibility(manager_id: int):
    """Менеджер видит свои лиды и нераспределённые в назначенных воронках."""
    return or_(Lead.manager_id == manager_id, Lead.manager_id.is_(None))
