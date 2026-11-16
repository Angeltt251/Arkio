from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import EmailStr, Field, StringConstraints

from app.schemas.common import CamelModel

WorkspaceRoleName = Literal["owner", "admin", "member"]
ProjectRoleName = Literal["product_owner", "scrum_master", "developer", "observer"]
ProjectStatusName = Literal["planning", "active", "paused", "closed"]
ProjectTypeName = Literal["software", "web", "mobile", "data", "research", "academic", "other"]

# Definition of Done: criterios en texto que todo trabajo debe cumplir para darse por terminado
DefinitionOfDone = list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]]


NotificationKind = Literal["task_assigned", "task_update", "sprint", "membership", "retro_action"]
StartPage = Literal["/", "/espacios", "/tableros", "/backlog", "/sprints", "/reportes"]


class NotifyPreferences(CamelModel):
    task_assigned: bool = True
    task_update: bool = True
    sprint: bool = True
    membership: bool = True
    retro_action: bool = True


class EmailPreferences(CamelModel):
    task_assigned: bool = False
    sprint: bool = False
    retro_action: bool = False


class Preferences(CamelModel):
    notify: NotifyPreferences = Field(default_factory=NotifyPreferences)
    email: EmailPreferences = Field(default_factory=EmailPreferences)
    reduce_motion: bool = False
    start_page: StartPage = "/"


class ProfileOut(CamelModel):
    id: UUID
    email: str
    full_name: str
    avatar_url: str | None = None
    theme: str
    preferences: Preferences = Field(default_factory=Preferences)
    created_at: datetime | None = None


class ProfileUpdate(CamelModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=80)
    avatar_url: str | None = Field(default=None, max_length=500, pattern=r"^(https://\S+)?$")
    theme: Literal["light", "dark", "system"] | None = None
    preferences: Preferences | None = None


class NotificationOut(CamelModel):
    id: int
    kind: str
    title: str
    body: str | None
    link: str | None
    project_id: UUID | None
    project_name: str | None = None
    project_color: str | None = None
    actor_name: str | None = None
    actor_avatar: str | None = None
    read_at: datetime | None
    created_at: datetime


class NotificationsOut(CamelModel):
    items: list[NotificationOut]
    unread: int


class NotificationsRead(CamelModel):
    ids: list[int] | None = Field(default=None, description="Sin ids: marca todas como leídas")


class WorkspaceCreate(CamelModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)


class WorkspaceSettings(CamelModel):
    """Se guarda en `workspaces.settings` (jsonb)."""

    members_can_create_projects: bool = True
    default_template: str = "scrum"
    default_sprint_weeks: int = Field(default=2, ge=1, le=4)


class WorkspaceOut(CamelModel):
    id: UUID
    name: str
    description: str | None = None
    role: WorkspaceRoleName
    created_at: datetime
    owner_id: UUID | None = None
    owner_name: str | None = None
    member_count: int = 0
    settings: WorkspaceSettings = Field(default_factory=WorkspaceSettings)


class ProjectCreate(CamelModel):
    name: str = Field(min_length=2, max_length=120)
    key: str = Field(pattern=r"^[A-Z][A-Z0-9]{1,5}$", description="Prefijo de los PBIs, ej: SAL")
    description: str | None = Field(default=None, max_length=500)
    project_type: ProjectTypeName = "software"
    lead_id: UUID | None = Field(default=None, description="Responsable del proyecto (miembro del espacio); por defecto, quien lo crea")
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
    project_type: ProjectTypeName = "software"
    lead_id: UUID | None = None
    lead_name: str | None = None
    definition_of_done: list[str] = []
    status: ProjectStatusName
    color: str
    created_at: datetime
    archived_at: datetime | None = None
    can_manage: bool = False  # editar, completar o archivar (PO, SM o admin del espacio)
    can_delete: bool = False  # eliminar: admin del espacio y sin Sprints (los Sprints no se borran)
    my_role: ProjectRoleName | None = None  # rol Scrum del usuario en el proyecto (None: acceso como admin)


class ProjectUpdate(CamelModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    description: str | None = Field(None, max_length=500)
    color: str | None = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    status: ProjectStatusName | None = None
    product_goal: str | None = Field(None, max_length=1000)
    project_type: ProjectTypeName | None = None
    lead_id: UUID | None = None
    definition_of_done: DefinitionOfDone | None = Field(None, max_length=20)


class WorkspaceUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    settings: WorkspaceSettings | None = None


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
