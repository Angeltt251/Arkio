from datetime import datetime, timezone

from fastapi import APIRouter, Query
from sqlalchemy import delete, func, select, update

from app.api.deps import CurrentUser, UserDB
from app.db.models import Notification, Profile, Project
from app.schemas.dashboard import DashboardOut
from app.schemas.workspace import NotificationOut, NotificationsOut, NotificationsRead, ProfileOut, ProfileUpdate
from app.services.dashboard import build_dashboard
from app.services.notifications import preferences

router = APIRouter(tags=["perfil y dashboard"])


def _profile_out(profile: Profile) -> ProfileOut:
    return ProfileOut(id=profile.id, email=profile.email, full_name=profile.full_name, avatar_url=profile.avatar_url,
                      theme=profile.theme, preferences=preferences(profile), created_at=profile.created_at)


@router.get("/me", response_model=ProfileOut)
def get_me(user: CurrentUser, db: UserDB) -> ProfileOut:
    return _profile_out(db.get(Profile, user.id))


@router.patch("/me", response_model=ProfileOut)
def update_me(payload: ProfileUpdate, user: CurrentUser, db: UserDB) -> ProfileOut:
    profile = db.get(Profile, user.id)
    changes = payload.model_dump(exclude_unset=True, exclude={"preferences"})
    if "full_name" in changes and changes["full_name"]:
        changes["full_name"] = changes["full_name"].strip()
    if "avatar_url" in changes:
        changes["avatar_url"] = changes["avatar_url"] or None
    for field, value in changes.items():
        setattr(profile, field, value)
    if payload.preferences is not None:
        profile.preferences = payload.preferences.model_dump()
    db.commit()
    return _profile_out(profile)


@router.get("/dashboard", response_model=DashboardOut)
def get_dashboard(user: CurrentUser, db: UserDB) -> DashboardOut:
    return build_dashboard(db, user.id)


# ------------------------------------------------------------------ notificaciones
@router.get("/me/notifications", response_model=NotificationsOut)
def list_notifications(
    user: CurrentUser, db: UserDB, limit: int = Query(30, ge=1, le=100), unread_only: bool = False
) -> NotificationsOut:
    query = (
        select(Notification, Project.name, Project.color, Profile.full_name, Profile.email, Profile.avatar_url)
        .outerjoin(Project, Project.id == Notification.project_id)
        .outerjoin(Profile, Profile.id == Notification.actor_id)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    )
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    items = [
        NotificationOut(
            id=n.id, kind=n.kind, title=n.title, body=n.body, link=n.link, project_id=n.project_id,
            project_name=project_name, project_color=color, actor_name=(name or email) if (name or email) else None,
            actor_avatar=avatar, read_at=n.read_at, created_at=n.created_at,
        )
        for n, project_name, color, name, email, avatar in db.execute(query)
    ]
    unread = db.scalar(
        select(func.count()).select_from(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return NotificationsOut(items=items, unread=unread or 0)


@router.post("/me/notifications/read", status_code=204)
def mark_notifications_read(payload: NotificationsRead, user: CurrentUser, db: UserDB) -> None:
    stmt = update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    if payload.ids is not None:
        stmt = stmt.where(Notification.id.in_(payload.ids))
    db.execute(stmt.values(read_at=datetime.now(timezone.utc)))
    db.commit()


@router.delete("/me/notifications", status_code=204)
def clear_read_notifications(user: CurrentUser, db: UserDB) -> None:
    """Borra las notificaciones ya leídas (son avisos personales, no la bitácora)."""
    db.execute(delete(Notification).where(Notification.user_id == user.id, Notification.read_at.is_not(None)))
    db.commit()
