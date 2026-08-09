import enum
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class UserRole(str, enum.Enum):
    super_owner = "super_owner"
    owner = "owner"
    admin = "admin"
    manager = "manager"
    expert = "expert"
    finance_analyst = "finance_analyst"
    accountant = "accountant"


class TaskStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    done = "done"
    cancelled = "cancelled"


def _utc_now() -> datetime:
    return datetime.now(UTC)


class TariffPlan(Base):
    """Тарифный план платформы (набор функций и лимитов для компаний)."""

    __tablename__ = "tariff_plans"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    max_active_users: Mapped[int] = mapped_column(default=0)
    max_integrations: Mapped[int] = mapped_column(default=0)
    enabled_features: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    """Склад (остатки, приход/расход): можно отключить в тарифе при включённом модуле «Финансы»."""
    warehouse_enabled: Mapped[bool] = mapped_column(default=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    # Биллинг конструктора: валюта пакета и скидка к сумме функций+лимитов (до переопределения на компании).
    billing_currency: Mapped[str] = mapped_column(String(3), default="TJS")
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("0"))


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    contact_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    external_db_dsn: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    tariff_plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("tariff_plans.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Переопределение лимитов тарифа для компании (NULL = глобальные настройки из env)
    tariff_max_active_users: Mapped[int | None] = mapped_column(nullable=True)
    tariff_max_integrations: Mapped[int | None] = mapped_column(nullable=True)
    # Биллинг: active | demo_trial | demo_expired | payment_pending | subscribed
    billing_status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pending_tariff_plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("tariff_plans.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Скидка к подписке (перекрывает скидку тарифа, если задана). Проценты 0–100.
    billing_discount_percent: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True, default=None)
    # Отложенная смена тарифа (например урезание — с 1-го числа следующего месяца).
    scheduled_tariff_plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("tariff_plans.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    scheduled_tariff_effective_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Pipeline(Base):
    __tablename__ = "pipelines"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    type: Mapped[str] = mapped_column(String(64), default="sales")
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
    # Эксперт, закреплённый за этой воронкой (для «Отчёты» и этапа «У эксперта»).
    expert_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Менеджер «приёма»: создаёт лиды в этой воронке; при автораспределении его лиды уходят другим менеджерам.
    intake_manager_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # none | round_robin | least_loaded — кому назначать новых лидов из интеграций/очереди
    lead_assignment_mode: Mapped[str] = mapped_column(String(32), default="none")
    assignment_rr_counter: Mapped[int] = mapped_column(default=0)
    # JSON-массив строк: номера, которые менеджеры могут отправлять в чате (клиника, колл-центр и т.д.)
    manager_allowed_outbound_phones: Mapped[str | None] = mapped_column(Text, nullable=True)

    stages: Mapped[list["PipelineStage"]] = relationship(back_populates="pipeline")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, index=True, nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    horeca_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    invite_token: Mapped[str | None] = mapped_column(String(96), unique=True, index=True, nullable=True)
    role: Mapped[UserRole] = mapped_column(SQLEnum(UserRole, name="user_role"), default=UserRole.manager)
    is_active: Mapped[bool] = mapped_column(default=True)
    must_change_password: Mapped[bool] = mapped_column(default=False)

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
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id", ondelete="CASCADE"))


class SalesKpiPlan(Base):
    """План продаж (руб/мес) по менеджеру в воронке эксперта; факт — оплаты по записям за месяц."""

    __tablename__ = "sales_kpi_plans"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "pipeline_id",
            "year_month",
            "manager_user_id",
            name="uq_sales_kpi_plan_scope",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id", ondelete="CASCADE"), index=True)
    year_month: Mapped[date] = mapped_column(Date, index=True)
    manager_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expert_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    plan_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))


class SalesKpiServicePrice(Base):
    """Цена услуги в KPI на месяц по воронке/направлению."""

    __tablename__ = "sales_kpi_service_prices"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "pipeline_id",
            "year_month",
            "direction_id",
            name="uq_sales_kpi_service_price_scope",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id", ondelete="CASCADE"), index=True)
    year_month: Mapped[date] = mapped_column(Date, index=True)
    direction_id: Mapped[int] = mapped_column(ForeignKey("booking_directions.id", ondelete="CASCADE"), index=True)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))


