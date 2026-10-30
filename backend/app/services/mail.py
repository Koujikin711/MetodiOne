import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)


def send_email(
    to_email: str,
    subject: str,
    body: str,
    html_body: str | None = None,
    attachments: list[tuple[str, bytes]] | None = None,
) -> bool:
    if not settings.smtp_host:
        logger.warning("SMTP_HOST пуст — письмо не отправлено (%s)", to_email)
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from or settings.smtp_user or "no-reply@crm.local"
    msg["To"] = to_email
    msg.set_content(body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    for filename, payload in attachments or []:
        msg.add_attachment(payload, maintype="text", subtype="csv", filename=filename)
    user = (settings.smtp_user or "").strip()
    # Gmail App Password часто копируют с пробелами — они ломают login.
    password = "".join((settings.smtp_password or "").split())
    port = int(settings.smtp_port or 587)
    try:
        if port == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(settings.smtp_host, port, timeout=20, context=context) as server:
                server.ehlo()
                if user:
                    server.login(user, password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(settings.smtp_host, port, timeout=20) as server:
                server.ehlo()
                if port in (587, 25):
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                if user:
                    server.login(user, password)
                server.send_message(msg)
        return True
    except Exception:
        logger.exception(
            "SMTP send failed to=%s host=%s port=%s from=%s user=%s",
            to_email,
            settings.smtp_host,
            port,
            settings.smtp_from or settings.smtp_user,
            user or "—",
        )
        return False

