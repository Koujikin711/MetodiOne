from pydantic import BaseModel, Field


class DirectionPaymentSummary(BaseModel):
    direction_id: int
    direction_name: str
    appointments_paid: float = 0
    appointments_billed: float = 0
    installments_paid: float = 0


class ExpertBookingItem(BaseModel):
    specialist_id: int
    specialist_name: str
    specialization: str | None = None
    patients_booked: int = 0
    patients_arrived: int = 0
    first_visit_patients: int = Field(default=0, description="Новые пациенты (первое обращение к специалисту)")
    repeat_patients: int = Field(default=0, description="Повторные пациенты")
    sessions_total: int = Field(default=0, description="Сеансы = Пришло (уникальные пациенты со статусом completed)")


class PipelineExpertReport(BaseModel):
    pipeline_id: int
    pipeline_name: str
    patients_booked: int = 0
    patients_arrived: int = 0
    first_visit_patients: int = 0
    repeat_patients: int = 0
    sessions_total: int = 0
    direction_payments: list[DirectionPaymentSummary] = Field(default_factory=list)
    experts: list[ExpertBookingItem] = Field(default_factory=list)


class ExpertReportsResponse(BaseModel):
    period_start: str
    period_end: str
    items: list[PipelineExpertReport] = Field(default_factory=list)

