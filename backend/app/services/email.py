"""Envío de correos (invitaciones).

IMPORTANTE: el plan gratis de Render bloquea los puertos SMTP 25, 465 y 587.
* Local / Docker: EMAIL_PROVIDER=smtp con Mailpit (http://localhost:8025).
* Render gratis: EMAIL_PROVIDER=resend (API HTTPS, puerto 443).
* Render pagado: EMAIL_PROVIDER=smtp con tu proveedor (Gmail con contraseña de aplicación, Brevo, etc.).
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from html import escape

import httpx

from app.core.config import settings

logger = logging.getLogger("arkio.email")


def send_email(to: str, subject: str, html: str, text: str) -> None:
    provider = settings.email_provider
    try:
        if provider == "smtp":
            _send_smtp(to, subject, html, text)
        elif provider == "resend":
            _send_resend(to, subject, html, text)
        else:
            logger.info("EMAIL_PROVIDER=log → correo NO enviado a %s | %s\n%s", to, subject, text)
            return
        logger.info("Correo enviado a %s (%s)", to, provider)
    except Exception:
        # Se ejecuta en segundo plano: no debe botar la petición que creó la invitación
        logger.exception("No se pudo enviar el correo a %s", to)


def _send_smtp(to: str, subject: str, html: str, text: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    if settings.smtp_port == 465:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15,
                              context=ssl.create_default_context()) as smtp:
            _login_and_send(smtp, msg)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_starttls:
                smtp.starttls(context=ssl.create_default_context())
            _login_and_send(smtp, msg)


def _login_and_send(smtp: smtplib.SMTP, msg: EmailMessage) -> None:
    if settings.smtp_user:
        smtp.login(settings.smtp_user, settings.smtp_password)
    smtp.send_message(msg)


def _send_resend(to: str, subject: str, html: str, text: str) -> None:
    response = httpx.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={"from": settings.email_from, "to": [to], "subject": subject, "html": html, "text": text},
        timeout=15,
    )
    response.raise_for_status()


def invitation_email(*, inviter: str, workspace: str, project: str | None, link: str, hours: int) -> tuple[str, str, str]:
    target = f"el proyecto «{project}» en {workspace}" if project else f"el espacio de trabajo «{workspace}»"
    subject = f"{inviter} te invitó a {workspace} en Arkio"
    text = (
        f"Hola,\n\n{inviter} te invitó a unirte a {target} en Arkio.\n\n"
        f"Acepta la invitación aquí: {link}\n\nEl enlace vence en {hours} horas.\n"
    )
    html = f"""
<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:32px;color:#1f2040">
  <h2 style="color:#5b3fd6;margin:0 0 16px">Arkio</h2>
  <p><strong>{escape(inviter)}</strong> te invitó a unirte a {escape(target)}.</p>
  <p style="margin:28px 0">
    <a href="{escape(link)}" style="background:#5b3fd6;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">
      Aceptar invitación
    </a>
  </p>
  <p style="color:#6b7280;font-size:13px">El enlace vence en {hours} horas. Si no esperabas este correo, ignóralo.</p>
</div>"""
    return subject, html, text