class SalesKpiServicePlan(Base):
    """План по количеству услуг на месяц: менеджер x услуга x воронка."""

    __tablename__ = "sales_kpi_service_plans"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "pipeline_id",
            "year_month",
            "manager_user_id",
            "direction_id",
            name="uq_sales_kpi_service_plan_scope",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id", ondelete="CASCADE"), index=True)
    year_month: Mapped[date] = mapped_column(Date, index=True)
    manager_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    direction_id: Mapped[int] = mapped_column(ForeignKey("booking_directions.id", ondelete="CASCADE"), index=True)
    plan_qty: Mapped[int] = mapped_column(default=0)
    expert_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class SalesKpiWeightedSettings(Base):
    """Настройки взвешенного KPI на месяц: общий план + фонд бонуса на менеджера."""

    __tablename__ = "sales_kpi_weighted_settings"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "pipeline_id",
            "year_month",
            name="uq_sales_kpi_weighted_settings_scope",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id", ondelete="CASCADE"), index=True)
    year_month: Mapped[date] = mapped_column(Date, index=True)
    bonus_fund: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("10000"))


class SalesKpiPlanItem(Base):
    """Строка общего плана на месяц (одинакова для всех менеджеров)."""

    __tablename__ = "sales_kpi_plan_items"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "pipeline_id",
            "year_month",
            "name",
            name="uq_sales_kpi_plan_item_name",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id", ondelete="CASCADE"), index=True)
    year_month: Mapped[date] = mapped_column(Date, index=True)
    name: Mapped[str] = mapped_column(String(255))
    plan_qty: Mapped[int] = mapped_column(default=0)
    weight_percent: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("0"))
    # direction — факт из онлайн-записи (100% оплата); manual — курс/протокол без записи (≥25%).
    source_type: Mapped[str] = mapped_column(String(32), default="manual")
    direction_id: Mapped[int | None] = mapped_column(
        ForeignKey("booking_directions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    sort_order: Mapped[int] = mapped_column(default=0)


class SalesKpiManualSale(Base):
    """Продажа курса/протокола без онлайн-записи (вносит admin)."""

    __tablename__ = "sales_kpi_manual_sales"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id", ondelete="CASCADE"), index=True)
    plan_item_id: Mapped[int] = mapped_column(ForeignKey("sales_kpi_plan_items.id", ondelete="RESTRICT"), index=True)
    manager_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_name: Mapped[str] = mapped_column(String(255))
    client_phone: Mapped[str] = mapped_column(String(64))
    service_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    sold_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    # active | returned
    status: Mapped[str] = mapped_column(String(24), default="active")
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class PipelineStage(Base):
    __tablename__ = "pipeline_stages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
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

class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
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
    extra_phones: Mapped[list["LeadExtraPhone"]] = relationship(
        back_populates="lead",
        order_by="LeadExtraPhone.sort_order",
        cascade="all, delete-orphan",
    )


class LeadExtraPhone(Base):
    __tablename__ = "lead_extra_phones"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    phone: Mapped[str] = mapped_column(String(64))
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        insert_default=_utc_now,
    )

    lead: Mapped["Lead"] = relationship(back_populates="extra_phones")


class LeadAuditEvent(Base):
    __tablename__ = "lead_audit_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
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
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
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
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    is_active: Mapped[bool] = mapped_column(default=True)


class IntegrationProvider(str, enum.Enum):
    green_api = "green_api"  # WhatsApp via GREEN API
    telegram = "telegram"  # Telegram bot webhook
    instagram = "instagram"  # Meta webhook (placeholder)
    google_sheets = "google_sheets"  # Pull leads from Google Sheets
    gmail = "gmail"  # Gmail mailbox integration


class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
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

    # Кнопка «Закрыть сделку» на карточке лида для менеджеров (воронка = pipeline_id интеграции)
    manager_close_deal_enabled: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    pipeline_id: Mapped[int | None] = mapped_column(ForeignKey("pipelines.id", ondelete="SET NULL"), nullable=True)
    provider: Mapped[str] = mapped_column(String(40), default="green_api")
    external_chat_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class ChatThreadUserRead(Base):
    """До какого message.id пользователь «дочитал» диалог (для счётчика непрочитанных входящих)."""

    __tablename__ = "chat_thread_user_reads"
    __table_args__ = (UniqueConstraint("user_id", "thread_id", name="uq_chat_thread_user_reads_user_thread"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("chat_threads.id", ondelete="CASCADE"), index=True)
    last_read_message_id: Mapped[int] = mapped_column(default=0)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
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
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    pipeline_id: Mapped[int | None] = mapped_column(ForeignKey("pipelines.id", ondelete="SET NULL"), nullable=True, index=True)
    duration_min: Mapped[int] = mapped_column(default=30)
    is_active: Mapped[bool] = mapped_column(default=True)
    course_streams_enabled: Mapped[bool] = mapped_column(default=False)
    course_stream_max_days: Mapped[int] = mapped_column(default=15)
    course_stream_min_day_for_next: Mapped[int] = mapped_column(default=10)
    course_stream_gap_days: Mapped[int] = mapped_column(default=10)

    specialists: Mapped[list["BookingSpecialist"]] = relationship(back_populates="direction")
    appointments: Mapped[list["BookingAppointment"]] = relationship(back_populates="direction")


class BookingSpecialist(Base):
    __tablename__ = "booking_specialists"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    direction_id: Mapped[int] = mapped_column(ForeignKey("booking_directions.id", ondelete="RESTRICT"))
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    specialization: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Связь с учётной записью эксперта CRM (приглашение из «Сотрудники»)
    crm_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    is_active: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    slot_duration_min: Mapped[int] = mapped_column(default=30)
    work_start_hour: Mapped[int] = mapped_column(default=9)
    work_end_hour: Mapped[int] = mapped_column(default=18)
    work_weekdays: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Курсы / потоки: отображение 1:1, 1:10, 2:1 вместо простого счёта визитов
    course_streams_enabled: Mapped[bool] = mapped_column(default=False)
    course_stream_max_days: Mapped[int] = mapped_column(default=15)
    course_stream_min_day_for_next: Mapped[int] = mapped_column(default=10)
    course_stream_gap_days: Mapped[int] = mapped_column(default=10)

    direction: Mapped["BookingDirection"] = relationship(back_populates="specialists")
    appointments: Mapped[list["BookingAppointment"]] = relationship(back_populates="specialist")


class BookingAppointment(Base):
    __tablename__ = "booking_appointments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    # Снимок воронки в момент создания записи (для стабильной аналитики).
    pipeline_id: Mapped[int | None] = mapped_column(ForeignKey("pipelines.id", ondelete="SET NULL"), nullable=True)
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
    # Текст услуги с формы (без справочника направлений в UI).
    service_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)

    lead: Mapped["Lead | None"] = relationship(back_populates="booking_appointments")
    direction: Mapped["BookingDirection"] = relationship(back_populates="appointments")
    specialist: Mapped["BookingSpecialist"] = relationship(back_populates="appointments")


class Deal(Base):
    __tablename__ = "deals"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
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
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[TaskStatus] = mapped_column(
        SQLEnum(TaskStatus, name="task_status"),
        default=TaskStatus.pending,
    )
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Оценка выполнения задачи по 10-балльной шкале, выставляет постановщик после закрытия.
    review_score: Mapped[int | None] = mapped_column(nullable=True)
    review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    related_lead_id: Mapped[int | None] = mapped_column(
        ForeignKey("leads.id", ondelete="SET NULL"),
        nullable=True,
    )

    assignee: Mapped["User | None"] = relationship(back_populates="tasks", foreign_keys=[assigned_to])
    created_by: Mapped["User | None"] = relationship(foreign_keys=[created_by_user_id])
    related_lead: Mapped["Lead | None"] = relationship(
        back_populates="automation_tasks",
        foreign_keys=[related_lead_id],
    )


class AttendanceGeofence(Base):
    __tablename__ = "attendance_geofences"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    latitude: Mapped[Decimal] = mapped_column(Numeric(10, 7))
    longitude: Mapped[Decimal] = mapped_column(Numeric(10, 7))
    radius_m: Mapped[int] = mapped_column(default=120)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        insert_default=_utc_now,
        onupdate=_utc_now,
    )


