"""Полный диск не должен ронять входящее голосовое WhatsApp."""

from __future__ import annotations

import asyncio
import errno
import os
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.models import Base, ChatMessage, ChatThread, Company
from app.services import chat_media_store
from app.services.green_incoming_media import persist_incoming_green_media_if_needed


def test_low_space_deletes_oldest_media_and_keeps_recent_and_the_database(tmp_path: Path, monkeypatch):
    media = tmp_path / "chat_media"
    media.mkdir()
    monkeypatch.setattr(settings, "chat_media_dir", str(media))
    monkeypatch.setattr(chat_media_store, "_KEEP_RECENT_FILES", 2)
    monkeypatch.setattr(chat_media_store, "_media_search_directories", lambda: [media])
    database = tmp_path / "crm.db"
    database.write_bytes(b"database")
    nested = media / "not-a-file"
    nested.mkdir()
    now = 1_700_000_000
    for index in range(1, 6):
        path = media / f"{index}.ogg"
        path.write_bytes(b"old" * 20)
        os.utime(path, (now + index, now + index))

    def fake_free(path: Path) -> int:
        count = sum(1 for child in Path(path).iterdir() if child.is_file())
        return 0 if count > 3 else 10**12

    monkeypatch.setattr(chat_media_store, "_free_bytes", fake_free)
    url = chat_media_store.save_chat_media(99, "voice.oga", b"new-voice", mime="audio/ogg")

    assert url == "/api/chat/messages/99/media"
    assert (media / "99.oga").read_bytes() == b"new-voice"
    assert not (media / "1.ogg").exists()
    assert not (media / "2.ogg").exists()
    assert (media / "4.ogg").exists()
    assert (media / "5.ogg").exists()
    assert nested.is_dir()
    assert database.read_bytes() == b"database"


def test_voice_webhook_still_stores_the_message_when_disk_is_full(tmp_path: Path, monkeypatch):
    media = tmp_path / "chat_media"
    media.mkdir()
    db_path = tmp_path / "messages.sqlite3"
    monkeypatch.setattr(settings, "chat_media_dir", str(media))
    monkeypatch.setattr(chat_media_store, "_media_search_directories", lambda: [media])
    real_write = Path.write_bytes

    def full_disk(self: Path, data: bytes):
        if self.parent.resolve() == media.resolve():
            real_write(self, b"partial")
            raise OSError(errno.ENOSPC, "No space left on device")
        return real_write(self, data)

    monkeypatch.setattr(Path, "write_bytes", full_disk)

    async def keep_audio(content: bytes, filename: str | None, mime: str | None):
        return content, filename or "voice.oga", mime or "audio/ogg"

    async def downloaded(*_args, **_kwargs):
        return b"OggS-voice-note", "audio/ogg"

    monkeypatch.setattr(
        "app.services.green_incoming_media.prepare_incoming_audio_for_playback",
        keep_audio,
    )
    monkeypatch.setattr(
        "app.services.green_incoming_media.download_green_incoming_media",
        downloaded,
    )

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def _run() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with session_maker() as session:
            company = Company(name=f"clinic-{tmp_path.name}", is_active=True, crm_mode="clinic")
            session.add(company)
            await session.flush()
            thread = ChatThread(
                company_id=company.id,
                provider="green_api",
                external_chat_id="992900000000@c.us",
                title="Клиент",
            )
            session.add(thread)
            await session.flush()
            msg = ChatMessage(
                company_id=company.id,
                thread_id=thread.id,
                direction="in",
                text="Салом, голосовое",
                message_type="audio",
                media_url="https://example.test/voice.oga",
                media_mime="audio/ogg",
                file_name="voice.oga",
                provider_message_id="GREEN-VOICE-1",
            )
            session.add(msg)
            await session.flush()
            await persist_incoming_green_media_if_needed(
                session,
                msg=msg,
                config={},
                chat_id="992900000000@c.us",
                id_message="GREEN-VOICE-1",
                message_type="audio",
                download_url="https://example.test/voice.oga",
                file_name="voice.oga",
                media_mime="audio/ogg",
            )
            await session.commit()
            message_id = int(msg.id)
        async with session_maker() as session:
            saved = await session.get(ChatMessage, message_id)
            assert saved is not None
            assert saved.text == "Салом, голосовое"
            assert saved.provider_message_id == "GREEN-VOICE-1"
            assert saved.file_name == "voice.oga"
            assert saved.media_url == "https://example.test/voice.oga"
        await engine.dispose()

    asyncio.run(_run())
    assert list(media.iterdir()) == []
