"""Ведомость: формулы оклада и начисления."""

from datetime import date
from decimal import Decimal

from app.services.payroll_rules import (
    PayrollFacts,
    accrue,
    carried_company_debt,
    company_balance,
    is_free_gift_session,
    payroll_name_on,
    payroll_profile,
    service_line,
)


def test_service_lines_do_not_mix_speech_and_massage():
    assert service_line("Массаж") == "massage"
    assert service_line("Логомассаж") == "speech_massage"
    assert service_line("ТМС") == "tms"
    assert service_line("Остеопат") == "osteopath"
    assert service_line("Анализы") == "lab"


def test_profiles_follow_role_and_specialization():
    assert payroll_profile("expert", "Невролог") == "neurologist"
    assert payroll_profile("expert", "Невролог курса 15") == "neurologist_referral"
    assert payroll_profile("expert", "Невролог", "Алиев Курс") == "neurologist"
    assert payroll_profile("expert", "Эндокринолог") == "endocrinologist"
    assert payroll_profile("expert", "Массажист") == "massage"
    assert payroll_profile("expert", "Логомассажист") == "speech_massage"
    assert payroll_profile("expert", "Остеопат") == "osteopath"
    assert payroll_profile("expert", "Нутрициолог") == "nutritionist"
    assert payroll_profile("manager", "") == "manager"
    assert payroll_profile("curator", "") == "curator"
    assert payroll_profile("administrator", "") == "administrator"


def test_renamed_employee_keeps_old_months_and_counts_forward_under_the_new_name():
    history = [
        (date(2000, 1, 1), "Саидов Али"),
        (date(2026, 10, 3), "Каримов Бехруз"),
    ]
    assert payroll_name_on(history, date(2026, 9, 30), "Каримов Бехруз") == "Саидов Али"
    assert payroll_name_on(history, date(2026, 10, 31), "Саидов Али") == "Каримов Бехруз"
    assert payroll_name_on([], date(2026, 10, 31), "Невролог без смены") == "Невролог без смены"


def test_free_gift_massage_and_tms_are_not_bonus_sessions():
    assert is_free_gift_session(0, 0, "Массаж") is True
    assert is_free_gift_session(0, 0, "ТМС") is True
    assert is_free_gift_session(150, 0, "Массаж", "подарок") is True
    assert is_free_gift_session(150, 150, "Массаж") is False
    assert is_free_gift_session(200, 0, "ТМС") is False


def test_payroll_sheet_starts_with_doctors_then_massage_then_managers():
    from app.services.payroll_rules import payroll_sheet_sort_key

    people = [
        ("manager", "Алибекзода Мавлуда"),
        ("neurologist", "Шокирова Мунира"),
        ("administrator", "Мадина Шакармамадова"),
        ("neurologist", "Замири Ганчина"),
        ("massage", "Азизов Мубин"),
        ("endocrinologist", "Толибзода Аъзамат"),
        ("massage", "Абдулоева Рухшона"),
        ("massage", "Абдуллозода Аниса"),
        ("osteopath", "Каримова Манижа"),
        ("curator", "Холикова Манижа"),
        ("manager", "Саидзода Дилнора"),
    ]
    names = [name for _, name in sorted(people, key=lambda item: payroll_sheet_sort_key(*item))]
    assert names == [
        "Замири Ганчина",
        "Шокирова Мунира",
        "Толибзода Аъзамат",
        "Мадина Шакармамадова",
        "Абдулоева Рухшона",
        "Абдуллозода Аниса",
        "Азизов Мубин",
        "Каримова Манижа",
        "Холикова Манижа",
        "Алибекзода Мавлуда",
        "Саидзода Дилнора",
    ]


def test_neurologist_and_endocrinologist_use_the_same_percents_on_their_own_cash():
    facts = PayrollFacts(
        osteopath_paid=Decimal("1000"),
        tms_paid=Decimal("200"),
        lab_paid=Decimal("100"),
        massage_paid=Decimal("300"),
    )
    neuro = accrue("neurologist", facts, card_salary=None)
    endo = accrue("endocrinologist", facts, card_salary=None)
    # 3%*1000 + 5%*200 + 5%*100 + 5%*300 = 30+10+5+15 = 60
    assert neuro.base_salary == Decimal("5000")
    assert endo.base_salary == Decimal("3000")
    assert neuro.bonus == endo.bonus == Decimal("60.00")


def test_referral_neurologist_gets_flat_per_main_course():
    line = accrue("neurologist_referral", PayrollFacts(referred_main_courses=4), card_salary=None)
    assert line.base_salary == Decimal("3000")
    assert line.bonus == Decimal("400.00")


def test_massage_bonus_starts_after_session_floor():
    under = accrue("massage", PayrollFacts(own_sessions=208), card_salary=None)
    over = accrue("massage", PayrollFacts(own_sessions=210), card_salary=None)
    speech = accrue("speech_massage", PayrollFacts(own_sessions=262), card_salary=None)
    assert under.base_salary == Decimal("3000")
    assert under.bonus == Decimal("0.00")
    assert over.bonus == Decimal("54.00")
    assert speech.base_salary == Decimal("4500")
    assert speech.bonus == Decimal("54.00")


def test_osteopath_is_thirty_percent_of_own_sessions():
    line = accrue("osteopath", PayrollFacts(own_osteopath_paid=Decimal("1000")), card_salary=Decimal("999"))
    assert line.base_salary == Decimal("0")
    assert line.bonus == Decimal("300.00")


def test_carried_company_debt_uses_last_typed_amount():
    rows = [
        ("2026-08", Decimal("1000")),
        ("2026-09", None),
        ("2026-11", Decimal("4000")),
    ]
    assert carried_company_debt(rows, "2026-10") == Decimal("1000")
    assert carried_company_debt(rows, "2026-11") == Decimal("4000")
    assert carried_company_debt([("2026-09", Decimal("0"))], "2026-10") == Decimal("0")


def test_company_balance_is_unpaid_salary_not_patient_debt():
    owed = company_balance([(Decimal("2000"), Decimal("0")), (Decimal("2500"), Decimal("2000"))])
    assert owed == Decimal("2500")
    overpaid = company_balance([(Decimal("2000"), Decimal("3500"))])
    assert overpaid == Decimal("-1500")


def test_manager_bonus_waits_for_first_payments_and_debt_stays_visible():
    low = accrue(
        "manager",
        PayrollFacts(first_course_payments=Decimal("26000"), kpi_bonus=Decimal("800"), open_debt=Decimal("1500")),
        card_salary=Decimal("100"),
    )
    high = accrue(
        "manager",
        PayrollFacts(first_course_payments=Decimal("26000.01"), kpi_bonus=Decimal("800"), open_debt=Decimal("1500")),
        card_salary=None,
    )
    assert low.base_salary == Decimal("2000")
    assert low.bonus == Decimal("0.00")
    assert low.debt == Decimal("0")
    assert high.bonus == Decimal("800.00")


def test_curator_admin_and_nutritionist():
    curator = accrue("curator", PayrollFacts(debt_collected=Decimal("5000")), card_salary=None)
    admin = accrue("administrator", PayrollFacts(single_procedure_paid=Decimal("10000")), card_salary=None)
    food = accrue("nutritionist", PayrollFacts(), card_salary=Decimal("1"))
    assert curator.base_salary == Decimal("2000")
    assert curator.bonus == Decimal("100.00")
    assert curator.debt == Decimal("0")
    assert admin.base_salary == Decimal("3500")
    assert admin.bonus == Decimal("200.00")
    assert food.base_salary == Decimal("4000")
    assert food.bonus == Decimal("0")
