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
    assert "В обработке" not in MANAGER_SETTABLE_STAGE_NAMES
    assert MANAGER_SETTABLE_STAGE_NAMES == frozenset({"В ожидании", "Удачно", "Отказ"})
    assert "Удачно" in MANAGER_SETTABLE_STAGE_NAMES


def test_default_sales_stages():
    sales = default_pipeline_stage_creates(crm_mode="sales")
    assert [s.name for s in sales] == list(SALES_STAGE_NAMES)
    clinic = default_pipeline_stage_creates(crm_mode="clinic")
    assert [s.name for s in clinic] == list(SALES_STAGE_NAMES)


def test_bitrix_and_booking_aliases():
    assert resolve_stage_name_aliases("Неуспешно") == ["Неуспешно", "Отказ"]
    assert resolve_stage_name_aliases("Лиды из битрикс") == ["Лиды из битрикс", "Новый лид"]
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
        == "Архив"
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
        == "В ожидании"
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
    # Не ломаем ручную стадию менеджера и «В обработке» без жёсткого сигнала записи.
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