class AttendanceShift(Base):
    __tablename__ = "attendance_shifts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    geofence_id: Mapped[int | None] = mapped_column(
        ForeignKey("attendance_geofences.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now, index=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    start_latitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    start_longitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    end_latitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    end_longitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    start_accuracy_m: Mapped[int | None] = mapped_column(nullable=True)
    end_accuracy_m: Mapped[int | None] = mapped_column(nullable=True)
    started_in_geofence: Mapped[bool] = mapped_column(default=False)
    ended_in_geofence: Mapped[bool | None] = mapped_column(nullable=True)
    suspicious: Mapped[bool] = mapped_column(default=False)
    suspicious_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class AttendancePing(Base):
    __tablename__ = "attendance_pings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    shift_id: Mapped[int | None] = mapped_column(
        ForeignKey("attendance_shifts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    geofence_id: Mapped[int | None] = mapped_column(
        ForeignKey("attendance_geofences.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    latitude: Mapped[Decimal] = mapped_column(Numeric(10, 7))
    longitude: Mapped[Decimal] = mapped_column(Numeric(10, 7))
    accuracy_m: Mapped[int | None] = mapped_column(nullable=True)
    distance_to_geofence_m: Mapped[int | None] = mapped_column(nullable=True)
    inside_geofence: Mapped[bool] = mapped_column(default=False)
    suspicious: Mapped[bool] = mapped_column(default=False)
    suspicious_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now, index=True)


class SuperOwnerAuditEvent(Base):
    """Журнал действий супер-владельца платформы (компании, тарифы, вход от имени владельца)."""

    __tablename__ = "super_owner_audit_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(160))
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now, index=True)


class PlatformSettings(Base):
    """Глобальные настройки платформы (одна строка id=1)."""

    __tablename__ = "platform_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    demo_trial_days: Mapped[int] = mapped_column(default=14)


class PlatformFeaturePrice(Base):
    """Цена функции в месяц по валюте (задаёт super_owner)."""

    __tablename__ = "platform_feature_prices"
    __table_args__ = (UniqueConstraint("feature_key", "currency", name="uq_platform_feature_price_key_currency"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    feature_key: Mapped[str] = mapped_column(String(48), index=True)
    currency: Mapped[str] = mapped_column(String(3), index=True)
    monthly_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))


class PlatformLimitPrice(Base):
    """Цена лимитов в месяц: за единицу слота пользователя/интеграции или фикс за склад."""

    __tablename__ = "platform_limit_prices"
    __table_args__ = (UniqueConstraint("limit_kind", "currency", name="uq_platform_limit_price_kind_currency"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # user_slot — за одного пользователя в лимите; integration_slot — за одну интеграцию; warehouse_monthly — фикс если склад включён.
    limit_kind: Mapped[str] = mapped_column(String(32), index=True)
    currency: Mapped[str] = mapped_column(String(3), index=True)
    monthly_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))


# --- ERP Finance (без налогового блока): настройки, GL, склады, товар, отложенная выручка ---


class FinanceCompanySettings(Base):
    """Политики учёта на компанию (включаемые модули)."""

    __tablename__ = "finance_company_settings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), unique=True, index=True)
    inventory_enabled: Mapped[bool] = mapped_column(default=False)
    # fifo | average
    costing_method: Mapped[str] = mapped_column(String(16), default="average")
    # payment | shipment | invoice
    revenue_goods_policy: Mapped[str] = mapped_column(String(24), default="shipment")
    # deferred_period | payment | shipment
    revenue_services_policy: Mapped[str] = mapped_column(String(24), default="deferred_period")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now, onupdate=_utc_now)
    # Последний успешный импорт ОСВ (для автоподстановки периода в отчётах)
    last_osv_import_from: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)
    last_osv_import_to: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)
    # Проводки с датой <= этой (по календарю UTC) запрещены, кроме служебных сценариев
    posting_locked_until: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)
    osv_sheet_url: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    osv_sheet_name: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)


