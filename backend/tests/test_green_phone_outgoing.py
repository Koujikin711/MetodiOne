from app.services.green_incoming import parse_green_message_data


def test_reaction_is_not_stored_as_a_message():
    text, kind, url, mime, name = parse_green_message_data(
        {"typeMessage": "reactionMessage", "extendedTextMessageData": {"text": "👍"}}
    )
    assert text == ""
    assert kind == "text"
    assert url is None
    assert mime is None
    assert name is None


def test_phone_text_is_kept():
    text, *_rest = parse_green_message_data(
        {"typeMessage": "textMessage", "textMessageData": {"textMessage": "Мо бо запис кабул мекунем"}}
    )
    assert text == "Мо бо запис кабул мекунем"
