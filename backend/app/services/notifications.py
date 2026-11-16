"""Notificaciones dentro de la app (campana) y, si la persona lo pidió, por correo.

Cada aviso respeta las preferencias de quien lo recibe (`profiles.preferences`) y nunca se envía a
quien hizo la acción. Los correos salen después del commit, en un hilo aparte, para no demorar la
respuesta ni enviarse si la transacción falla.
"""

import threading
from collections.abc import Iterable
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Notification, Profile, ProjectMember
from app.schemas.workspace import Preferences
from app.services.email import notification_email, send_email

EMAIL_KINDS = ("task_assigned", "sprint", "retro_action")


def preferences(profile: Profile) -> Preferences:
    """Preferencias guardadas (jsonb) combinadas con los valores por defecto."""
    try:
        return Preferences.model_validate(profile.preferences or {})
    except ValidationError:
        return Preferences()


def actor_name(db: Session, actor_id: UUID | None) -> str:
    profile = db.get(Profile, actor_id) if actor_id else None
    return (profile.full_name or profile.email) if profile else "Alguien"


def project_member_ids(db: Session, project_id: UUID) -> set[UUID]:
    return set(db.scalars(select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)))


def notify(
    db: Session,
    user_ids: Iterable[UUID],
    *,
    actor_id: UUID | None,
    kind: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    project_id: UUID | None = None,
) -> None:
    targets = set(user_ids) - {actor_id}
    if not targets:
        return
    for profile in db.scalars(select(Profile).where(Profile.id.in_(targets))):
        prefs = preferences(profile)
        if not getattr(prefs.notify, kind, True):
            continue
        db.add(Notification(user_id=profile.id, kind=kind, title=title, body=body, link=link,
                            project_id=project_id, actor_id=actor_id))
        if kind in EMAIL_KINDS and getattr(prefs.email, kind):
            url = f"{settings.frontend_url.rstrip('/')}{link or '/'}"
            db.info.setdefault("pending_emails", []).append((profile.email, *notification_email(title=title, body=body, link=url)))


@event.listens_for(Session, "after_commit")
def _send_pending(session: Session) -> None:
    emails = session.info.pop("pending_emails", None)
    if emails:
        threading.Thread(target=lambda: [send_email(*e) for e in emails], daemon=True).start()


@event.listens_for(Session, "after_rollback")
def _drop_pending(session: Session) -> None:
    session.info.pop("pending_emails", None)
