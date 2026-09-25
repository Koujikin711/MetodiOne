# Universal Patient LTV — baseline (зафиксировано)

Дата фиксации: 2026-09-25  
Commit-якорь: `cb85677` (+ последующие без перестройки фундамента).

Фундамент **не переделывать** без regression fail или явной бизнес-причины.

## Канон

| Правило | Контракт |
|---------|----------|
| Пациент | `Lead` = canonical patient |
| Старт LTV (**production CURRENT**) | первая **valid Purchase Event** любой услуги/продукта каталога |
| Старт LTV (**TARGET**, не cutover) | первая **fully-paid** покупка относительно `service_amount`; cutover = Phase **8G** после Deposit DQ **8F** |
| Course15 | **не** обязательный entry point |
| Masterclass | **event**, не gate; «не зафиксирован» ≠ «не посетил» |
| Main / Protocol | допустимы **без** Course15 и **без** recorded Masterclass |
| События | Purchase ≠ Payment ≠ Refund ≠ Appointment ≠ Delivery |
| Paid LTV | единый `normalize_money_event` → signed amount; refund **один раз** |
| Sales Value | отдельно от Paid LTV; debt не увеличивает Paid LTV |
| Outstanding | math остаток по **активному** обязательству (`sa − net paid`); не «Дебиторка» |
| Operational Debt | канон KPI `obligation_open_debt(sa, paid, refunds)`; **REFUND ≠ AUTOMATIC DEBT** |
| Returned / cancelled | обязательство прекращено → outstanding = operational_debt = 0 |
| Unresolved | `lead_id IS NULL` → **не** в patient LTV; остаются в company ledger |
| Coverage | linked / unresolved видимы owner в «Пациенты & LTV» |
| Phone | **запрещён** auto-merge только по телефону |
| Double-count | booking admin-only Курс/Протокол **не** purchase; деньги из KPI |
| Новые услуги | `other_service` / каталог → участвуют в LTV **без** hardcode имени |
| Multi-state | нет global `current_stage`; `branch` = analytical only |

## Source of truth (production)

```
Lead → First Valid Purchase → Next Valid Purchase → … → Lifetime / Paid LTV
```

TARGET (после 8F/8G):

```
Lead → First Fully-Paid Purchase (actual service_amount) → … → Lifetime / Paid LTV
```

Paid LTV всегда = payments − refunds (не меняется в 8A–8E).

Program context (Course15, Masterclass, Main/Protocol episodes) обогащает Journey,
но **не** аннулирует реальные purchases.

## Dual eligibility

См. `PHASE-8-DUAL-ELIGIBILITY.md`.  
Compare API: `GET /api/analytics/ltv/entry-compare` (не меняет `/ltv/cohort`).

## Код (не дублировать слой)

- Ledger: `patient_purchases` / `patient_purchase_payments`
- Sync / LTV: `app/services/patient_ltv.py`
- Entry modes: `app/services/ltv_entry_eligibility.py`
- Entry compare: `app/services/ltv_entry_compare.py`
- Paths / funnel: `app/services/patient_journey_paths.py`
- Cohort: `app/services/patient_ltv_analytics.py`
- UI: `frontend/src/components/AnalyticsPatientsLtvPanel.tsx`

## Backlog

Phase 5 Product Transitions — **сделано**.  
Phase 7 — **DONE** + REFUND ≠ AUTOMATIC DEBT.  
**PHASE 0–7 = FROZEN BASELINE.**  
Phase 8A — dual eligibility design (**DONE**). 8B–8G — по утверждённому порядку; 8G только после 8F.
