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
| REFUND ≠ AUTOMATIC DEBT | Outstanding vs Operational Debt; UI «Остаток»/«Дебиторка» |
| pytest | см. финальный отчёт |

## PHASE 0–7 = FROZEN BASELINE

Фундамент (Lead → Purchase → Payment/Refund → Paid LTV / Sales Value / Outstanding /
Operational Debt → Journey) **заморожен**. Не перестраивать без regression fail
или явной бизнес-причины. См. `UNIVERSAL-LTV-BASELINE.md`.

## Phase 8 — порядок (утверждён)

Подробности: `PHASE-8-DUAL-ELIGIBILITY.md`.

| Phase | Содержание | Статус |
|-------|------------|--------|
| **8A** | Docs + dual eligibility (CURRENT purchase / TARGET fully_paid) + compare API | **DONE** (`1a3cca6`) |
| **8B** | New sales identity: auto `lead_id` / Lead picker (не numeric UX) | **DONE** (`b6577b3`) |
| **8C** | Curator Journal — Курс 15 waiting queue | **DONE** |
| **8D** | Curator Journal — Протоколы 30д (без diary) | не начат |
| **8E** | Course 90-day program period | не начат |
| **8F** | Deposit DQ read-only (A/B/C/D) — **до** LTV cutover | не начат |
| **8G** | Fully-paid LTV Entry cutover | **заблокирован** до approve 8F |

**8A–8E:** Paid LTV math не менять.  
**8F:** только read-only classification; no auto-fix; no hardcode 1300.  
**8G:** только после отдельного approve + CURRENT vs TARGET report.
