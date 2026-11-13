from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import CurrentUser, UserDB
from app.db.models import ActivityLog, Profile, Project, ProjectMember, WorkspaceMember
from app.schemas.workspace import ActivityOut, ProjectMemberOut, ProjectMemberSet, ProjectOut
from app.services.permissions import accessible_project_ids, project_access, require_project_manager

router = APIRouter(prefix="/projects", tags=["proyectos y bitácora"])


@router.get("", response_model=list[ProjectOut])
def list_my_projects(user: CurrentUser, db: UserDB) -> list[Project]:
    """Todos los proyectos a los que el usuario tiene acceso, en cualquier espacio."""
    ids = accessible_project_ids(db, user.id)
    return list(db.scalars(select(Project).where(Project.id.in_(ids)).order_by(Project.created_at))) if ids else []


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


# ------------------------------------------------------------------ equipo del proyecto
@router.get("/{project_id}/members", response_model=list[ProjectMemberOut])
def list_project_members(project_id: UUID, user: CurrentUser, db: UserDB) -> list[ProjectMemberOut]:
    project_access(db, project_id, user.id)
    rows = db.execute(
        select(ProjectMember, Profile).join(Profile, Profile.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project_id).order_by(ProjectMember.added_at)
    )
    return [
        ProjectMemberOut(user_id=p.id, full_name=p.full_name, email=p.email, avatar_url=p.avatar_url, role=m.role)
        for m, p in rows
    ]


@router.put("/{project_id}/members/{member_id}", response_model=ProjectMemberOut)
def set_project_member(
    project_id: UUID, member_id: UUID, payload: ProjectMemberSet, user: CurrentUser, db: UserDB
) -> ProjectMemberOut:
    """Agrega a un integrante del espacio al proyecto, o cambia su rol Scrum."""
    project = require_project_manager(db, project_id, user.id)
    ws_member = db.get(WorkspaceMember, (project.workspace_id, member_id))
    if ws_member is None or ws_member.status != "active":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Primero debe ser miembro activo del espacio de trabajo")
    member = db.get(ProjectMember, (project_id, member_id))
    if member is None:
        member = ProjectMember(project_id=project_id, user_id=member_id, role=payload.role)
        db.add(member)
    else:
        member.role = payload.role
    db.commit()
    profile = db.get(Profile, member_id)
    return ProjectMemberOut(
        user_id=profile.id, full_name=profile.full_name, email=profile.email, avatar_url=profile.avatar_url,
        role=payload.role,
    )


@router.delete("/{project_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_member(project_id: UUID, member_id: UUID, user: CurrentUser, db: UserDB) -> None:
    require_project_manager(db, project_id, user.id)
    member = db.get(ProjectMember, (project_id, member_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa persona no es parte del proyecto")
    remaining = db.scalars(select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)).all()
    if len(remaining) == 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El proyecto debe tener al menos un integrante")
    db.delete(member)
    db.commit()
