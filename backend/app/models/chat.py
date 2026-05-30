"""Чат (этап разбиения models.py)."""

from app.models._legacy import ChatMessage, ChatThread, ChatThreadUserRead

__all__ = ["ChatThread", "ChatThreadUserRead", "ChatMessage"]
