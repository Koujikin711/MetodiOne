"""CRM-сущности (этап разбиения models.py)."""

from app.models._legacy import (
    Deal,
    Lead,
    LeadAuditEvent,
    LeadSource,
    Pipeline,
    PipelineStage,
    UserPipelineAssignment,
)

__all__ = [
    "Pipeline",
    "PipelineStage",
    "Lead",
    "LeadAuditEvent",
    "LeadSource",
    "Deal",
    "UserPipelineAssignment",
]
