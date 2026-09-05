"""Sales chat pipeline stage helpers."""

from app.services.default_pipeline_stages import default_pipeline_stage_creates
from app.services.lead_sales_stages import (
    ARCHIVE_STAGE_NAME,
    MANAGER_SETTABLE_STAGE_NAMES,
    SALES_STAGE_NAMES,
    classify_lead_stage_name,
    resolve_stage_name_aliases,
    sales_stage_name_for_key,
)


def test_sales_stage_keys():
    assert sales_stage_name_for_key("new") == "Новый лид"
    assert sales_stage_name_for_key("waiting") == "В ожидании"
    assert sales_stage_name_for_key("won") == "Удачно"
    assert sales_stage_name_for_key("archive") == "Архив"
    assert len(SALES_STAGE_NAMES) == 6
    assert ARCHIVE_STAGE_NAME not in MANAGER_SETTABLE_STAGE_NAMES
    assert "Новый лид" not in MANAGER_SETTABLE_STAGE_NAMES
    assert "В обработке" in MANAGER_SETTABLE_STAGE_NAMES
    assert "В работе" in MANAGER_SETTABLE_STAGE_NAMES
    assert MANAGER_SETTABLE_STAGE_NAMES == frozenset(
        {"В обработке", "В работе", "В ожидании", "Удачно", "Отказ"}
    )
    assert "Удачно" in MANAGER_SETTABLE_STAGE_NAMES


def test_default_sales_stages():
    sales = default_pipeline_stage_creates(crm_mode="sales")
    assert [s.name for s in sales] == list(SALES_STAGE_NAMES)
    clinic = default_pipeline_stage_creates(crm_mode="clinic")
    assert [s.name for s in clinic] == list(SALES_STAGE_NAMES)


def test_bitrix_and_booking_aliases():
    assert resolve_stage_name_aliases("Неуспешно") == ["Неуспешно", "Отказ"]
    assert resolve_stage_name_aliases("Лиды из битрикс") == ["Лиды из битрикс", "Архив"]
    assert resolve_stage_name_aliases("Инстаграм") == ["Инстаграм", "Архив"]
    assert resolve_stage_name_aliases("Квалифицирован") == ["Квалифицирован", "В обработке"]
    assert resolve_stage_name_aliases("Успешно реализован") == ["Успешно реализован", "Архив"]


