"""Правила ведомости. Суммы — из факта месяца, не из прайса."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

Q = Decimal("0.01")
OSTEOPATH_SHARE = Decimal("0.03")
PROCEDURE_SHARE = Decimal("0.05")
OSTEOPATH_EXPERT_SHARE = Decimal("0.30")
CURATOR_DEBT_SHARE = Decimal("0.02")
ADMIN_CASH_SHARE = Decimal("0.02")
SESSION_BONUS = Decimal("27")
REFERRAL_BONUS = Decimal("100")
MANAGER_FIRST_PAYMENT_FLOOR = Decimal("26000")
MASSAGE_SESSION_FLOOR = 208
SPEECH_SESSION_FLOOR = 260


def _q(value: Decimal) -> Decimal:
    return Decimal(str(value or 0)).quantize(Q)


def payroll_name_on(history: list[tuple[date, str]], day: date, fallback: str) -> str:
    """ФИО, которое стояло на карточке в этот день. Более поздняя смена его не затирает."""
    chosen = (fallback or "").strip()
    latest: date | None = None
    for effective_on, full_name in history:
        name = (full_name or "").strip()
        if not name or effective_on > day:
            continue
        if latest is None or effective_on >= latest:
            latest = effective_on
            chosen = name
    return chosen


def is_free_gift_session(
    service_amount: Decimal | str | int | float | None,
    paid_amount: Decimal | str | int | float | None,
    *labels: str | None,
) -> bool:
    """Подарок: в тексте есть «подарок» или сеанс бесплатный (цена и оплата нулевые)."""
    text = " ".join((part or "") for part in labels).casefold().replace("ё", "е")
    if "подарок" in text or "подароч" in text:
        return True
    service = Decimal(str(service_amount or 0))
    paid = Decimal(str(paid_amount or 0))
    return service <= Decimal("0.01") and paid <= Decimal("0.01")


def service_line(name: str | None) -> str:
    """Линия разовой услуги по названию направления или записи."""
    k = (name or "").casefold().replace("ё", "е")
    if "логомассаж" in k or "логопед" in k:
        return "speech_massage"
    if "остеоп" in k or "остиоп" in k:
        return "osteopath"
    if "тмс" in k or "tms" in k:
        return "tms"
    if "анализ" in k or "лаборат" in k:
        return "lab"
    if "массаж" in k:
        return "massage"
    return "other"


_REFERRAL_LINES = frozenset({"osteopath", "tms", "lab", "massage"})


def referral_procedure_line(*names: str | None) -> str | None:
    """Остеопатия, ТМС, анализы, массаж. Логомассаж и курс сюда не входят."""
    lines = [service_line(name) for name in names if (name or "").strip()]
    if "speech_massage" in lines:
        return None
    for line in lines:
        if line in _REFERRAL_LINES:
            return line
    return None


def referrer_change_blocked(current_id: int | None, new_id: int, role: str) -> str | None:
    """Уже указанного врача не переписывают. Исправить может владелец или админ воронки."""
    if current_id is None or int(current_id) == int(new_id):
        return None
    if role in ("owner", "super_owner", "admin"):
        return None
    return "Направившего врача менять нельзя"


def payroll_profile(role: str, specialization: str | None = None, *_names: str | None) -> str:
    """Правило ведомости. У эксперта его задаёт специализация, не ФИО.

    Невролог и невролог курса 15 — разные эксперты. Фамилия в расчёт не входит.
    """
    del _names
    text = (specialization or "").casefold().replace("ё", "е")
    if role == "curator":
        return "curator"
    if role in ("administrator", "admin"):
        return "administrator"
    if role == "manager":
        return "manager"
    if "нутриц" in text:
        return "nutritionist"
    if "эндокрин" in text:
        return "endocrinologist"
    if "логомассаж" in text or ("лого" in text and "массаж" in text):
        return "speech_massage"
    if "массаж" in text:
        return "massage"
    if "остеоп" in text or "остиоп" in text:
        return "osteopath"
    if "невролог" in text and ("курс" in text or "реферал" in text):
        return "neurologist_referral"
    if "невролог" in text:
        return "neurologist"
    return "card"


def payroll_sheet_sort_key(profile: str, full_name: str) -> tuple[int, int, str]:
    """Порядок ведомости, пока его не перетащили вручную.

    Неврологи (Ганчина, затем Мунира), эндокринолог, админ,
    массажисты (Рухшона, Аниса, Мубин), затем менеджеры.
    """
    name = (full_name or "").casefold().replace("ё", "е")
    if "рухшон" in name or "анис" in name or "мубин" in name:
        profile = "massage"
    if profile in ("neurologist", "neurologist_referral"):
        band = 0
        if "ганчин" in name:
            inner = 0
        elif "мунир" in name or "шокир" in name:
            inner = 1
        else:
            inner = 9
    elif profile == "endocrinologist":
        band = 1
        inner = 0
    elif profile == "administrator":
        band = 2
        inner = 0
    elif profile in ("massage", "speech_massage"):
        band = 3
        if "рухшон" in name:
            inner = 0
        elif "анис" in name:
            inner = 1
        elif "мубин" in name:
            inner = 2
        else:
            inner = 9
    elif profile == "osteopath":
        band = 4
        inner = 0
    elif profile == "nutritionist":
        band = 5
        inner = 0
    elif profile == "curator":
        band = 6
        inner = 0
    elif profile == "manager":
        band = 7
        inner = 0
    else:
        band = 8
        inner = 0
    return (band, inner, name)


@dataclass(frozen=True)
class PayrollFacts:
    osteopath_paid: Decimal = Decimal("0")
    tms_paid: Decimal = Decimal("0")
    lab_paid: Decimal = Decimal("0")
    massage_paid: Decimal = Decimal("0")
    own_sessions: int = 0
    own_osteopath_paid: Decimal = Decimal("0")
    referred_main_courses: int = 0
    first_course_payments: Decimal = Decimal("0")
    kpi_bonus: Decimal = Decimal("0")
    debt_collected: Decimal = Decimal("0")
    open_debt: Decimal = Decimal("0")
    single_procedure_paid: Decimal = Decimal("0")


@dataclass(frozen=True)
class PayrollAccrual:
    base_salary: Decimal | None
    bonus: Decimal
    debt: Decimal
    debt_label: str
    formula: str


def _procedure_bonus(facts: PayrollFacts) -> Decimal:
    """Процент только с кассы визитов этого эксперта, не со всей клиники."""
    return _q(
        facts.osteopath_paid * OSTEOPATH_SHARE
        + facts.tms_paid * PROCEDURE_SHARE
        + facts.lab_paid * PROCEDURE_SHARE
        + facts.massage_paid * PROCEDURE_SHARE
    )


def carried_company_debt(
    rows: list[tuple[str, Decimal | None]],
    year_month: str,
) -> Decimal:
    """Последний вписанный долг на этот месяц или раньше. Пустые строки не считаются."""
    best_ym = ""
    best: Decimal | None = None
    for ym, amount in rows:
        if amount is None or ym > year_month:
            continue
        if best is None or ym > best_ym:
            best = Decimal(amount)
            best_ym = ym
    return best if best is not None else Decimal("0")


def company_balance(months: list[tuple[Decimal, Decimal]]) -> Decimal:
    """Сальдо за прошлые месяцы: начислено минус выплаченный ФОТ.

    Плюс, без знака: компания должна сотруднику.
    Минус: сотрудник должен компании.
    """
    total = Decimal("0")
    for earned, paid in months:
        total += Decimal(earned) - Decimal(paid)
    return total


def accrue(profile: str, facts: PayrollFacts, *, card_salary: Decimal | None) -> PayrollAccrual:
    """Начисление за месяц. Колонка долга — долг компании, её считает ведомость."""
    if profile == "neurologist":
        bonus = _procedure_bonus(facts)
        return PayrollAccrual(
            Decimal("5000"),
            bonus,
            Decimal("0"),
            "",
            "5 000 + 3% остеопат + 5% ТМС + 5% анализы + 5% массаж с оплаченных направлений",
        )
    if profile == "endocrinologist":
        bonus = _procedure_bonus(facts)
        return PayrollAccrual(
            Decimal("3000"),
            bonus,
            Decimal("0"),
            "",
            "3 000 + 3% остеопат + 5% ТМС + 5% анализы + 5% массаж с оплаченных направлений",
        )
    if profile == "neurologist_referral":
        bonus = _q(Decimal(facts.referred_main_courses) * REFERRAL_BONUS)
        return PayrollAccrual(
            Decimal("3000"),
            bonus,
            Decimal("0"),
            "",
            "3 000 + 100 за каждую продажу основного курса, где этот эксперт указан менеджером",
        )
    if profile == "massage":
        extra = max(0, int(facts.own_sessions) - MASSAGE_SESSION_FLOOR)
        return PayrollAccrual(
            Decimal("3000"),
            _q(Decimal(extra) * SESSION_BONUS),
            Decimal("0"),
            "",
            f"3 000 + сеансы сверх {MASSAGE_SESSION_FLOOR} × 27",
        )
    if profile == "speech_massage":
        extra = max(0, int(facts.own_sessions) - SPEECH_SESSION_FLOOR)
        return PayrollAccrual(
            Decimal("4500"),
            _q(Decimal(extra) * SESSION_BONUS),
            Decimal("0"),
            "",
            f"4 500 + сеансы сверх {SPEECH_SESSION_FLOOR} × 27",
        )
    if profile == "osteopath":
        return PayrollAccrual(
            Decimal("0"),
            _q(facts.own_osteopath_paid * OSTEOPATH_EXPERT_SHARE),
            Decimal("0"),
            "",
            "30% от оплаченных сеансов остеопата",
        )
    if profile == "manager":
        excess = facts.first_course_payments - MANAGER_FIRST_PAYMENT_FLOOR
        bonus = facts.kpi_bonus if excess > 0 else Decimal("0")
        return PayrollAccrual(
            Decimal("2000"),
            _q(bonus),
            Decimal("0"),
            "",
            "2 000 + бонус KPI, если первые оплаты курсов больше 26 000",
        )
    if profile == "curator":
        collected = _q(facts.debt_collected)
        return PayrollAccrual(
            Decimal("2000"),
            _q(collected * CURATOR_DEBT_SHARE),
            Decimal("0"),
            "",
            "2 000 + 2% от доплат по курсам и протоколам",
        )
    if profile == "administrator":
        return PayrollAccrual(
            Decimal("3500"),
            _q(facts.single_procedure_paid * ADMIN_CASH_SHARE),
            Decimal("0"),
            "",
            "3 500 + 2% от кассы разовых процедур",
        )
    if profile == "nutritionist":
        return PayrollAccrual(Decimal("4000"), Decimal("0"), Decimal("0"), "", "4 000 за ведение курсов")
    return PayrollAccrual(
        card_salary,
        _q(facts.kpi_bonus),
        Decimal("0"),
        "",
        "Оклад с карточки",
    )
