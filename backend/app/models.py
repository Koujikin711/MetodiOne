import enum
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, JSON, Numeric, String, Text
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class UserRole(str, enum.Enum):
    admin = "admin"
    manager = "manager"
    expert = "expert"


class TaskStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    done = "done"
    cancelled = "cancelled"


class Pipeline(Base):
    __tablename__ = "pipelines"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    type: Mapped[str] = mapped_column(String(64), default="sales")
    # none | round_robin | least_loaded — кому назначать новых лидов из интеграций/очереди
    lead_assignment_mode: Mapped[str] = mapped_column(String(32), default="none")
    assignment_rr_counter: Mapped[int] = mapped_column(default=0)

    stages: Mapped[list["PipelineStage"]] = relationship(back_populates="pipeline")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, index=True, nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    invite_token: Mapped[str | None] = mapped_column(String(96), unique=True, index=True, nullable=True)
    role: Mapped[UserRole] = mapped_column(SQLEnum(UserRole, name="user_role"), default=UserRole.manager)
    is_active: Mapped[bool] = mapped_column(default=True)

    leads: Mapped[list["Lead"]] = relationship(
        back_populates="manager",
        foreign_keys=lambda: [Lead.manager_id],
    )
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="assignee",
        foreign_keys=lambda: [Task.assigned_to],
    )


class UserPipelineAssignment(Base):
    __tablename__ = "user_pipeline_assignments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id", ondelete="CASCADE"))


class PipelineStage(Base):
    __tablename__ = "pipeline_stages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    order: Mapped[int] = mapped_column(default=0)
    color: Mapped[str] = mapped_column(String(32), default="#6366f1")
    pipeline_id: Mapped[int | None] = mapped_column(
        ForeignKey("pipelines.id", ondelete="SET NULL"),
        nullable=True,
    )

    leads: Mapped[list["Lead"]] = relationship(back_populates="stage")
    deals: Mapped[list["Deal"]] = relationship(back_populates="stage")
    pipeline: Mapped["Pipeline | None"] = relationship(back_populates="stages")


def _utc_now() -> datetime:
    return datetime.now(UTC)


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status_id: Mapped[int] = mapped_column(ForeignKey("pipeline_stages.id", ondelete="RESTRICT"))
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    refusal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=_utc_now,
        insert_default=_utc_now,
    )

    stage: Mapped["PipelineStage"] = relationship(back_populates="leads")
    manager: Mapped["User | None"] = relationship(back_populates="leads", foreign_keys=[manager_id])
    deals: Mapped[list["Deal"]] = relationship(back_populates="lead")
    automation_tasks: Mapped[list["Task"]] = relationship(
        back_populates="related_lead",
        foreign_keys="Task.related_lead_id",
    )
    booking_appointments: Mapped[list["BookingAppointment"]] = relationship(
        back_populates="lead",
    )
    audit_events: Mapped[list["LeadAuditEvent"]] = relationship(back_populates="lead")


class LeadAuditEvent(Base):
    __tablename__ = "lead_audit_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(64))
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)

    lead: Mapped["Lead"] = relationship(back_populates="audit_events")
    user: Mapped["User | None"] = relationship(foreign_keys=[user_id])


class SystemAuditEvent(Base):
    __tablename__ = "system_audit_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64))
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now, index=True)

    user: Mapped["User | None"] = relationship(foreign_keys=[user_id])


class LeadSource(Base):
    __tablename__ = "lead_sources"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    is_active: Mapped[bool] = mapped_column(default=True)


class IntegrationProvider(str, enum.Enum):
    green_api = "green_api"  # WhatsApp via GREEN API
    telegram = "telegram"  # Telegram bot webhook
    instagram = "instagram"  # Meta webhook (placeholder)


