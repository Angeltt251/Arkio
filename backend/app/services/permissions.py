"""Reglas de permisos en el backend (el PDF pide no confiar solo en ocultar botones)."""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Project, ProjectMember, WorkspaceMember

ADMIN_ROLES = ("owner", "admin")


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
    if ws_member and ws_member.status == "active" and ws_member.role in ADMIN_ROLES:
        return project

    member = db.get(ProjectMember, (project_id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proyecto no encontrado")
    if write and member.role == "observer":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tu rol de observador es de solo lectura")
    return project


def accessible_project_ids(db: Session, user_id: UUID) -> list[UUID]:
    direct = select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
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
