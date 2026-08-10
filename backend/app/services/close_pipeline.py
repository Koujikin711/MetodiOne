"""Закрытие воронки: CSV контактов → каскадная очистка → увольнение «только этой» воронки."""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BookingAppointment,
    BookingDirection,
    BookingSpecialist,
    ChatMessage,
    ChatThread,
    ChatThreadUserRead,
    Deal,
    Integration,
    Lead,
    LeadExtraPhone,
    PatientServiceEnrollment,
    Pipeline,
    PipelineStage,
    SalesKpiManualSale,
    SalesKpiPlan,
    SalesKpiPlanItem,
    SalesKpiPlanItemSpecialist,
    SalesKpiServicePlan,
    SalesKpiServicePrice,
    SalesKpiWeightedSettings,
    ServiceTemplate,
    Task,
    User,
    UserPipelineAssignment,
    UserRole,
)


def _csv_escape_cell(value: object) -> str:
    if value is None:
        return ""
    return str(value)


def safe_filename_part(name: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "_", name.strip(), flags=re.UNICODE)
    return (cleaned[:48] or "pipeline").strip("_") or "pipeline"


@dataclass
class ClosePipelinePreview:
    pipeline_id: int
    pipeline_name: str
    leads_count: int
    stages_count: int
    integrations_count: int
    employees_to_terminate: list[dict]
    employees_to_unassign: list[dict]


async def _stage_ids(db: AsyncSession, company_id: int, pipeline_id: int) -> list[int]:
    rows = (
        await db.execute(
            select(PipelineStage.id).where(
                PipelineStage.pipeline_id == pipeline_id,
                PipelineStage.company_id == company_id,
            ),
        )
    ).scalars().all()
    return [int(x) for x in rows]


async def _lead_ids_for_stages(db: AsyncSession, company_id: int, stage_ids: list[int]) -> list[int]:
    if not stage_ids:
        return []
    rows = (
        await db.execute(
            select(Lead.id).where(
                Lead.company_id == company_id,
                Lead.status_id.in_(stage_ids),
            ),
        )
    ).scalars().all()
    return [int(x) for x in rows]


async def build_pipeline_leads_csv(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
) -> tuple[str, int]:
    """CSV со всеми лидами воронки (ФИО, телефоны, email и т.д.)."""
    stages = (
        await db.execute(
            select(PipelineStage).where(
                PipelineStage.pipeline_id == pipeline_id,
                PipelineStage.company_id == company_id,
            ),
        )
    ).scalars().all()
    stage_by_id = {int(s.id): s for s in stages}
    stage_ids = list(stage_by_id.keys())
    if not stage_ids:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            [
                "id",
                "full_name",
                "phone",
                "extra_phones",
                "email",
                "source",
                "stage",
                "manager_name",
                "manager_email",
                "refusal_reason",
                "created_at",
            ],
        )
        return "\ufeff" + buf.getvalue(), 0

    leads = (
        await db.execute(
            select(Lead)
            .where(Lead.company_id == company_id, Lead.status_id.in_(stage_ids))
            .order_by(Lead.id.asc()),
        )
    ).scalars().all()

    extras = (
        await db.execute(
            select(LeadExtraPhone).where(
                LeadExtraPhone.company_id == company_id,
                LeadExtraPhone.lead_id.in_([int(l.id) for l in leads] or [-1]),
            ).order_by(LeadExtraPhone.lead_id.asc(), LeadExtraPhone.sort_order.asc()),
        )
    ).scalars().all()
    extras_by_lead: dict[int, list[str]] = {}
    for ep in extras:
        extras_by_lead.setdefault(int(ep.lead_id), []).append(str(ep.phone or "").strip())

    manager_ids = {int(l.manager_id) for l in leads if l.manager_id is not None}
    managers: dict[int, User] = {}
    if manager_ids:
        for u in (
            await db.execute(select(User).where(User.id.in_(manager_ids)))
        ).scalars().all():
            managers[int(u.id)] = u

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "id",
            "full_name",
            "phone",
            "extra_phones",
            "email",
            "source",
            "stage",
            "manager_name",
            "manager_email",
            "refusal_reason",
            "created_at",
        ],
    )
    for lead in leads:
        st = stage_by_id.get(int(lead.status_id))
        mgr = managers.get(int(lead.manager_id)) if lead.manager_id is not None else None
        created = ""
        if lead.created_at is not None:
            dt = lead.created_at
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            created = dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        writer.writerow(
            [
                _csv_escape_cell(lead.id),
                _csv_escape_cell(lead.name),
                _csv_escape_cell(lead.phone),
                _csv_escape_cell("; ".join(extras_by_lead.get(int(lead.id), []))),
                _csv_escape_cell(lead.email),
                _csv_escape_cell(lead.source),
                _csv_escape_cell(st.name if st else ""),
                _csv_escape_cell(mgr.full_name if mgr else ""),
                _csv_escape_cell(mgr.email if mgr else ""),
                _csv_escape_cell(lead.refusal_reason),
                created,
            ],
        )
    return "\ufeff" + buf.getvalue(), len(leads)


