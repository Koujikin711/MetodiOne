"""Копия базы на почту: не чаще одного раза в 10 дней."""

from datetime import date

from app.services.lead_base_email import BACKUP_RECIPIENTS, backup_is_due


def test_first_backup_is_due():
    assert backup_is_due(None, date(2026, 10, 25)) is True


def test_backup_goes_only_to_the_two_mailboxes():
    assert BACKUP_RECIPIENTS == (
        "ganj220492@gmail.com",
        "isharafjon@gmail.com",
    )


def test_backup_waits_ten_days():
    assert backup_is_due(date(2026, 10, 16), date(2026, 10, 25)) is False
    assert backup_is_due(date(2026, 10, 15), date(2026, 10, 25)) is True
