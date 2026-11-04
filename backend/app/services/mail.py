import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)


def smtp_misconfig_hint() -> str | None:
    """Коротко: чего не хватает в env для почты (без секретов)."""
    if not (settings.smtp_host or "").strip():
        return "SMTP_HOST пуст на сервере Amvera"
    if not (settings.smtp_user or "").strip():
        return "SMTP_USER пуст"
    if not (settings.smtp_password or "").strip():
        return "SMTP_PASSWORD пуст (нужен пароль приложения Gmail)"
    return None


def send_email(
    to_email: str,
    subject: str,
    body: str,
    html_body: str | None = None,
    attachments: list[tuple[str, bytes]] | None = None,
) -> tuple[bool, str | None]:
    """Отправка письма. Возвращает (ok, error_detail)."""
    hint = smtp_misconfig_hint()
    if hint:
        logger.warning("%s — письмо не отправлено (%s)", hint, to_email)
        return False, hint
    to_addr = (to_email or "").strip()
    if not to_addr or "@" not in to_addr:
        return False, "Некорректный адрес получателя"
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = (settings.smtp_from or settings.smtp_user or "no-reply@crm.local").strip()
    msg["To"] = to_addr
    msg.set_content(body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    for filename, payload in attachments or []:
        msg.add_attachment(payload, maintype="text", subtype="csv", filename=filename)
    user = (settings.smtp_user or "").strip()
    # Gmail App Password часто копируют с пробелами — они ломают login.
    password = "".join((settings.smtp_password or "").split())
    host = (settings.smtp_host or "").strip()
    port = int(settings.smtp_port or 587)
    try:
        if port == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, timeout=25, context=context) as server:
                server.ehlo()
                if user:
                    server.login(user, password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=25) as server:
                server.ehlo()
                if port in (587, 25):
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                if user:
                    server.login(user, password)
                server.send_message(msg)
        return True, None
    except Exception as e:
        err = str(e).strip() or type(e).__name__
        logger.exception(
            "SMTP send failed to=%s host=%s port=%s from=%s user=%s err=%s",
            to_addr,
            host,
            port,
            settings.smtp_from or settings.smtp_user,
            user or "—",
            e,
        )
        # Короткая подсказка без паролей
        low = err.lower()
        if "authentication" in low or "username and password" in low or "badcredentials" in low:
            return False, "SMTP: неверный логин/пароль приложения Gmail"
        if "timed out" in low or "timeout" in low:
            return False, "SMTP: таймаут соединения с почтовым сервером"
        return False, f"SMTP: {err[:180]}"

