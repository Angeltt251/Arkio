"""Envío de correos (invitaciones).

IMPORTANTE: el plan gratis de Render bloquea los puertos SMTP 25, 465 y 587.
* Local / Docker: EMAIL_PROVIDER=smtp con Mailpit (http://localhost:8025).
* Render gratis: EMAIL_PROVIDER=brevo (API HTTPS, puerto 443). Basta verificar tu correo como
  remitente en Brevo; EMAIL_FROM debe usar ese mismo correo. Resend también sirve, pero sin
  dominio propio solo entrega al correo dueño de la cuenta.
* Render pagado: EMAIL_PROVIDER=smtp con tu proveedor (Gmail con contraseña de aplicación, Brevo, etc.).
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import parseaddr
from html import escape

import httpx

from app.core.config import settings

logger = logging.getLogger("arkio.email")


class EmailError(Exception):
    """Fallo del proveedor con un motivo que se puede mostrar al administrador."""


def send_email(to: str, subject: str, html: str, text: str) -> str | None:
    """Envía el correo y devuelve None si salió, o el motivo del fallo. Nunca lanza excepción:
    si falla, la invitación igual existe y su enlace se puede copiar desde la app."""
    provider = settings.email_provider
    try:
        if provider == "smtp":
            _send_smtp(to, subject, html, text)
        elif provider == "resend":
            _send_resend(to, subject, html, text)
        elif provider == "brevo":
            _send_brevo(to, subject, html, text)
        else:
            logger.info("EMAIL_PROVIDER=log → correo NO enviado a %s | %s\n%s", to, subject, text)
            return "El envío de correos no está configurado en el servidor (EMAIL_PROVIDER=log)."
        logger.info("Correo enviado a %s (%s)", to, provider)
        return None
    except EmailError as exc:
        logger.error("No se pudo enviar el correo a %s (%s): %s", to, provider, exc)
        return str(exc)
    except Exception:
        logger.exception("No se pudo enviar el correo a %s (%s)", to, provider)
        return "Error inesperado al contactar al proveedor de correo."


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


def _send_brevo(to: str, subject: str, html: str, text: str) -> None:
    name, address = parseaddr(settings.email_from)
    response = httpx.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={"api-key": settings.brevo_api_key.strip(), "accept": "application/json"},
        json={
            "sender": {"name": name or "Arkio", "email": address},
            "to": [{"email": to}],
            "subject": subject,
            "htmlContent": html,
            "textContent": text,
        },
        timeout=15,
    )
    if response.status_code >= 400:
        logger.error("Brevo respondió %s: %s", response.status_code, response.text[:300])
        raise EmailError(_brevo_reason(response.status_code, response.text))


def _brevo_reason(status: int, body: str) -> str:
    """Traduce los errores habituales de Brevo a una indicación de cómo resolverlos."""
    lower = body.lower()
    if "ip address" in lower or "authorised_ips" in lower or "authorized_ips" in lower:
        return ("Brevo bloqueó la IP del servidor (Render). En Brevo → Security → Authorised IPs desactiva el "
                "bloqueo de IPs desconocidas: Render usa IPs variables, así que agregarlas una por una no basta.")
    if "transactional" in lower or "permission_denied" in lower:
        return ("La API key de Brevo no tiene permiso para enviar correos. Crea una clave nueva con acceso completo "
                "en Brevo (SMTP & API → API Keys) o activa los correos transaccionales de tu cuenta.")
    if "sender" in lower:
        return f"Brevo no acepta el remitente {settings.email_from}: verifícalo en Brevo → Senders."
    if status == 401 or "key not found" in lower:
        return ("Brevo rechazó la API key (no existe o está mal copiada). Usa una clave de SMTP & API → API Keys "
                "(empieza con xkeysib-) en BREVO_API_KEY de Render.")
    return f"Brevo respondió {status}: {body[:200]}"


def invitation_email(*, inviter: str, workspace: str, project: str | None, link: str, hours: int) -> tuple[str, str, str]:
    target = f"el proyecto «{project}» en {workspace}" if project else f"el espacio de trabajo «{workspace}»"
    subject = f"{inviter} te invitó a {workspace} en Arkio"
    text = (
        f"Hola,\n\n{inviter} te invitó a unirte a {target} en Arkio.\n\n"
        f"Acepta la invitación aquí: {link}\n\nEl enlace vence en {hours} horas.\n"
    )
    html = f"""
<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:32px;color:#061222">
  <h2 style="color:#2d5b75;margin:0 0 16px">Arkio</h2>
  <p><strong>{escape(inviter)}</strong> te invitó a unirte a {escape(target)}.</p>
  <p style="margin:28px 0">
    <a href="{escape(link)}" style="background:#2d5b75;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">
      Aceptar invitación
    </a>
  </p>
  <p style="color:#6b7280;font-size:13px">El enlace vence en {hours} horas. Si no esperabas este correo, ignóralo.</p>
</div>"""
    return subject, html, text
