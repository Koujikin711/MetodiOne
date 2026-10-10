"""Открытие чата с рекламы создаёт карточку до первого сообщения."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.instagram_webhook import ad_open_note, handle_instagram_webhook


def test_ad_open_note_without_text():
    note = ad_open_note(
        {
            "sender": {"id": "1789"},
            "referral": {
                "source": "ADS",
                "type": "OPEN_THREAD",
                "ad_id": "55",
                "ads_context_data": {"ad_title": "Остеопат"},
            },
        }
    )
    assert note == "Открыл чат с рекламы.\nОстеопат"


def test_plain_click_and_organic_referral_do_not_open_a_card():
    assert ad_open_note({"sender": {"id": "1"}, "referral": {"source": "SHORTLINK", "type": "OPEN_THREAD"}}) is None
    assert ad_open_note({"sender": {"id": "1"}}) is None


def test_message_with_text_stays_a_normal_message():
    assert (
        ad_open_note(
            {
                "message": {"mid": "m1", "text": "Здравствуйте"},
                "referral": {"source": "ADS", "ad_id": "55"},
            }
        )
        is None
    )


def test_webhook_creates_lead_when_chat_opens_from_ad():
    created: list[dict] = []
    messages: list[str] = []

    async def create_lead_fn(db, **kwargs):
        created.append(kwargs)
        return SimpleNamespace(id=7, stage=None)

    async def upsert_thread_fn(db, **kwargs):
        return SimpleNamespace(id=3)

    async def add_message_fn(db, company_id, thread_id, text):
        messages.append(text)

    async def run():
        db = SimpleNamespace(refresh=AsyncMock())
        integ = SimpleNamespace(config={"page_access_token": "tok", "app_secret": ""})
        payload = {
            "object": "instagram",
            "entry": [
                {
                    "id": "page",
                    "messaging": [
                        {
                            "sender": {"id": "17890001"},
                            "recipient": {"id": "page"},
                            "referral": {
                                "source": "ADS",
                                "type": "OPEN_THREAD",
                                "ad_id": "99",
                                "ads_context_data": {"ad_title": "Курс 15"},
                            },
                        }
                    ],
                }
            ],
        }
        with (
            patch("app.services.instagram_webhook._audit_message_mid", new=AsyncMock(return_value=False)),
            patch("app.services.instagram_webhook._mark_message_mid", new=AsyncMock()),
            patch(
                "app.services.instagram_webhook.fetch_ig_user_display_name",
                new=AsyncMock(return_value="Амина (@amina)"),
            ),
        ):
            return await handle_instagram_webhook(
                db,
                integ=integ,
                company_id=1,
                raw_body=b"{}",
                payload=payload,
                signature_header=None,
                create_lead_fn=create_lead_fn,
                upsert_thread_fn=upsert_thread_fn,
                add_message_fn=add_message_fn,
                lead_read_fn=lambda lead: lead,
            )

    lead = asyncio.run(run())
    assert lead.id == 7
    assert created[0]["external_chat_id"] == "ig:17890001"
    assert created[0]["source_name"] == "INSTAGRAM_DM"
    assert created[0]["name"] == "Амина (@amina)"
    assert messages == ["Открыл чат с рекламы.\nКурс 15"]
