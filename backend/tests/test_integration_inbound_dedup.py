"""Дедуп лидов/тредов из интеграций (один номер WhatsApp → одна карточка)."""

from app.services.integration_inbound import norm_phone


def test_norm_phone_strips_plus():
    assert norm_phone("+992936020901") == "992936020901"
    assert norm_phone("992 936 020 901") == "992936020901"


def test_find_existing_lead_prefers_chat_then_phone():
    """Контракт: сначала chatId, потом телефон (воронка → вся компания), без source."""
    import inspect

    from app.services import integration_inbound as m

    src = inspect.getsource(m.find_existing_lead)
    assert "find_lead_by_any_phone" in src
    assert "pipeline_id=None" in src
    assert "ChatThread.external_chat_id == ext" in src
    assert "Lead.source ==" not in src


def test_upsert_thread_dedupes_by_external_chat_id():
    import inspect

    from app.services import integration_inbound as m

    src = inspect.getsource(m.upsert_thread)
    assert "ChatThread.external_chat_id == ext" in src
