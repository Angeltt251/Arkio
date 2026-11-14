from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import EmailStr, Field

from app.schemas.common import CamelModel

WorkspaceRoleName = Literal["owner", "admin", "member"]
ProjectRoleName = Literal["product_owner", "scrum_master", "developer", "observer"]
ProjectStatusName = Literal["planning", "active", "paused", "closed"]


class ProfileOut(CamelModel):
    id: UUID
    email: str
    full_name: str
    avatar_url: str | None = None
    theme: str


class ProfileUpdate(CamelModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=80)
    avatar_url: str | None = None
    theme: Literal["light", "dark", "system"] | None = None


class WorkspaceCreate(CamelModel):
    name: str = Field(min_length=2, max_length=80)


class WorkspaceOut(CamelModel):
    id: UUID
    name: str
    role: WorkspaceRoleName
    created_at: datetime


class ProjectCreate(CamelModel):
    name: str = Field(min_length=2, max_length=120)
    key: str = Field(pattern=r"^[A-Z][A-Z0-9]{1,5}$", description="Prefijo de los PBIs, ej: SAL")
    description: str | None = None
    product_goal: str | None = None
    color: str = Field(default="#447794", pattern=r"^#[0-9A-Fa-f]{6}$")
    my_role: ProjectRoleName = "product_owner"
    template: str = Field(default="scrum", description="Plantilla de columnas y tareas iniciales (GET /api/templates)")


class ProjectOut(CamelModel):
    id: UUID
    workspace_id: UUID
    key: str
    name: str
    description: str | None
    product_goal: str | None
    status: ProjectStatusName
    color: str
    created_at: datetime
    archived_at: datetime | None = None
    can_manage: bool = False  # editar, completar o archivar (PO, SM o admin del espacio)
    can_delete: bool = False  # eliminar: admin del espacio y sin Sprints (los Sprints no se borran)


class ProjectUpdate(CamelModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    description: str | None = Field(None, max_length=500)
    color: str | None = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    status: ProjectStatusName | None = None


class WorkspaceUpdate(CamelModel):
    name: str = Field(min_length=2, max_length=80)


class MemberOut(CamelModel):
    user_id: UUID
    full_name: str
    email: str
    avatar_url: str | None
    role: WorkspaceRoleName
    status: str


class InvitationCreate(CamelModel):
    email: EmailStr
    workspace_role: Literal["admin", "member"] = "member"
    project_id: UUID | None = None
    project_role: ProjectRoleName | None = None


class InvitationOut(CamelModel):
    id: UUID
    email: str
    workspace_role: str
    project_id: UUID | None
    project_role: str | None
    status: str
    expires_at: datetime
    # Solo al crearla: el enlace no se puede recuperar después (en la BD se guarda el hash)
    link: str | None = None
    email_sent: bool | None = None
    email_error: str | None = None


class MemberRoleUpdate(CamelModel):
    role: Literal["admin", "member"]


class ProjectMemberOut(CamelModel):
    user_id: UUID
    full_name: str
    email: str
    avatar_url: str | None
    role: ProjectRoleName


class ProjectMemberSet(CamelModel):
    role: ProjectRoleName


class ReceivedInvitation(CamelModel):
    id: UUID
    workspace_name: str
    project_name: str | None
    invited_by: str
    workspace_role: str
    project_role: str | None
    expires_at: datetime


class InvitationPreview(CamelModel):
    workspace_name: str
    project_name: str | None
    invited_by: str
    email: str
    status: str
    expires_at: datetime


class ActivityOut(CamelModel):
    id: int
    actor_id: UUID | None
    actor_name: str | None
    action: str
    entity_type: str
    entity_id: UUID | None
    changes: dict
    source: str
    created_at: datetime


class TemplateColumnOut(CamelModel):
    name: str
    wip_limit: int | None
    is_done: bool


class TemplateTaskOut(CamelModel):
    title: str
    column: str
    priority: str


class TemplateOut(CamelModel):
    id: str
    name: str
    description: str
    category: str
    icon: str
    columns: list[TemplateColumnOut]
    tasks: list[TemplateTaskOut]
