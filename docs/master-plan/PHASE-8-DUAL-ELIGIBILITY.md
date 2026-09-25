# Phase 8 — Dual LTV Entry Eligibility (design)

Дата: 2026-09-25  
Статус: **8A DONE** (docs + compare API). Production analytics **не** переключены.

## Зачем

Бизнес-цель: LTV Entry / First Purchase = первая **полностью оплаченная**
покупка относительно `service_amount` конкретной продажи.

Но audit показал Deposit Data Quality:

| Класс | Пример | Риск |
|-------|--------|------|
| Clear partial | 1300 / 300 | OK для full-pay predicate |
| Technically full, possible deposit | 300 / 300 на Курс 15 | `paid >= service` **ложно** даёт Entry |
| Clear full | надёжный contracted amount + полная оплата | OK |
| Unknown | мало evidence | нужен owner review |

Поэтому **cutover на fully-paid Entry запрещён**, пока не пройден Phase **8F**
(read-only DQ, без auto-fix и без hardcode 1300).

## Два режима

| Mode | Код | Production default |
|------|-----|--------------------|
| **CURRENT** | `purchase` | **да** — первая valid Purchase Event (`purchased_at`) |
| **TARGET** | `fully_paid` | **нет** — первая покупка с `paid ≥ service_amount` и `service_amount > 0` |

Paid LTV formula в обоих режимах **одинакова**: `payments − refunds`.  
Меняется только **якорь Entry / cohort membership / First Product / D-windows / Repeat definition** в TARGET-проекции.

### TARGET predicate (без hardcode цен)

```
status ∉ {cancelled, returned}
service_amount > 0
paid_amount + ε ≥ service_amount
```

`status=completed` **сам по себе** не даёт Entry при `service_amount ≤ 0`
(booking placeholders).  
`service_amount = paid_amount = 200–300` на Курс 15 технически проходит —
это класс **B** для Phase 8F, не auto-rewrite.

## Side-by-side

API (owner): `GET /api/analytics/ltv/entry-compare?date_from=&date_to=`

Возвращает CURRENT и TARGET cohort snapshots + `first_at_changed_patients`
(сколько linked пациентов с разным `first_purchase_at` между режимами).

Дефолтный `GET /api/analytics/ltv/cohort` **без изменений** (= CURRENT).

## Порядок Phase 8 (утверждён)

| Phase | Содержание | Cutover? |
|-------|------------|----------|
| **8A** | Docs + dual eligibility design + compare | нет |
| **8B** | New sales identity (`lead_id` auto / picker) | — |
| **8C** | Curator Journal — Курс 15 queue | — |
| **8D** | Curator Journal — Протоколы (30д, без diary) | — |
| **8E** | Course 90-day program period | — |
| **8F** | Deposit DQ read-only (A/B/C/D) | нет auto-fix |
| **8G** | Fully-paid LTV cutover | только после approve 8F |

## Multi-state

Не вводить global `current_stage`.  
`branch` остаётся analytical/historical; очереди — из active program events.

## Запреты

- mass-link / phone auto-merge  
- hardcode цен (1300 / 17000 / …)  
- automatic history rewrite  
- Phase 8G до approve 8F  
- изменение Paid LTV math в 8A–8E  
