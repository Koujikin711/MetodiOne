from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.engine.url import make_url

from app.config import settings


def _effective_database_url() -> str:
    url = (settings.database_url or "").strip()
    if url:
        # Amvera/CI sometimes provides values with quotes or even "DATABASE_URL=...".
        # Also accept "postgres://..." which is common but not explicit about driver.
        if url.lower().startswith("database_url="):
            url = url.split("=", 1)[1].strip()
        if (url.startswith('"') and url.endswith('"')) or (url.startswith("'") and url.endswith("'")):
            url = url[1:-1].strip()

        low = url.lower()
        if low.startswith("postgres://"):
            url = "postgresql+asyncpg://" + url[len("postgres://") :]
        elif low.startswith("postgresql://") and not low.startswith("postgresql+"):
            url = "postgresql+asyncpg://" + url[len("postgresql://") :]

        # Validate early to fail with a clear error in logs.
        make_url(url)
        return url
    return "sqlite+aiosqlite:///./crm.db"


def _engine_kwargs() -> dict:
    url = _effective_database_url()
    kw: dict = {"echo": False, "pool_pre_ping": True}
    if "asyncpg" in url or url.startswith("postgresql"):
        kw.update(
            {
                "pool_size": max(1, int(settings.db_pool_size)),
                "max_overflow": max(0, int(settings.db_max_overflow)),
                "pool_timeout": max(1, int(settings.db_pool_timeout)),
                "pool_recycle": max(60, int(settings.db_pool_recycle_seconds)),
            }
        )
        kw["connect_args"] = {"timeout": 12}
    return kw


engine = create_async_engine(_effective_database_url(), **_engine_kwargs())

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
