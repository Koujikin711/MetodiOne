# Phase 2–5 — отчёт

## Universal Patient Journey (уточнение)

Source of truth:

```
Lead → First Valid Purchase → Next Valid Purchase → … → Lifetime / Paid LTV
```

- **Course15** и **Masterclass** — program context / events, **не** обязательный gate
  для Main Course / Protocol и **не** фильтр LTV.
- Отсутствие `master_class` ≠ «не посетил»; формулировка: «посещение не зафиксировано».
- Не backfill fake Masterclass / completion из последующей покупки.
- Branch `main_course` / `protocols` — маркер первой program-ветки (аналитика),
  не запрет второй покупки.

## Phase 2–4 Journey

- Таблицы: `patient_journeys`, `patient_journey_episodes`, `patient_journey_events`
- Sync из реальных purchases + явный `master_class` event
- Episodes #1…N без hardcode max
- Month 1/2/3 helper относительно старта episode
- Протоколы не пишутся в curator journal автоматически

## Phase 5 Analytics

- Вкладка **Пациенты & LTV**
- `GET /api/analytics/ltv/cohort` — когорта по `first_purchase_at`
- Avg Paid LTV, Sales Value, Repeat %, purchases/patient, lifetime, D0–D365
- First Product, **Product Transitions** (A→B / A→A, count, patients, share of from, interval)
- Course15 funnel (в т.ч. без recorded МК), conversions, Main/Protocol origin
- Data coverage: purchases linked / unresolved (без phone auto-merge)
- Patient table → Lead
- Sync button вызывает ledger + journey

Baseline канона: `docs/master-plan/UNIVERSAL-LTV-BASELINE.md`.

## Phase 6

Уже в main (отчёт загрузки Online Booking).

## Phase 7 / 8

7 — сверка позже; 8 — не реализуется.
