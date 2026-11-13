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
    color: str = Field(default="#5B3FD6", pattern=r"^#[0-9A-Fa-f]{6}$")
    my_role: ProjectRoleName = "product_owner"


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
