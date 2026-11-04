"""Сигналы для планёрки РОП: без ответа / офлайн / перегруз."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from statistics import median


UNREPLIED_HOURS_DEFAULT = 4
# Перегруз: активных ≥ max(медиана×2, медиана+5) и минимум 8 лидов.
OVERLOAD_MIN_ACTIVE = 8
OVERLOAD_MEDIAN_MULT = 2.0
OVERLOAD_MEDIAN_GAP = 5


@dataclass(frozen=True)
class ManagerSignalInput:
    manager_id: int
    manager_name: str
    is_online: bool
    active_leads: int
    hot_leads: int  # «Новый лид» + «В обработке»
    unreplied_count: int


@dataclass(frozen=True)
class RopSignalDraft:
    kind: str
    severity: str
    title: str
    detail: str
    count: int
    manager_id: int | None
    manager_name: str | None


def detect_overload(managers: list[ManagerSignalInput]) -> list[RopSignalDraft]:
    actives = [m.active_leads for m in managers if m.active_leads > 0]
    if len(actives) < 2:
        return []
    med = float(median(actives))
    threshold = max(med * OVERLOAD_MEDIAN_MULT, med + OVERLOAD_MEDIAN_GAP, float(OVERLOAD_MIN_ACTIVE))
    out: list[RopSignalDraft] = []
    for m in managers:
        if m.active_leads < threshold:
            continue
        out.append(
            RopSignalDraft(
                kind="overload",
                severity="warn",
                title=f"Перегруз · {m.manager_name}",
                detail=f"{m.active_leads} активных лидов (медиана {med:.0f})",
                count=m.active_leads,
                manager_id=m.manager_id,
                manager_name=m.manager_name,
            )
        )
    return out


def detect_offline(managers: list[ManagerSignalInput]) -> list[RopSignalDraft]:
    out: list[RopSignalDraft] = []
    for m in managers:
        if m.is_online or m.hot_leads <= 0:
            continue
        out.append(
            RopSignalDraft(
                kind="offline",
                severity="warn",
                title=f"Офлайн · {m.manager_name}",
                detail=f"{m.hot_leads} новых/в обработке, менеджер не в сети",
                count=m.hot_leads,
                manager_id=m.manager_id,
                manager_name=m.manager_name,
            )
        )
    return out


def detect_unreplied(
    managers: list[ManagerSignalInput],
    *,
    hours: int = UNREPLIED_HOURS_DEFAULT,
) -> list[RopSignalDraft]:
    out: list[RopSignalDraft] = []
    for m in managers:
        if m.unreplied_count <= 0:
            continue
        out.append(
            RopSignalDraft(
                kind="unreplied",
                severity="critical",
                title=f"Неотвеченные · {m.manager_name}",
                detail=f"{m.unreplied_count} лид(ов) ждут ответа дольше {hours} ч",
                count=m.unreplied_count,
                manager_id=m.manager_id,
                manager_name=m.manager_name,
            )
        )
    return out


def collect_signals(
    managers: list[ManagerSignalInput],
    *,
    unreplied_hours: int = UNREPLIED_HOURS_DEFAULT,
) -> list[RopSignalDraft]:
    """Порядок: критичные без ответа → офлайн → перегруз."""
    return [
        *detect_unreplied(managers, hours=unreplied_hours),
        *detect_offline(managers),
        *detect_overload(managers),
    ]


def waiting_unreplied(
    *,
    messages: list[tuple[str, datetime]],
    now: datetime,
    threshold_hours: float,
    lead_created_at: datetime | None,
) -> bool:
    """Лид ждёт ответа: последнее входящее без исходящего после него и старше порога.

    messages — (direction, created_at) по возрастанию времени.
    Без сообщений: ждёт, если карточка старше порога.
    """
    last_in: datetime | None = None
    last_out_after_in = False
    for direction, ts in messages:
        if direction == "in":
            last_in = ts
            last_out_after_in = False
        elif direction == "out" and last_in is not None:
            last_out_after_in = True
    if last_in is not None and not last_out_after_in:
        age_h = (_as_aware(now) - _as_aware(last_in)).total_seconds() / 3600.0
        return age_h >= threshold_hours
    if last_in is None and lead_created_at is not None and not messages:
        age_h = (_as_aware(now) - _as_aware(lead_created_at)).total_seconds() / 3600.0
        return age_h >= threshold_hours
    return False


def _as_aware(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=UTC)
    return ts
