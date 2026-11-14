import csv
import io
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select

from app.api.deps import CurrentUser, UserDB
from app.db.models import ActivityLog, Profile, Project, ProjectMember, Sprint, WorkspaceMember
from app.schemas.logbook import LogActor, LogbookPage
from app.schemas.workspace import ActivityOut, ProjectMemberOut, ProjectMemberSet, ProjectOut, ProjectUpdate
from app.services.dashboard import TZ
from app.services.logbook import CATEGORIES, logbook_actors, query_logbook
from app.services.permissions import (
    ADMIN_ROLES,
    accessible_project_ids,
    project_access,
    project_outs,
    require_project_manager,
)

router = APIRouter(prefix="/projects", tags=["proyectos y bitácora"])


@router.get("", response_model=list[ProjectOut])
def list_my_projects(user: CurrentUser, db: UserDB) -> list[Project]:
    """Todos los proyectos a los que el usuario tiene acceso, en cualquier espacio."""
    ids = accessible_project_ids(db, user.id)
    return list(db.scalars(select(Project).where(Project.id.in_(ids)).order_by(Project.created_at))) if ids else []


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: UUID, user: CurrentUser, db: UserDB) -> Project:
    return project_access(db, project_id, user.id)


def _active_sprint_guard(db, project_id: UUID, action: str) -> None:
    active = db.scalar(select(Sprint.number).where(Sprint.project_id == project_id, Sprint.status == "active"))
    if active:
        raise HTTPException(status.HTTP_409_CONFLICT, f"El Sprint #{active} sigue en curso: ciérralo antes de {action}")


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: UUID, payload: ProjectUpdate, user: CurrentUser, db: UserDB) -> ProjectOut:
    """Editar nombre, descripción, color o estado (Completado = `closed`). PO, SM o admin del espacio."""
    project = require_project_manager(db, project_id, user.id)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("status") == "closed" and project.status != "closed":
        _active_sprint_guard(db, project_id, "marcar el proyecto como completado")
    if "name" in changes and changes["name"]:
        changes["name"] = changes["name"].strip()
    if "description" in changes:
        changes["description"] = (changes["description"] or "").strip() or None
    for field, value in changes.items():
        if value is not None or field == "description":
            setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return project_outs(db, [project], user.id)[0]


@router.post("/{project_id}/archive", response_model=ProjectOut)
def archive_project(project_id: UUID, user: CurrentUser, db: UserDB) -> ProjectOut:
    """Guarda el proyecto fuera de la vista: deja de aparecer en el menú, pero conserva toda su historia."""
    project = require_project_manager(db, project_id, user.id)
    _active_sprint_guard(db, project_id, "archivar el proyecto")
    project.archived_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return project_outs(db, [project], user.id)[0]


@router.post("/{project_id}/restore", response_model=ProjectOut)
def restore_project(project_id: UUID, user: CurrentUser, db: UserDB) -> ProjectOut:
    project = require_project_manager(db, project_id, user.id)
    project.archived_at = None
    db.commit()
    db.refresh(project)
    return project_outs(db, [project], user.id)[0]


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: UUID, user: CurrentUser, db: UserDB,
    confirm: str = Query(..., description="Clave del proyecto, para confirmar"),
) -> None:
    """Elimina el proyecto para siempre. Solo admins del espacio y solo si no tiene Sprints:
    la historia de los Sprints no se borra (esos proyectos se archivan). La bitácora conserva el registro."""
    project = project_access(db, project_id, user.id)
    ws_member = db.get(WorkspaceMember, (project.workspace_id, user.id))
    if ws_member.role not in ADMIN_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo propietarios o administradores del espacio pueden eliminar proyectos")
    if confirm.strip().upper() != project.key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribe la clave del proyecto para confirmar")
    if db.scalar(select(Sprint.id).where(Sprint.project_id == project_id).limit(1)):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Este proyecto tiene Sprints y su historia no se borra. Archívalo en su lugar.")
    db.delete(project)
    db.commit()


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


# ------------------------------------------------------------------ bitácora legible
@router.get("/{project_id}/logbook", response_model=LogbookPage)
def project_logbook(
    project_id: UUID,
    user: CurrentUser,
    db: UserDB,
    limit: int = Query(50, ge=1, le=1000),
    before_id: int | None = Query(None, description="Paginación: registros anteriores a este id"),
    actor_id: UUID | None = None,
    category: str | None = Query(None, description=f"Una de: {', '.join(CATEGORIES)}"),
    since: date | None = None,
    until: date | None = None,
    q: str | None = Query(None, max_length=100),
) -> LogbookPage:
    """Bitácora con frases legibles y detalle antes/después. Solo lectura (también para observadores)."""
    project_access(db, project_id, user.id)
    items = query_logbook(db, project_id, limit=limit + 1, before_id=before_id, actor_id=actor_id,
                          category=category, since=since, until=until, q=q)
    has_more = len(items) > limit
    items = items[:limit]
    return LogbookPage(
        items=items,
        next_before_id=items[-1].id if has_more else None,
        actors=[LogActor(id=a["id"], name=a["name"]) for a in logbook_actors(db, project_id)],
    )


@router.get("/{project_id}/logbook.csv")
def project_logbook_csv(
    project_id: UUID,
    user: CurrentUser,
    db: UserDB,
    actor_id: UUID | None = None,
    category: str | None = None,
    since: date | None = None,
    until: date | None = None,
    q: str | None = Query(None, max_length=100),
) -> Response:
    """Exporta la bitácora filtrada (hasta 10.000 registros) en CSV compatible con Excel."""
    project = project_access(db, project_id, user.id)
    items = query_logbook(db, project_id, limit=10_000, actor_id=actor_id, category=category,
                          since=since, until=until, q=q)
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(["Fecha", "Hora", "Integrante", "Acción", "Elemento", "Descripción", "Cambios", "Origen"])
    for e in items:
        local = e.created_at.astimezone(TZ)
        detail = " | ".join(f"{c.field}: {c.old or '—'} → {c.new or '—'}" for c in e.changes)
        writer.writerow([
            local.strftime("%d-%m-%Y"), local.strftime("%H:%M:%S"), e.actor_name, e.action_label, e.entity_label,
            f"{e.actor_name} {e.message}{' ' + e.highlight if e.highlight else ''}", detail, e.source,
        ])
    filename = f"bitacora-{project.key}-{datetime.now(TZ):%Y%m%d}.csv"
    return Response(
        content="\ufeff" + buffer.getvalue(),  # BOM: Excel reconoce los acentos
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

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
