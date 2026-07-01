from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Для прода задайте DATABASE_URL (PostgreSQL) в окружении платформы.
    # Если не задано — безопасный fallback на SQLite, чтобы приложение не падало при старте.
    database_url: str = ""
    db_pool_size: int = 20
    db_max_overflow: int = 20
    db_pool_timeout: int = 30
    db_pool_recycle_seconds: int = 1800
    secret_key: str = "change-me-in-production-use-openssl-rand-hex-32"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"

    # Онлайн-запись: имена стадий воронки (как в seed pipeline_stages)
    booking_queue_stage_name: str = "Квалифицирован"
    booking_stage_after_book: str = "Запись"
    booking_stage_completed: str = "Успешно реализован"
    booking_stage_lost: str = "Потерян"
    # Часовой пояс для проверки графика специалистов и слотов записи
    # По умолчанию: Таджикистан (Душанбе)
    booking_timezone: str = "Asia/Dushanbe"
    # Если основной номер лида не ответил менеджеру за N часов — WhatsApp уходит на доп. номер
    whatsapp_primary_reply_timeout_hours: int = 72

    # Public URL фронтенда (для invite ссылок)
    public_app_url: str = ""
    # Публичный URL API (для автоподключения Green API webhook), напр. https://api.example.com
    public_api_base_url: str = ""
    # Google Sheets service account (без скриптов у клиента: таблицу шарят на этот email).
    google_service_account_email: str = ""
    google_service_account_private_key: str = ""
    google_sheets_poll_seconds: int = 120

    # SMTP (если хотите реальную отправку писем)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "metoditj@gmail.com"
    demo_request_to_email: str = "metoditj@gmail.com"
    build_version: str = "dev"

    # Тариф (0 = без лимита). Задаётся в окружении для SaaS / демо.
    tariff_max_active_users: int = 0
    tariff_max_integrations: int = 0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
