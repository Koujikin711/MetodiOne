"""Пакет app.models после разбиения на подмодули."""

from app.models import Base, Lead, User, UserRole
from app.models.crm import Pipeline
from app.models.chat import ChatThread


def test_models_package_exports():
    assert User.__tablename__ == "users"
    assert Lead.__tablename__ == "leads"
    assert Pipeline.__tablename__ == "pipelines"
    assert ChatThread.__tablename__ == "chat_threads"
    assert UserRole.manager.value == "manager"
    assert Base is not None
