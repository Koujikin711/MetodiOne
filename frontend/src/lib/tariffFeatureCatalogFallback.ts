import type { FeatureCatalogItem } from "@/lib/types";

/** Синхронно с `backend/app/services/tariff_catalog.py` → `FEATURE_LABELS` (на случай сбоя GET /catalog/features). */
export const TARIFF_FEATURE_CATALOG_FALLBACK: FeatureCatalogItem[] = [
  { key: "analytics", label: "Аналитика" },
  { key: "attendance", label: "Учёт посещаемости" },
  { key: "audit", label: "Журнал аудита" },
  { key: "booking", label: "Онлайн-запись" },
  { key: "chat", label: "Чаты" },
  { key: "crm", label: "CRM, канбан и лиды" },
  { key: "employees", label: "Сотрудники и приглашения" },
  { key: "finance", label: "Финансы" },
  { key: "horeca", label: "HoReCa (ресторан: зал, кухня, себестоимость)" },
  { key: "integrations", label: "Интеграции каналов" },
  { key: "kpi", label: "KPI продаж" },
  { key: "reports", label: "Отчёты эксперта" },
  { key: "tasks", label: "Задачи" },
];