class FinanceBudgetMonth(Base):
    """Помесячный план (выручка / расходы) для сравнения с фактом по журналу."""

    __tablename__ = "finance_budget_months"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    year: Mapped[int] = mapped_column()
    month: Mapped[int] = mapped_column()  # 1–12
    revenue_plan: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    expense_plan: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now, onupdate=_utc_now)

    __table_args__ = (UniqueConstraint("company_id", "year", "month", name="uq_finance_budget_co_ym"),)


class FinanceJournalTemplate(Base):
    """Шаблон ручной проводки (несколько строк по кодам счетов)."""

    __tablename__ = "finance_journal_templates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    # [{"account_code":"1010","debit":"0","credit":"1000.00"}, ...]
    lines: Mapped[list] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class FinanceWarehouse(Base):
    __tablename__ = "finance_warehouses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    is_default: Mapped[bool] = mapped_column(default=False)


class FinanceAccount(Base):
    __tablename__ = "finance_accounts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(255))
    # asset | liability | equity | revenue | expense
    account_type: Mapped[str] = mapped_column(String(24), default="asset")
    is_system: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)

    __table_args__ = (UniqueConstraint("company_id", "code", name="uq_finance_accounts_company_code"),)


class FinanceJournalEntry(Base):
    __tablename__ = "finance_journal_entries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    entry_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str] = mapped_column(String(40), default="manual")
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    related_lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True)
    related_deal_id: Mapped[int | None] = mapped_column(ForeignKey("deals.id", ondelete="SET NULL"), nullable=True, index=True)


