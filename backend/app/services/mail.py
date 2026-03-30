import smtplib
from email.message import EmailMessage

from app.config import settings


def send_email(to_email: str, subject: str, body: str) -> bool:
    if not settings.smtp_host:
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from or settings.smtp_user or "no-reply@crm.local"
    msg["To"] = to_email
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
            server.ehlo()
            if settings.smtp_port in (587, 25):
                server.starttls()
                server.ehlo()
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        return True
    except Exception:
        return False

