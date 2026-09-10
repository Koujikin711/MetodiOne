"""Дедуп WhatsApp-диалогов (chat_threads)."""

from app.services.chat_thread_dedup import normalize_whatsapp_chat_id


def test_normalize_whatsapp_chat_id_adds_tj_cc():
    assert normalize_whatsapp_chat_id("904160109@c.us") == "992904160109@c.us"
    assert normalize_whatsapp_chat_id("992904160109@c.us") == "992904160109@c.us"
    assert normalize_whatsapp_chat_id(" 992904160109@c.us ") == "992904160109@c.us"
    assert normalize_whatsapp_chat_id(None) is None
    assert normalize_whatsapp_chat_id("ig:123") == "ig:123"


def test_upsert_thread_prefers_existing_lead_thread():
    import inspect

    from app.services import integration_inbound as m

    src = inspect.getsource(m.upsert_thread)
    assert "ChatThread.lead_id == lead.id" in src
    assert "pg_advisory_xact_lock" in src
    assert "normalize_whatsapp_chat_id" in src
    assert "begin_nested" in src


def test_merge_duplicate_chat_threads_contract():
    import inspect

    from app.services import chat_thread_dedup as m

    src = inspect.getsource(m.merge_duplicate_chat_threads)
    assert "merged_exact" in src
    assert "merged_lead" in src
    assert "green_api" in src
