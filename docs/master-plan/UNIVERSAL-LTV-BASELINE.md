# Universal Patient LTV — baseline (зафиксировано)

Дата фиксации: 2026-09-25  
Commit-якорь: `cb85677` (+ последующие без перестройки фундамента).

Фундамент **не переделывать** без regression fail или явной бизнес-причины.

## Канон

| Правило | Контракт |
|---------|----------|
| Пациент | `Lead` = canonical patient |
| Старт LTV | первая **valid Purchase Event** любой услуги/продукта каталога |
| Course15 | **не** обязательный entry point |
| Masterclass | **event**, не gate; «не зафиксирован» ≠ «не посетил» |
| Main / Protocol | допустимы **без** Course15 и **без** recorded Masterclass |
| События | Purchase ≠ Payment ≠ Refund ≠ Appointment ≠ Delivery |
| Paid LTV | единый `normalize_money_event` → signed amount; refund **один раз** |
| Sales Value | отдельно от Paid LTV; debt не увеличивает Paid LTV |
| Unresolved | `lead_id IS NULL` → **не** в patient LTV; остаются в company ledger |
| Coverage | linked / unresolved видимы owner в «Пациенты & LTV» |
| Phone | **запрещён** auto-merge только по телефону |
| Double-count | booking admin-only Курс/Протокол **не** purchase; деньги из KPI |
| Новые услуги | `other_service` / каталог → участвуют в LTV **без** hardcode имени |

## Source of truth

```
Lead → First Valid Purchase → Next Valid Purchase → … → Lifetime / Paid LTV
```

Program context (Course15, Masterclass, Main/Protocol episodes) обогащает Journey,
но **не** аннулирует реальные purchases.

## Код (не дублировать слой)

- Ledger: `patient_purchases` / `patient_purchase_payments`
- Sync / LTV: `app/services/patient_ltv.py`
- Paths / funnel: `app/services/patient_journey_paths.py`
- Cohort: `app/services/patient_ltv_analytics.py`
- UI: `frontend/src/components/AnalyticsPatientsLtvPanel.tsx`

## Backlog (не blocker фундамента)

**Phase 5 — Product Transitions UI** на существующем Purchase Event engine
(без второго calculation layer): A→B, A→A, count, patients, share, interval.
