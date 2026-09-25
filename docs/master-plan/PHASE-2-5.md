# Phase 2–5 — отчёт

## Phase 2–4 Journey

- Таблицы: `patient_journeys`, `patient_journey_episodes`, `patient_journey_events`
- Sync из purchases: Курс 15 → (МК event) → branch `main_course` XOR `protocols`
- Episodes #1…N без hardcode max
- Month 1/2/3 helper относительно старта episode
- Протоколы не пишутся в curator journal автоматически

## Phase 5 Analytics

- Вкладка **Пациенты & LTV**
- `GET /api/analytics/ltv/cohort` — когорта по `first_purchase_at`
- Avg Paid LTV, Sales Value, Repeat %, purchases/patient, lifetime, D0–D365
- Journey counters + patient table → Lead
- Sync button вызывает ledger + journey

## Phase 6

Уже в main (отчёт загрузки Online Booking).

## Phase 7 / 8

7 — сверка позже; 8 — не реализуется.
