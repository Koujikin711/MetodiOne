"""Базовые типы ORM (этап разбиения models.py)."""

from app.models._legacy import Base, TaskStatus, UserRole, _utc_now

__all__ = ["Base", "UserRole", "TaskStatus", "_utc_now"]