def test_classify_lead_stage_name():
    assert (
        classify_lead_stage_name(
            current_name="Новый лид",
            appointment_statuses={"completed"},
            has_outbound=False,
            last_direction=None,
        )
        == "Удачно"
    )
    assert (
        classify_lead_stage_name(
            current_name="Удачно",
            appointment_statuses={"completed"},
            has_outbound=True,
            last_direction="out",
        )
        == "Удачно"
    )
    assert (
        classify_lead_stage_name(
            current_name="Новый лид",
            appointment_statuses={"booked"},
            has_outbound=True,
            last_direction="out",
        )
        == "Удачно"
    )
    assert (
        classify_lead_stage_name(
            current_name="Новый лид",
            appointment_statuses=set(),
            has_outbound=True,
            last_direction="in",
        )
        == "В обработке"
    )
    assert (
        classify_lead_stage_name(
            current_name="Новый лид",
            appointment_statuses=set(),
            has_outbound=True,
            last_direction="out",
        )
        == "В обработке"
    )
    # Живой входящий без ответа менеджера → Новый лид.
    assert (
        classify_lead_stage_name(
            current_name="Новый лид",
            appointment_statuses=set(),
            has_outbound=False,
            last_direction="in",
            has_any_chat=True,
        )
        == "Новый лид"
    )
    # Bitrix-склад без чата у нас → Архив (не удалять).
    assert (
        classify_lead_stage_name(
            current_name="Новый лид",
            appointment_statuses=set(),
            has_outbound=False,
            last_direction=None,
            has_any_chat=False,
        )
        == "Архив"
    )
    assert (
        classify_lead_stage_name(
            current_name="Новый лид",
            appointment_statuses=set(),
            has_outbound=False,
            last_direction=None,
            has_any_chat=False,
            source="Bitrix import",
        )
        == "Архив"
    )
    # Старый GREEN API / WhatsApp входящий без ответа → Архив (склад, не «Новый лид»).
    from datetime import UTC, datetime, timedelta

    now = datetime(2026, 8, 16, tzinfo=UTC)
    old = now - timedelta(days=50)  # старше WAREHOUSE_RECENT_DAYS (45)
    fresh = now - timedelta(days=2)
    assert (
        classify_lead_stage_name(
            current_name="Новый лид",
            appointment_statuses=set(),
            has_outbound=False,
            last_direction="in",
            has_any_chat=True,
            source="GREEN API",
            last_message_at=old,
            lead_created_at=old,
            now=now,
        )
        == "Архив"
    )
    assert (
        classify_lead_stage_name(
            current_name="Новый лид",
            appointment_statuses=set(),
            has_outbound=False,
            last_direction="in",
            has_any_chat=True,
            source="GREEN API",
            last_message_at=fresh,
            lead_created_at=fresh,
            now=now,
        )
        == "Новый лид"
    )
    # Вечерняя реактивация: старый склад остаётся «Новый лид» в коротком grace.
    assert (
        classify_lead_stage_name(
            current_name="Новый лид",
            appointment_statuses=set(),
            has_outbound=False,
            last_direction="in",
            has_any_chat=True,
            source="GREEN API",
            last_message_at=old,
            lead_created_at=old,
            reactivated_at=now - timedelta(days=1),
            now=now,
        )
        == "Новый лид"
    )
    # После истечения grace (3 дня) — снова Архив, иначе колонка забивается.
    assert (
        classify_lead_stage_name(
            current_name="Новый лид",
            appointment_statuses=set(),
            has_outbound=False,
            last_direction="in",
            has_any_chat=True,
            source="GREEN API",
            last_message_at=old,
            lead_created_at=old,
            reactivated_at=now - timedelta(days=4),
            now=now,
        )
        == "Архив"
    )
    # Не ломаем ручную стадию менеджера без жёсткого сигнала записи.
    assert (
        classify_lead_stage_name(
            current_name="В ожидании",
            appointment_statuses=set(),
            has_outbound=False,
            last_direction=None,
        )
        == "В ожидании"
    )
    assert (
        classify_lead_stage_name(
            current_name="В обработке",
            appointment_statuses=set(),
            has_outbound=False,
            last_direction=None,
        )
        == "В обработке"
    )
    # Архив + свежий входящий → снова «Новый лид» (не застревать в складе).
    assert (
        classify_lead_stage_name(
            current_name="Архив",
            appointment_statuses=set(),
            has_outbound=False,
            last_direction="in",
            has_any_chat=True,
            last_message_at=fresh,
            now=now,
        )
        == "Новый лид"
    )
    # Архив + клиент ответил после исходящего → «В обработке» (ожидание только вручную).
    assert (
        classify_lead_stage_name(
            current_name="Архив",
            appointment_statuses=set(),
            has_outbound=True,
            last_direction="in",
            has_any_chat=True,
            last_message_at=fresh,
            now=now,
        )
        == "В обработке"
    )
    # Архив + автоответ на свежий вход (последнее out) → «В обработке».
    assert (
        classify_lead_stage_name(
            current_name="Архив",
            appointment_statuses=set(),
            has_outbound=True,
            last_direction="out",
            has_any_chat=True,
            last_message_at=fresh,
            now=now,
        )
        == "В обработке"
    )
    # Ручная «В обработке» + ответ клиента — не уводим в «В ожидании».
    assert (
        classify_lead_stage_name(
            current_name="В обработке",
            appointment_statuses=set(),
            has_outbound=True,
            last_direction="in",
            has_any_chat=True,
            last_message_at=fresh,
            now=now,
        )
        == "В обработке"
    )
    assert (
        classify_lead_stage_name(
            current_name="В работе",
            appointment_statuses=set(),
            has_outbound=True,
            last_direction="in",
            has_any_chat=True,
            last_message_at=fresh,
            now=now,
        )
        == "В работе"
    )
    # Архив без свежей активности остаётся Архивом.
    assert (
        classify_lead_stage_name(
            current_name="Архив",
            appointment_statuses=set(),
            has_outbound=False,
            last_direction="in",
            has_any_chat=True,
            last_message_at=old,
            now=now,
        )
        == "Архив"
    )
    # «Удачно» без активности >45 дней → Архив.
    assert (
        classify_lead_stage_name(
            current_name="Удачно",
            appointment_statuses=set(),
            has_outbound=True,
            last_direction="out",
            has_any_chat=True,
            last_message_at=old,
            lead_created_at=old,
            now=now,
        )
        == "Архив"
    )
    # Явка completed, но активность старая → Архив.
    assert (
        classify_lead_stage_name(
            current_name="Удачно",
            appointment_statuses={"completed"},
            has_outbound=False,
            last_direction=None,
            last_message_at=old,
            lead_created_at=old,
            now=now,
        )
        == "Архив"
    )
    # Активная запись booked держит Удачно даже при старых сообщениях.
    assert (
        classify_lead_stage_name(
            current_name="Удачно",
            appointment_statuses={"booked"},
            has_outbound=False,
            last_direction=None,
            last_message_at=old,
            now=now,
        )
        == "Удачно"
    )
    # Свежая дата записи (appointment_activity_at) удерживает Удачно при старом чате.
    assert (
        classify_lead_stage_name(
            current_name="Удачно",
            appointment_statuses={"completed"},
            has_outbound=False,
            last_direction=None,
            last_message_at=old,
            lead_created_at=old,
            appointment_activity_at=fresh,
            now=now,
        )
        == "Удачно"
    )
