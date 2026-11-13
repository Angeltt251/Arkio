from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import CurrentUser, UserDB
from app.db.models import ActivityLog, Profile, Project
from app.schemas.workspace import ActivityOut, ProjectOut
from app.services.permissions import project_access

router = APIRouter(prefix="/projects", tags=["proyectos y bitácora"])


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: UUID, user: CurrentUser, db: UserDB) -> Project:
    return project_access(db, project_id, user.id)


@router.get("/{project_id}/activity", response_model=list[ActivityOut])
def project_activity(
    project_id: UUID,
    user: CurrentUser,
    db: UserDB,
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = Query(None, description="Paginación: trae registros anteriores a este id"),
    actor_id: UUID | None = None,
    entity_type: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> list[ActivityOut]:
    """Bitácora del proyecto: quién hizo qué y cuándo. Solo lectura (también para observadores)."""
    project_access(db, project_id, user.id)
    query = (
        select(ActivityLog, Profile.full_name)
        .outerjoin(Profile, Profile.id == ActivityLog.actor_id)
        .where(ActivityLog.project_id == project_id)
    )
    if before_id:
        query = query.where(ActivityLog.id < before_id)
    if actor_id:
        query = query.where(ActivityLog.actor_id == actor_id)
    if entity_type:
        query = query.where(ActivityLog.entity_type == entity_type)
    if since:
        query = query.where(ActivityLog.created_at >= since)
    if until:
        query = query.where(ActivityLog.created_at <= until)

    rows = db.execute(query.order_by(ActivityLog.id.desc()).limit(limit))
    return [
        ActivityOut(
            id=log.id, actor_id=log.actor_id, actor_name=name, action=log.action, entity_type=log.entity_type,
            entity_id=log.entity_id, changes=log.changes, source=log.source, created_at=log.created_at,
        )
        for log, name in rows
    ]
