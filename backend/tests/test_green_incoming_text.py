"""Входящий WhatsApp: реакция не становится репликой, повтор текста узнаётся."""

from app.services.green_incoming import parse_green_message_data
from app.services.integration_inbound import normalize_incoming_text


def test_reaction_is_not_stored_as_a_chat_line():
    text, kind, url, mime, name = parse_green_message_data({"typeMessage": "reactionMessage"})
    assert text == ""
    assert kind == "text"
    assert url is None
    assert mime is None
    assert name is None


def test_client_text_is_kept():
    text, kind, url, _, _ = parse_green_message_data(
        {"typeMessage": "textMessage", "textMessageData": {"textMessage": "  Мо бо запис кабул мекунем  "}}
    )
    assert text == "Мо бо запис кабул мекунем"
    assert kind == "text"
    assert url is None


def test_normalize_incoming_text_collapses_spaces():
    assert normalize_incoming_text("Кайбаремшон  апачон") == "Кайбаремшон апачон"
    assert normalize_incoming_text("  ") == ""
