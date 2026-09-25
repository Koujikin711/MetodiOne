# Phase 1 — отчёт

## Сделано

1. `docs/master-plan/PHASE-0.md` — аудит vs Master Plan.  
2. Таблицы `patient_purchases` / `patient_purchase_payments` + migrate `ensure_patient_purchase_tables`.  
3. Nullable `sales_kpi_manual_sales.lead_id` (без auto-fill / auto-merge).  
4. Sync `sync_company_purchases` + формулы Paid LTV / Sales Value / outstanding / lifetime.  
5. Anti double-count: визиты admin-only Курс/Протокол **не** становятся purchase (деньги из KPI).  
6. API: `POST /api/analytics/ltv/sync`, `GET /api/analytics/ltv/patient/{lead_id}`.  
7. Tests: `tests/test_patient_ltv_phase1.py`.

## Не сделано в Phase 1 (по плану позже)

- Patient Journey episodes (Phase 2–4)  
- Вкладка Analytics «Пациенты & LTV» (Phase 5)  
- Полный backfill на старте для всех компаний (sync по запросу owner)

## Бизнес-решения (зафиксированы, без паузы)

| Вопрос | Решение |
|--------|---------|
| Что purchase из booking | Все визиты кроме admin-only Курс/Протокол |
| KPI без lead_id | purchase unresolved (`lead_id=NULL`) |
| Phone merge | запрещён |
| Deal.protocol файл | не в LTV Phase 1 |