class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    provider: Mapped[IntegrationProvider] = mapped_column(
        SQLEnum(IntegrationProvider, name="integration_provider"),
    )
    is_active: Mapped[bool] = mapped_column(default=True)

    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id", ondelete="RESTRICT"))
    stage_id: Mapped[int] = mapped_column(ForeignKey("pipeline_stages.id", ondelete="RESTRICT"))

    # Секрет для webhook (передавать как query param ?token=... или header)
    secret: Mapped[str] = mapped_column(String(128))
    # Провайдер-специфичная конфигурация (instanceId, apiToken, botToken и т.п.)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    pipeline_id: Mapped[int | None] = mapped_column(ForeignKey("pipelines.id", ondelete="SET NULL"), nullable=True)
    provider: Mapped[str] = mapped_column(String(40), default="green_api")
    external_chat_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("chat_threads.id", ondelete="CASCADE"))
    author_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    direction: Mapped[str] = mapped_column(String(8), default="in")  # in/out
    text: Mapped[str] = mapped_column(Text)
    message_type: Mapped[str] = mapped_column(String(24), default="text")  # text|image|video|audio|document
    media_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_mime: Mapped[str | None] = mapped_column(String(128), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    delivery_status: Mapped[str] = mapped_column(String(24), default="sent")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class BookingDirection(Base):
    __tablename__ = "booking_directions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    duration_min: Mapped[int] = mapped_column(default=30)
    is_active: Mapped[bool] = mapped_column(default=True)

    specialists: Mapped[list["BookingSpecialist"]] = relationship(back_populates="direction")
    appointments: Mapped[list["BookingAppointment"]] = relationship(back_populates="direction")


class BookingSpecialist(Base):
    __tablename__ = "booking_specialists"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(255))
    direction_id: Mapped[int] = mapped_column(ForeignKey("booking_directions.id", ondelete="RESTRICT"))
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    specialization: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    slot_duration_min: Mapped[int] = mapped_column(default=30)
    work_start_hour: Mapped[int] = mapped_column(default=9)
    work_end_hour: Mapped[int] = mapped_column(default=18)
    work_weekdays: Mapped[list | None] = mapped_column(JSON, nullable=True)

    direction: Mapped["BookingDirection"] = relationship(back_populates="specialists")
    appointments: Mapped[list["BookingAppointment"]] = relationship(back_populates="specialist")


class BookingAppointment(Base):
    __tablename__ = "booking_appointments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    patient_name: Mapped[str] = mapped_column(String(255))
    patient_phone: Mapped[str] = mapped_column(String(64))
    direction_id: Mapped[int] = mapped_column(ForeignKey("booking_directions.id", ondelete="RESTRICT"))
    specialist_id: Mapped[int] = mapped_column(ForeignKey("booking_specialists.id", ondelete="RESTRICT"))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(32), default="booked")
    service_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    responsible_manager_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)

    lead: Mapped["Lead | None"] = relationship(back_populates="booking_appointments")
    direction: Mapped["BookingDirection"] = relationship(back_populates="appointments")
    specialist: Mapped["BookingSpecialist"] = relationship(back_populates="appointments")


class Deal(Base):
    __tablename__ = "deals"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255))
    deal_type: Mapped[str] = mapped_column(String(64), default="extra")
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    is_protocol: Mapped[bool] = mapped_column(default=False)
    protocol_requested: Mapped[bool] = mapped_column(default=False)
    protocol_confirmed: Mapped[bool] = mapped_column(default=False)
    protocol_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    stage_id: Mapped[int] = mapped_column(ForeignKey("pipeline_stages.id", ondelete="RESTRICT"))
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    probability: Mapped[int] = mapped_column(default=0)  # 0–100

    stage: Mapped["PipelineStage"] = relationship(back_populates="deals")
    lead: Mapped["Lead | None"] = relationship(back_populates="deals")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255))
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[TaskStatus] = mapped_column(
        SQLEnum(TaskStatus, name="task_status"),
        default=TaskStatus.pending,
    )
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    related_lead_id: Mapped[int | None] = mapped_column(
        ForeignKey("leads.id", ondelete="SET NULL"),
        nullable=True,
    )

    assignee: Mapped["User | None"] = relationship(back_populates="tasks", foreign_keys=[assigned_to])
    related_lead: Mapped["Lead | None"] = relationship(
        back_populates="automation_tasks",
        foreign_keys=[related_lead_id],
    )
