# Master Plan — Phase 0 (аудит)

Дата: 2026-09-25  
Репозиторий: MetodiOne (`backend/` + `frontend/`)

## Вердикт

Блокера, который ломает деньги / identity / LTV **прямо сейчас**, нет.  
Единой модели **Purchase / Payment / Paid LTV / Patient Journey** нет — деньги и визиты размазаны по контурам. Phase 6 (отчёт загрузки) уже в коде.

**Phase 8** («Центр управления») — только зарезервирован, не реализуется.

## Что уже есть

| Область | Факт |
|---------|------|
| Канонический пациент | `Lead` (`leads`); доп. телефоны `lead_extra_phones`; dedup телефонов **внутри воронки** |
| Запись | `BookingAppointment` + `paid_amount` / refund → ОСВ |
| Курсы/протоколы KPI | `SalesKpiManualSale` + `SalesKpiManualSalePayment` (**без `lead_id`**) |
| Desk / доп. услуги | phone-only, без Lead |
| Куратор | `curator_course_flows` / memberships / journal — Main Course дневник |
| Analytics UI | только `[Менеджеры] [Услуги]` |
| «LTV» | `GET /customer-value/{id}` = sum(`service_amount` визитов), **не Paid LTV**, UI не использует |
| Phase 6 | `/api/booking/reports/upcoming-services` + вкладка «Отчёт по услугам» |

## Расхождения с Master Plan

1. Нет сущности **Purchase ≠ Payment ≠ Delivery**.  
2. KPI/Desk/Extra **не привязаны к Lead** → Paid LTV по пациенту неполный без явной связи.  
3. Нет **Paid LTV / Sales Value / cohort first_purchase_at**.  
4. Patient Journey (на момент аудита отсутствовал) **не** равен жёсткой воронке
   `Course15 → Masterclass → MainCourse/Protocol`. Актуальная модель (Phase 2+):
   Universal Journey = Lead → первая valid Purchase Event → … → Lifetime / Paid LTV;
   Course15 — не обязательный entry point; Masterclass = event, не gate;
   MainCourse/Protocol допустимы без Course15 и без recorded Masterclass.
5. Нет вкладки **Пациенты & LTV**.  
6. Risk double-count: визиты «Курс/Протокол» в booking + KPI-пакеты (уже частично разделены в analytics services).  
7. Legacy `patient_service_enrollments` / installments — схема есть, CRUD мёртв; **не используем как source of truth** для LTV.

## Решения Phase 1 (совместимый минимум, без угадывания бизнес-веток)

Зафиксировано технически (совпадает с текстом Master Plan):

1. **Lead = patient.** Auto-merge по телефону для LTV **запрещён**.  
2. Новая проекция **`patient_purchases` + `patient_purchase_payments`** (не ломает booking/KPI таблицы).  
3. Источники purchase (idempotent `source_type` + `source_id`):  
   - `booking_appointment` — визиты **кроме** admin-only Курс/Протокол (их деньги только из KPI);  
   - `kpi_manual_sale` — пакеты курса/протокола;  
   - `desk_sale`, `extra_service_sale`.  
4. **Deal.protocol_*** (файл) ≠ продукт «Протокол» — в LTV Phase 1 **не** включаем.  
5. KPI без `lead_id` → purchase с `lead_id=NULL` (**unresolved**), в метриках пациента не мержится.  
6. Добавляем nullable `SalesKpiManualSale.lead_id` для **ручной/будущей** привязки, без auto-fill.  
7. Paid LTV = сумма payments − refunds; Sales Value = `service_amount` покупок;
   **Outstanding** = max(0, sa − net paid) по активному обязательству (math);
   **Operational Debt** = max(0, sa − paid − refunds) — канон KPI/Booking
   (`obligation_open_debt`); **REFUND ≠ AUTOMATIC DEBT**.
   Returned/cancelled → outstanding и operational_debt = 0.
   UI: «Остаток» ≠ «Дебиторка».

## Phase 8 (резерв)

Сегодня / Требует внимания / Аудит / Data Quality — после Phase 0–7, на том же ledger. Не строить сейчас.
