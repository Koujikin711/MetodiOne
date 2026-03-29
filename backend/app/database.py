from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings


def _engine_kwargs() -> dict:
    url = settings.database_url
    kw: dict = {"echo": False, "pool_pre_ping": True, "pool_timeout": 15}
    if "asyncpg" in url or url.startswith("postgresql"):
        kw["connect_args"] = {"timeout": 12}
    return kw


engine = create_async_engine(settings.database_url, **_engine_kwargs())

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
