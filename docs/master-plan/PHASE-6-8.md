# Phase 6–8 — статус

## Phase 6 — DONE (ранее + в main)

Online Booking → «Отчёт по услугам»: KPI + таблица + drill-down = summary.

## Phase 7 — checklist (текущий статус)

| Проверка | Статус |
|----------|--------|
| Purchase ledger sync | есть (`POST /ltv/sync`) |
| Paid LTV ≠ month revenue | cohort API |
| Double-count Курс/Протокол booking | исключены из purchase |
| Unique patient Lead.id (booking report) | да |
| Journey branch marker (first main/protocol) | да; оба продукта остаются в LTV; МК не gate |
| Course15/Masterclass ≠ purchase prerequisite | да |
| Curator journal ≠ Protocol auto-write | да |
| Permissions owner на LTV | да |
| Полный regression E2E всех модулей | **не автоматически** — ручной smoke после деплоя |
| KPI sales без lead_id в Paid LTV пациента | unresolved + coverage UI (ожидаемо) |
| Product Transitions (Phase 5 backlog) | **done** — A→B/A→A на Purchase Events |

## Phase 8 — НЕ реализуется

Резерв: Сегодня / Требует внимания / Аудит / Data Quality на том же ledger.
