"""Sales chat pipeline stage helpers."""

from app.services.default_pipeline_stages import default_pipeline_stage_creates
from app.services.lead_sales_stages import SALES_STAGE_NAMES, sales_stage_name_for_key


def test_sales_stage_keys():
    assert sales_stage_name_for_key("new") == "Новый лид"
    assert sales_stage_name_for_key("waiting") == "В ожидании"
    assert sales_stage_name_for_key("won") == "Удачно"
    assert sales_stage_name_for_key("archive") == "Архив"
    assert len(SALES_STAGE_NAMES) == 6


def test_default_sales_stages():
    sales = default_pipeline_stage_creates(crm_mode="sales")
    assert [s.name for s in sales] == list(SALES_STAGE_NAMES)
    clinic = default_pipeline_stage_creates(crm_mode="clinic")
    assert clinic[0].name == "Новый"
