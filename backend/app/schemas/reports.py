from pydantic import BaseModel, Field


class ExpertBookingItem(BaseModel):
    specialist_id: int
    specialist_name: str
    specialization: str | None = None
    patients_booked: int = 0
    patients_arrived: int = 0
    first_visit_patients: int = Field(default=0, description="Новые пациенты (первое обращение к специалисту)")
    repeat_patients: int = Field(default=0, description="Повторные пациенты")
    sessions_total: int = Field(default=0, description="Количество визитов (неотменённых записей) за период")


class PipelineExpertReport(BaseModel):
    pipeline_id: int
    pipeline_name: str
    patients_booked: int = 0
    patients_arrived: int = 0
    first_visit_patients: int = 0
    repeat_patients: int = 0
    sessions_total: int = 0
    experts: list[ExpertBookingItem] = Field(default_factory=list)


class ExpertReportsResponse(BaseModel):
    period_start: str
    period_end: str
    items: list[PipelineExpertReport] = Field(default_factory=list)

