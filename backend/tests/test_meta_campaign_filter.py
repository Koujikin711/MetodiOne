from datetime import date

from app.services.meta_ads_client import (
    campaign_ig_map_from_ads,
    ig_account_label,
    keep_rows_for_instagram_accounts,
    merge_campaign_catalog,
)


def test_ig_label_ignores_campaign_words_and_metodione():
    assert ig_account_label("dr.ganjina.zamir") == "Ganjina Zamiri"
    assert ig_account_label("metodi_clinic") == "MetodiClinic"
    assert ig_account_label("metodione") is None
    assert ig_account_label("some.brand", "MetodiOne") is None


def test_campaign_keeps_any_name_when_instagram_is_clinic():
    ads = [
        {"campaign_id": "10", "creative": {"instagram_user_id": "ig-clinic"}},
        {"campaign_id": "11", "creative": {"instagram_user_id": "ig-one"}},
    ]
    mapped = campaign_ig_map_from_ads(ads)
    labels = {"ig-clinic": "MetodiClinic"}
    rows = keep_rows_for_instagram_accounts(
        [
            {"campaign_id": "10", "campaign_name": "Как угодно назвали", "spend": "5"},
            {"campaign_id": "11", "campaign_name": "MetodiClinic words", "spend": "9"},
        ],
        mapped,
        labels,
    )
    assert len(rows) == 1
    assert rows[0]["campaign_id"] == "10"
    assert rows[0]["brand"] == "MetodiClinic"


def test_catalog_adds_only_allowed_instagram_campaign():
    rows = merge_campaign_catalog(
        [],
        [
            {"id": "99", "name": "Новая", "created_time": "2026-09-28T10:00:00+0000"},
            {"id": "2", "name": "MetodiOne promo", "created_time": "2026-09-10T00:00:00+0000"},
        ],
        since=date(2026, 9, 1),
        until=date(2026, 9, 30),
        brand_by_campaign={"99": "Ganjina Zamiri"},
    )
    assert len(rows) == 1
    assert rows[0]["brand"] == "Ganjina Zamiri"
