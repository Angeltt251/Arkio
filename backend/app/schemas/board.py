from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import CamelModel

PriorityName = Literal["low", "medium", "high", "critical"]


class BoardMember(CamelModel):
    id: UUID
    name: str
    avatar_url: str | None = None


class LabelOut(CamelModel):
    id: UUID
    name: str
    color: str


class TaskOut(CamelModel):
    id: UUID
    column_id: UUID
    title: str
    description: str | None
    priority: PriorityName
    position: float
    due_date: date | None
    is_blocked: bool
    blocked_reason: str | None
    assignee_ids: list[UUID]
    completed: bool
    label_ids: list[UUID] = []
    checklist_total: int = 0
    checklist_done: int = 0
    backlog_item_id: UUID | None = None
    backlog_item_code: str | None = None
    sprint_number: int | None = None


class ColumnOut(CamelModel):
    id: UUID
    name: str
    position: int
    wip_limit: int | None
    is_done: bool
    tasks: list[TaskOut]


class BoardOut(CamelModel):
    project_id: UUID
    project_name: str
    project_key: str
    project_color: str
    can_edit: bool
    can_manage_columns: bool
    columns: list[ColumnOut]
    members: list[BoardMember]
    labels: list[LabelOut] = []


class TaskCreate(CamelModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    priority: PriorityName = "medium"
    column_id: UUID | None = None  # por defecto, la primera columna
    due_date: date | None = None
    assignee_ids: list[UUID] = []
    label_ids: list[UUID] = []
    backlog_item_id: UUID | None = None


class TaskUpdate(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    priority: PriorityName | None = None
    due_date: date | None = None
    is_blocked: bool | None = None
    blocked_reason: str | None = Field(default=None, max_length=500)
    assignee_ids: list[UUID] | None = None
    label_ids: list[UUID] | None = None
    backlog_item_id: UUID | None = None


class TaskMove(CamelModel):
    column_id: UUID
    index: int = Field(ge=0, description="Posición destino dentro de la columna (0 = arriba)")


class ColumnCreate(CamelModel):
    name: str = Field(min_length=1, max_length=60)
    wip_limit: int | None = Field(default=None, ge=1, le=999)
    is_done: bool = False


class ColumnUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    wip_limit: int | None = Field(default=None, ge=1, le=999)
    is_done: bool | None = None


class ColumnMove(CamelModel):
    index: int = Field(ge=0, description="Nueva posición (0 = primera columna)")


class LabelCreate(CamelModel):
    name: str = Field(min_length=1, max_length=30)
    color: str = Field(default="#64748B", pattern=r"^#[0-9A-Fa-f]{6}$")


class ChecklistItemOut(CamelModel):
    id: UUID
    content: str
    is_done: bool
    position: int


class ChecklistItemCreate(CamelModel):
    content: str = Field(min_length=1, max_length=300)


class ChecklistItemUpdate(CamelModel):
    content: str | None = Field(default=None, min_length=1, max_length=300)
    is_done: bool | None = None
