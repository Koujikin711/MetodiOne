"""Каталог функций SaaS-тарифа: ключи, подписи, сопоставление с API-путями."""

from __future__ import annotations

FEATURE_LABELS: dict[str, str] = {
    "crm": "CRM, канбан и лиды",
    "tasks": "Задачи",
    "chat": "Чаты",
    "booking": "Онлайн-запись",
    "integrations": "Интеграции каналов",
    "finance": "Финансы",
    "analytics": "Аналитика",
    "kpi": "KPI продаж",
    "reports": "Отчёты эксперта",
    "employees": "Сотрудники и приглашения",
    "audit": "Журнал аудита",
    "attendance": "Учёт посещаемости",
}

ALL_FEATURE_KEYS: frozenset[str] = frozenset(FEATURE_LABELS)

# Самые длинные префиксы первыми (первое совпадение выигрывает).
_ROUTE_FEATURE_PAIRS: list[tuple[str, str]] = sorted(
    [
        ("/api/sales-kpi", "kpi"),
        ("/api/integrations", "integrations"),
        ("/api/employees", "employees"),
        ("/api/attendance", "attendance"),
        ("/api/analytics", "analytics"),
        ("/api/finance", "finance"),
        ("/api/booking", "booking"),
        ("/api/reports", "reports"),
        ("/api/audit", "audit"),
        ("/api/tasks", "tasks"),
        ("/api/chat", "chat"),
        ("/api/kpi", "kpi"),
        ("/api/users", "booking"),
        ("/api/leads", "crm"),
        ("/api/pipelines", "crm"),
        ("/api/stages", "crm"),
        ("/api/sources", "crm"),
        ("/api/deals", "crm"),
    ],
    key=lambda x: len(x[0]),
    reverse=True,
)


def validate_enabled_features(feature_keys: list[str]) -> tuple[bool, str | None]:
    """Проверка совместимости набора функций. Конфликтующие комбинации — запрещены."""
    keys = {str(x).strip() for x in feature_keys if str(x).strip() in ALL_FEATURE_KEYS}
    _ = keys
    return True, None


def tariff_feature_for_api_path(path: str) -> str | None:
    """Вернуть ключ функции для запроса к API или None, если тариф не применяется."""
    for prefix, key in _ROUTE_FEATURE_PAIRS:
        if path == prefix or path.startswith(prefix + "/"):
            return key
    return None
