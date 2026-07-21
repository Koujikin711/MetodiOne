"""Fill the studio sandbox company with a year of believable CRM history.

Called from the passwordless /demo-login entry. Idempotent: it only fills a
sandbox company that has no leads yet, so it runs once and is never duplicated.
"""

from __future__ import annotations

import random
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Deal,
    Lead,
    Pipeline,
    PipelineStage,
    Task,
    TaskStatus,
    UserPipelineAssignment,
)
from app.services.default_pipeline_stages import default_pipeline_stage_creates

_FIRST_NAMES = [
    "Alex", "Maria", "Daniel", "Sofia", "Timur", "Nina", "Omar", "Elena",
    "Farrukh", "Laura", "Viktor", "Dilnoza", "Sergey", "Aziza", "Ivan",
    "Kamila", "Rustam", "Olga", "Bekzod", "Anna", "Jamshed", "Marina",
]
_LAST_NAMES = [
    "Karimov", "Petrova", "Rahimov", "Ivanova", "Nazarov", "Sidorova",
    "Yusupov", "Volkova", "Saidov", "Orlova", "Ahmedov", "Belova",
]
_SOURCES = ["Instagram", "WhatsApp", "Website", "Referral", "Telegram", "Walk-in", "Google"]
_SERVICES = [
    "Consultation", "Full diagnostics", "Treatment plan", "Follow-up visit",
    "Premium package", "Express service", "Annual contract", "On-site audit",
]


async def _ensure_pipeline(db: AsyncSession, company_id: int, owner_id: int) -> list[int]:
    pipe = (
        await db.execute(select(Pipeline).where(Pipeline.company_id == company_id).limit(1))
    ).scalars().first()
    if pipe is None:
        pipe = Pipeline(name="Sales funnel", type="sales", company_id=company_id)
        db.add(pipe)
        await db.flush()
        db.add(UserPipelineAssignment(user_id=owner_id, pipeline_id=pipe.id, company_id=company_id))

    stages = (
        await db.execute(
            select(PipelineStage)
            .where(PipelineStage.pipeline_id == pipe.id)
            .order_by(PipelineStage.order)
        )
    ).scalars().all()
    if not stages:
        for idx, st in enumerate(default_pipeline_stage_creates()):
            db.add(
                PipelineStage(
                    name=st.name,
                    order=st.order if st.order is not None else idx,
                    color=st.color,
                    pipeline_id=pipe.id,
                    company_id=company_id,
                )
            )
        await db.flush()
        stages = (
            await db.execute(
                select(PipelineStage)
                .where(PipelineStage.pipeline_id == pipe.id)
                .order_by(PipelineStage.order)
            )
        ).scalars().all()
    return [int(s.id) for s in stages]


async def seed_sandbox_demo_data(db: AsyncSession, company_id: int, owner_id: int) -> bool:
    """Populate ~12 months of leads/deals/tasks for the sandbox. Returns True if seeded."""
    has_lead = await db.scalar(select(Lead.id).where(Lead.company_id == company_id).limit(1))
    if has_lead is not None:
        return False

    stage_ids = await _ensure_pipeline(db, company_id, owner_id)
    if not stage_ids:
        return False

    won_stage = stage_ids[-3] if len(stage_ids) >= 3 else stage_ids[-1]
    lost_stage = stage_ids[-1]
    rng = random.Random(20260721)
    now = datetime.now(UTC)

    for days_ago in range(365, -1, -1):
        # a few leads on most days, more on weekdays
        day = now - timedelta(days=days_ago)
        base = 2 if day.weekday() < 5 else 1
        n_leads = rng.choices([0, 1, 2, 3], weights=[3, 5, 4, base])[0]
        for _ in range(n_leads):
            created = day.replace(
                hour=rng.randint(9, 19), minute=rng.randint(0, 59), second=rng.randint(0, 59)
            )
            name = f"{rng.choice(_FIRST_NAMES)} {rng.choice(_LAST_NAMES)}"
            # older leads have moved further down the funnel
            if days_ago > 30:
                roll = rng.random()
                if roll < 0.5:
                    stage_id = won_stage
                elif roll < 0.65:
                    stage_id = lost_stage
                else:
                    stage_id = rng.choice(stage_ids)
            else:
                stage_id = stage_ids[rng.randrange(min(4, len(stage_ids)))]

            lead = Lead(
                company_id=company_id,
                name=name,
                phone=f"+9929{rng.randint(10000000, 99999999)}",
                email=f"{name.split()[0].lower()}{rng.randint(1, 999)}@example.com",
                source=rng.choice(_SOURCES),
                status_id=stage_id,
                manager_id=owner_id,
                created_at=created,
            )
            db.add(lead)
            await db.flush()

            if stage_id == won_stage or (stage_id not in (lost_stage,) and rng.random() < 0.4):
                amount = Decimal(rng.randrange(150, 4000)) * Decimal("10")
                paid = amount if stage_id == won_stage else amount * Decimal("0.3")
                db.add(
                    Deal(
                        company_id=company_id,
                        title=f"{rng.choice(_SERVICES)} — {name}",
                        deal_type="service",
                        amount=amount,
                        paid_amount=paid,
                        stage_id=stage_id,
                        lead_id=lead.id,
                        probability=100 if stage_id == won_stage else rng.randint(20, 80),
                    )
                )

            if days_ago <= 45 and rng.random() < 0.3:
                st = rng.choice([TaskStatus.pending, TaskStatus.in_progress, TaskStatus.done])
                db.add(
                    Task(
                        company_id=company_id,
                        title=f"Call back {name}",
                        deadline=created + timedelta(days=rng.randint(1, 5)),
                        status=st,
                        assigned_to=owner_id,
                        created_by_user_id=owner_id,
                        description="Follow up on the request and confirm next step.",
                        related_lead_id=lead.id,
                    )
                )

    await db.flush()
    return True