class FinanceJournalLine(Base):
    __tablename__ = "finance_journal_lines"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("finance_journal_entries.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("finance_accounts.id", ondelete="RESTRICT"))
    debit: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    credit: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    dimensions: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class FinanceClosedMonth(Base):
    """Явное закрытие календарного месяца: запрет новых проводок с датой в этом месяце."""

    __tablename__ = "finance_closed_months"
    __table_args__ = (UniqueConstraint("company_id", "year", "month", name="uq_finance_closed_month_company_ym"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    year: Mapped[int] = mapped_column()
    month: Mapped[int] = mapped_column()
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    closed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class FinanceBankStatementLine(Base):
    """Строка выписки (импорт CSV) и ручная привязка к проводке журнала."""

    __tablename__ = "finance_bank_statement_lines"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    txn_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    journal_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("finance_journal_entries.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    matched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class FinanceProduct(Base):
    __tablename__ = "finance_products"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    sku: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    # good | service
    product_type: Mapped[str] = mapped_column(String(16), default="good")
    unit: Mapped[str] = mapped_column(String(32), default="pcs")
    is_active: Mapped[bool] = mapped_column(default=True)


class FinanceStockBalance(Base):
    __tablename__ = "finance_stock_balances"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("finance_products.id", ondelete="CASCADE"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("finance_warehouses.id", ondelete="CASCADE"), index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    avg_unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 4), default=Decimal("0"))

    __table_args__ = (UniqueConstraint("product_id", "warehouse_id", name="uq_finance_stock_bal_product_wh"),)


class FinanceStockMovement(Base):
    __tablename__ = "finance_stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("finance_warehouses.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("finance_products.id", ondelete="CASCADE"))
    qty_delta: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    # receipt | issue | transfer_out | transfer_in
    movement_type: Mapped[str] = mapped_column(String(24))
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    counter_warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("finance_warehouses.id", ondelete="SET NULL"), nullable=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class FinanceStockLayer(Base):
    """Партии для FIFO."""

    __tablename__ = "finance_stock_layers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("finance_products.id", ondelete="CASCADE"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("finance_warehouses.id", ondelete="CASCADE"), index=True)
    qty_remaining: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    movement_id: Mapped[int | None] = mapped_column(ForeignKey("finance_stock_movements.id", ondelete="SET NULL"), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class FinanceDeferredContract(Base):
    """Договор/абонемент: отложенная выручка услуг по периодам."""

    __tablename__ = "finance_deferred_contracts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    period_count: Mapped[int] = mapped_column(default=1)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class FinanceDeferredPeriod(Base):
    __tablename__ = "finance_deferred_periods"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("finance_deferred_contracts.id", ondelete="CASCADE"), index=True)
    period_no: Mapped[int] = mapped_column()
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    journal_entry_id: Mapped[int | None] = mapped_column(ForeignKey("finance_journal_entries.id", ondelete="SET NULL"), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (UniqueConstraint("contract_id", "period_no", name="uq_finance_deferred_contract_period"),)


class ServiceTemplate(Base):
    """Конструктор услуг: шаблон на воронку (разовая / протокол / курс)."""

    __tablename__ = "service_templates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id", ondelete="CASCADE"), index=True)
    direction_id: Mapped[int | None] = mapped_column(
        ForeignKey("booking_directions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255))
    service_type: Mapped[str] = mapped_column(String(32), default="single")  # single|protocol|course
    duration_days: Mapped[int | None] = mapped_column(nullable=True)
    visit_count: Mapped[int | None] = mapped_column(nullable=True)
    price_base: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    specialist_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    course_streams_enabled: Mapped[bool] = mapped_column(default=False)
    course_stream_max_days: Mapped[int] = mapped_column(default=15)
    course_stream_min_day_for_next: Mapped[int] = mapped_column(default=10)
    course_stream_gap_days: Mapped[int] = mapped_column(default=10)
    is_active: Mapped[bool] = mapped_column(default=True)
    is_legacy: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)


class ServicePaymentRule(Base):
    """Правило этапа оплаты в шаблоне (произвольное число этапов)."""

    __tablename__ = "service_payment_rules"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("service_templates.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int] = mapped_column(default=1)
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    kind: Mapped[str] = mapped_column(String(16), default="percent")  # percent|fixed
    value: Mapped[Decimal] = mapped_column(Numeric(14, 4), default=Decimal("0"))
    trigger_type: Mapped[str] = mapped_column(String(32), default="on_enrollment")
    trigger_day: Mapped[int | None] = mapped_column(nullable=True)
    trigger_days_offset: Mapped[int | None] = mapped_column(nullable=True)


class PatientServiceEnrollment(Base):
    """Подключённая услуга у лида."""

    __tablename__ = "patient_service_enrollments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("service_templates.id", ondelete="RESTRICT"), index=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id", ondelete="CASCADE"), index=True)
    direction_id: Mapped[int | None] = mapped_column(ForeignKey("booking_directions.id", ondelete="SET NULL"), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
    status: Mapped[str] = mapped_column(String(24), default="active")  # active|completed|cancelled
    total_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))


class PaymentInstallment(Base):
    """Этап оплаты по enrollment."""

    __tablename__ = "payment_installments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    enrollment_id: Mapped[int] = mapped_column(
        ForeignKey("patient_service_enrollments.id", ondelete="CASCADE"),
        index=True,
    )
    sort_order: Mapped[int] = mapped_column(default=1)
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(24), default="pending")  # pending|paid|overdue
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    journal_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("finance_journal_entries.id", ondelete="SET NULL"),
        nullable=True,
    )
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FinanceGmailInboxItem(Base):
    """Входящий документ из Gmail (черновик до проводки)."""

    __tablename__ = "finance_gmail_inbox"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    gmail_message_id: Mapped[str] = mapped_column(String(128), index=True)
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sender: Mapped[str | None] = mapped_column(String(320), nullable=True)
    attachment_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="pending")  # pending|applied|rejected
    parsed_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, insert_default=_utc_now)
