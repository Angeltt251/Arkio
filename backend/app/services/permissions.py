"""Reglas de permisos en el backend (el PDF pide no confiar solo en ocultar botones)."""

from uuid import UUID

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Profile, Project, ProjectMember, Sprint, Workspace, WorkspaceMember
from app.schemas.workspace import ProjectOut, WorkspaceSettings

ADMIN_ROLES = ("owner", "admin")


def workspace_settings(workspace: Workspace) -> WorkspaceSettings:
    """Configuración del espacio (`workspaces.settings`) con los valores por defecto."""
    try:
        return WorkspaceSettings.model_validate(workspace.settings or {})
    except ValidationError:
        return WorkspaceSettings()


def workspace_membership(db: Session, workspace_id: UUID, user_id: UUID) -> WorkspaceMember:
    member = db.get(WorkspaceMember, (workspace_id, user_id))
    if member is None or member.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Espacio de trabajo no encontrado")
    return member


def require_workspace_admin(db: Session, workspace_id: UUID, user_id: UUID) -> WorkspaceMember:
    member = workspace_membership(db, workspace_id, user_id)
    if member.role not in ADMIN_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo propietarios o administradores pueden hacer esto")
    return member


def project_access(db: Session, project_id: UUID, user_id: UUID, *, write: bool = False) -> Project:
    """Devuelve el proyecto si el usuario puede verlo (o editarlo si write=True).
    Los observadores (profesor) solo leen."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proyecto no encontrado")

    ws_member = db.get(WorkspaceMember, (project.workspace_id, user_id))
    if ws_member is None or ws_member.status != "active":  # revocado del espacio = sin acceso a sus proyectos
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proyecto no encontrado")
    if ws_member.role in ADMIN_ROLES:
        return project

    member = db.get(ProjectMember, (project_id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proyecto no encontrado")
    if write and member.role == "observer":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tu rol de observador es de solo lectura")
    return project


def require_project_manager(db: Session, project_id: UUID, user_id: UUID) -> Project:
    """Gestionar el equipo del proyecto: admins del espacio, Product Owner o Scrum Master."""
    project = project_access(db, project_id, user_id, write=True)
    ws_member = db.get(WorkspaceMember, (project.workspace_id, user_id))
    if ws_member.role in ADMIN_ROLES:
        return project
    member = db.get(ProjectMember, (project_id, user_id))
    if member is None or member.role not in ("product_owner", "scrum_master"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el Product Owner, el Scrum Master o un administrador pueden hacer esto")
    return project


def can_edit(db: Session, project: Project, user_id: UUID) -> bool:
    """Puede editar: admins del espacio o miembros del proyecto que no son observadores."""
    ws_member = db.get(WorkspaceMember, (project.workspace_id, user_id))
    if ws_member and ws_member.status == "active" and ws_member.role in ADMIN_ROLES:
        return True
    member = db.get(ProjectMember, (project.id, user_id))
    return member is not None and member.role != "observer"


def can_manage(db: Session, project: Project, user_id: UUID) -> bool:
    """Product Owner, Scrum Master o administrador del espacio."""
    try:
        require_project_manager(db, project.id, user_id)
        return True
    except HTTPException:
        return False


def accessible_project_ids(db: Session, user_id: UUID) -> list[UUID]:
    direct = (
        select(ProjectMember.project_id)
        .join(Project, Project.id == ProjectMember.project_id)
        .join(
            WorkspaceMember,
            (WorkspaceMember.workspace_id == Project.workspace_id) & (WorkspaceMember.user_id == ProjectMember.user_id),
        )
        .where(ProjectMember.user_id == user_id, WorkspaceMember.status == "active")
    )
    via_admin = (
        select(Project.id)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Project.workspace_id)
        .where(
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.status == "active",
            WorkspaceMember.role.in_(ADMIN_ROLES),
        )
    )
    rows = db.execute(
        select(Project.id).where(Project.archived_at.is_(None), Project.id.in_(direct.union(via_admin)))
    )
    return list(rows.scalars())


def project_outs(db: Session, projects: list[Project], user_id: UUID) -> list[ProjectOut]:
    """Proyectos con lo que el usuario puede hacer con cada uno."""
    ids = [p.id for p in projects]
    with_sprints = set(db.scalars(select(Sprint.project_id).where(Sprint.project_id.in_(ids)).distinct())) if ids else set()
    out = []
    for p in projects:
        ws_member = db.get(WorkspaceMember, (p.workspace_id, user_id))
        is_admin = ws_member is not None and ws_member.status == "active" and ws_member.role in ADMIN_ROLES
        item = ProjectOut.model_validate(p)
        item.can_manage = can_manage(db, p, user_id)
        item.can_delete = is_admin and p.id not in with_sprints
        member = db.get(ProjectMember, (p.id, user_id))
        item.my_role = member.role if member else None
        lead = db.get(Profile, p.lead_id) if p.lead_id else None
        item.lead_name = (lead.full_name or lead.email) if lead else None
        out.append(item)
    return out
