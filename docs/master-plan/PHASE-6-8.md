# Phase 6–8 — статус

## Phase 6 — DONE

Online Booking → «Отчёт по услугам».

## Phase 7 — DONE (2026-09-25)

| Проверка | Статус |
|----------|--------|
| Production Sync ledger | выполнен (идемпотентен) |
| 6 booking_refund reconciliation | PASS (leads 38849, 39513; top-200 miss = low Paid LTV) |
| KPI unresolved classification | unique≈52 / ambiguous=0 / no_lead≈10 / returned=1 (phone=signal only) |
| Safe linking new KPI sales | `lead_id` на create + `PATCH .../link-lead` (owner, explicit) |
| No phone auto-merge | да |
| Coverage | Before 97.7%; After **unchanged** (no blind link) |
| MainCourse / Protocol | 1 sale = 1 purchase; payments ≠ purchases; MK/C15 not required |
| Product Transitions | done (Phase 5) |
| pytest | см. финальный отчёт |

## Phase 8 — НЕ реализуется
