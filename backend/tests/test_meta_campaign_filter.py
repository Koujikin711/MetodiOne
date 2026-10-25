from datetime import date

from app.services.meta_ads_client import (
    campaign_ig_map_from_ads,
    follower_gains_from_daily,
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
    assert len(rows) == 2
    assert rows[0]["campaign_id"] == "10"
    assert rows[0]["brand"] == "MetodiClinic"
    assert rows[1]["campaign_id"] == "11"
    assert rows[1].get("brand") is None


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


def test_follower_gain_drops_the_day_meta_dumps_the_whole_audience():
    daily = [("2026-10-06", 0), ("2026-10-07", 56045), ("2026-10-08", 41), ("2026-10-09", 49)]
    total, by_day = follower_gains_from_daily(daily, 56289)
    assert total == 90
    assert "2026-10-07" not in by_day


def test_follower_gain_keeps_a_normal_busy_day():
    daily = [("2026-10-12", 95), ("2026-10-13", 103), ("2026-10-14", 47)]
    total, by_day = follower_gains_from_daily(daily, 12407)
    assert total == 245
    assert by_day["2026-10-13"] == 103