async def preview_close_pipeline(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
) -> ClosePipelinePreview:
    pipe = await db.get(Pipeline, pipeline_id)
    if pipe is None or pipe.company_id != company_id:
        raise ValueError("Воронка не найдена")

    stage_ids = await _stage_ids(db, company_id, pipeline_id)
    leads_count = 0
    if stage_ids:
        leads_count = int(
            await db.scalar(
                select(func.count()).select_from(Lead).where(
                    Lead.company_id == company_id,
                    Lead.status_id.in_(stage_ids),
                ),
            )
            or 0,
        )
    integrations_count = int(
        await db.scalar(
            select(func.count()).select_from(Integration).where(
                Integration.company_id == company_id,
                Integration.pipeline_id == pipeline_id,
            ),
        )
        or 0,
    )

    assigned_user_ids = [
        int(x)
        for x in (
            await db.execute(
                select(UserPipelineAssignment.user_id).where(
                    UserPipelineAssignment.company_id == company_id,
                    UserPipelineAssignment.pipeline_id == pipeline_id,
                ),
            )
        ).scalars().all()
    ]
    # Главный эксперт / intake без assignment тоже учитываем.
    for uid in (pipe.expert_user_id, pipe.intake_manager_user_id):
        if uid is not None and int(uid) not in assigned_user_ids:
            assigned_user_ids.append(int(uid))

    to_terminate: list[dict] = []
    to_unassign: list[dict] = []
    for uid in assigned_user_ids:
        user = await db.get(User, uid)
        if user is None or user.company_id != company_id or not user.is_active:
            continue
        if user.role in (UserRole.owner, UserRole.super_owner):
            continue
        other = int(
            await db.scalar(
                select(func.count()).select_from(UserPipelineAssignment).where(
                    UserPipelineAssignment.company_id == company_id,
                    UserPipelineAssignment.user_id == uid,
                    UserPipelineAssignment.pipeline_id != pipeline_id,
                ),
            )
            or 0,
        )
        row = {
            "id": int(user.id),
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        }
        if other > 0:
            to_unassign.append(row)
        else:
            to_terminate.append(row)

    return ClosePipelinePreview(
        pipeline_id=pipeline_id,
        pipeline_name=pipe.name,
        leads_count=leads_count,
        stages_count=len(stage_ids),
        integrations_count=integrations_count,
        employees_to_terminate=to_terminate,
        employees_to_unassign=to_unassign,
    )


async def _terminate_user_for_closed_pipeline(
    db: AsyncSession,
    *,
    company_id: int,
    user: User,
) -> None:
    user.is_active = False
    user.invite_token = None
    await db.execute(
        delete(UserPipelineAssignment).where(
            UserPipelineAssignment.user_id == user.id,
            UserPipelineAssignment.company_id == company_id,
        ),
    )
    if user.role == UserRole.expert:
        for sp in (
            await db.execute(select(BookingSpecialist).where(BookingSpecialist.crm_user_id == user.id))
        ).scalars().all():
            sp.is_active = False


