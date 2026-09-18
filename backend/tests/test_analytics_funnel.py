"""Снимок воронки аналитики: проценты не выше 100 и не из соседних колонок."""

from datetime import UTC, datetime

from app.routers.analytics import average_hours_in_stage, build_funnel_rows


def test_funnel_does_not_divide_neighbor_columns():
    rows = {
        name: (count, conv)
        for name, count, conv in build_funnel_rows({
            "Новый лид": 12,
            "В обработке": 599,
            "В ожидании": 27,
            "Удачно": 25,
        })
    }
    # 651 дошли дальше из 663, не 599/12
    assert rows["Новый лид"][1] == 98.19
    assert rows["В обработке"][1] == 7.99
    assert rows["В ожидании"][1] == 48.08
    assert rows["Удачно"][1] is None
    assert all(v is None or v <= 100 for _, v in rows.values())


def test_refusal_and_archive_have_no_next_percent():
    rows = {name: (count, conv) for name, count, conv in build_funnel_rows({"Отказ": 10, "Архив": 40, "Удачно": 5})}
    assert rows["Отказ"] == (10, None)
    assert rows["Архив"] == (40, None)
    assert rows["Удачно"][1] is None


def test_stage_hours_only_between_real_moves():
    t0 = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
    t1 = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    t2 = datetime(2026, 9, 2, 12, 0, tzinfo=UTC)
    hours = average_hours_in_stage({
        1: [
            (t0, "Смена стадии: Новый лид -> В обработке"),
            (t1, "Смена стадии: В обработке -> В ожидании"),
            (t2, "Смена стадии: В ожидании -> Удачно"),
        ],
    })
    assert hours["В обработке"] == 2.0
    assert hours["В ожидании"] == 24.0
    assert "Удачно" not in hours