async def close_pipeline(
    db: AsyncSession,
    *,
    company_id: int,
    pipeline_id: int,
) -> tuple[str, str, ClosePipelinePreview]:
    """
    Собирает CSV лидов, удаляет всё связанное с воронкой, увольняет сотрудников
    без других воронок. Возвращает (csv_text, filename, preview_before).
    """
    preview = await preview_close_pipeline(db, company_id=company_id, pipeline_id=pipeline_id)
    pipe = await db.get(Pipeline, pipeline_id)
    assert pipe is not None

    total_pipes = await db.scalar(
        select(func.count()).select_from(Pipeline).where(Pipeline.company_id == company_id),
    )
    if total_pipes is not None and int(total_pipes) <= 1:
        raise ValueError("Нельзя закрыть последнюю воронку. Сначала создайте другую.")

    csv_text, _leads_n = await build_pipeline_leads_csv(
        db, company_id=company_id, pipeline_id=pipeline_id,
    )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"voronka_{safe_filename_part(pipe.name)}_leads_{stamp}.csv"

    stage_ids = await _stage_ids(db, company_id, pipeline_id)
    lead_ids = await _lead_ids_for_stages(db, company_id, stage_ids)

    # 1) Интеграции (RESTRICT на pipeline/stage)
    await db.execute(
        delete(Integration).where(
            Integration.company_id == company_id,
            Integration.pipeline_id == pipeline_id,
        ),
    )

    # 2) Сделки на стадиях
    if stage_ids:
        await db.execute(delete(Deal).where(Deal.company_id == company_id, Deal.stage_id.in_(stage_ids)))

    # 3) Чаты воронки
    thread_ids = [
        int(x)
        for x in (
            await db.execute(
                select(ChatThread.id).where(
                    ChatThread.company_id == company_id,
                    ChatThread.pipeline_id == pipeline_id,
                ),
            )
        ).scalars().all()
    ]
    if lead_ids:
        extra_threads = [
            int(x)
            for x in (
                await db.execute(
                    select(ChatThread.id).where(
                        ChatThread.company_id == company_id,
                        ChatThread.lead_id.in_(lead_ids),
                    ),
                )
            ).scalars().all()
        ]
        thread_ids = sorted(set(thread_ids) | set(extra_threads))
    if thread_ids:
        await db.execute(delete(ChatThreadUserRead).where(ChatThreadUserRead.thread_id.in_(thread_ids)))
        await db.execute(delete(ChatMessage).where(ChatMessage.thread_id.in_(thread_ids)))
        await db.execute(delete(ChatThread).where(ChatThread.id.in_(thread_ids)))

    # 4) Записи онлайн-записи, привязанные к воронке / лидам
    if lead_ids:
        await db.execute(
            delete(BookingAppointment).where(
                BookingAppointment.company_id == company_id,
                BookingAppointment.lead_id.in_(lead_ids),
            ),
        )
    await db.execute(
        delete(BookingAppointment).where(
            BookingAppointment.company_id == company_id,
            BookingAppointment.pipeline_id == pipeline_id,
        ),
    )
    await db.execute(
        update(BookingDirection)
        .where(
            BookingDirection.company_id == company_id,
            BookingDirection.pipeline_id == pipeline_id,
        )
        .values(pipeline_id=None),
    )

    # 5) KPI (manual sales RESTRICT → plan items)
    await db.execute(
        delete(SalesKpiManualSale).where(
            SalesKpiManualSale.company_id == company_id,
            SalesKpiManualSale.pipeline_id == pipeline_id,
        ),
    )
    plan_item_ids = [
        int(x)
        for x in (
            await db.execute(
                select(SalesKpiPlanItem.id).where(
                    SalesKpiPlanItem.company_id == company_id,
                    SalesKpiPlanItem.pipeline_id == pipeline_id,
                ),
            )
        ).scalars().all()
    ]
    if plan_item_ids:
        await db.execute(
            delete(SalesKpiPlanItemSpecialist).where(
                SalesKpiPlanItemSpecialist.plan_item_id.in_(plan_item_ids),
            ),
        )
    await db.execute(
        delete(SalesKpiPlanItem).where(
            SalesKpiPlanItem.company_id == company_id,
            SalesKpiPlanItem.pipeline_id == pipeline_id,
        ),
    )
    await db.execute(
        delete(SalesKpiPlan).where(
            SalesKpiPlan.company_id == company_id,
            SalesKpiPlan.pipeline_id == pipeline_id,
        ),
    )
    await db.execute(
        delete(SalesKpiServicePrice).where(
            SalesKpiServicePrice.company_id == company_id,
            SalesKpiServicePrice.pipeline_id == pipeline_id,
        ),
    )
    await db.execute(
        delete(SalesKpiServicePlan).where(
            SalesKpiServicePlan.company_id == company_id,
            SalesKpiServicePlan.pipeline_id == pipeline_id,
        ),
    )
    await db.execute(
        delete(SalesKpiWeightedSettings).where(
            SalesKpiWeightedSettings.company_id == company_id,
            SalesKpiWeightedSettings.pipeline_id == pipeline_id,
        ),
    )

    # 6) Каталог услуг / enrollment (enrollment → template RESTRICT)
    await db.execute(
        delete(PatientServiceEnrollment).where(
            PatientServiceEnrollment.company_id == company_id,
            PatientServiceEnrollment.pipeline_id == pipeline_id,
        ),
    )
    if lead_ids:
        await db.execute(
            delete(PatientServiceEnrollment).where(
                PatientServiceEnrollment.company_id == company_id,
                PatientServiceEnrollment.lead_id.in_(lead_ids),
            ),
        )
    await db.execute(
        delete(ServiceTemplate).where(
            ServiceTemplate.company_id == company_id,
            ServiceTemplate.pipeline_id == pipeline_id,
        ),
    )

    # 7) Задачи по лидам, затем сами лиды
    if lead_ids:
        await db.execute(delete(Task).where(Task.company_id == company_id, Task.related_lead_id.in_(lead_ids)))
        await db.execute(delete(Lead).where(Lead.company_id == company_id, Lead.id.in_(lead_ids)))

    # 8) Сотрудники: снять assignment; без других воронок — уволить
    assigned_rows = (
        await db.execute(
            select(UserPipelineAssignment.user_id).where(
                UserPipelineAssignment.company_id == company_id,
                UserPipelineAssignment.pipeline_id == pipeline_id,
            ),
        )
    ).scalars().all()
    user_ids = {int(x) for x in assigned_rows}
    for uid in (pipe.expert_user_id, pipe.intake_manager_user_id):
        if uid is not None:
            user_ids.add(int(uid))

    await db.execute(
        delete(UserPipelineAssignment).where(
            UserPipelineAssignment.company_id == company_id,
            UserPipelineAssignment.pipeline_id == pipeline_id,
        ),
    )

    for uid in user_ids:
        user = await db.get(User, uid)
        if user is None or user.company_id != company_id or not user.is_active:
            continue
        if user.role in (UserRole.owner, UserRole.super_owner):
            continue
        remaining = int(
            await db.scalar(
                select(func.count()).select_from(UserPipelineAssignment).where(
                    UserPipelineAssignment.company_id == company_id,
                    UserPipelineAssignment.user_id == uid,
                ),
            )
            or 0,
        )
        if remaining == 0:
            await _terminate_user_for_closed_pipeline(db, company_id=company_id, user=user)

    # 9) Стадии и воронка
    if stage_ids:
        await db.execute(
            delete(PipelineStage).where(
                PipelineStage.company_id == company_id,
                PipelineStage.id.in_(stage_ids),
            ),
        )
    await db.delete(pipe)
    await db.flush()

    return csv_text, filename, preview
