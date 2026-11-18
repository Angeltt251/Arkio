"""Product Backlog, Sprint Planning y eventos Scrum."""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from app.schemas.board import BoardMember, PriorityName
from app.schemas.common import CamelModel

PbiTypeName = Literal["story", "bug", "task", "spike", "improvement"]
PbiStatusName = Literal["new", "refined", "ready", "in_sprint", "done", "discarded"]
SprintStatusName = Literal["planned", "active", "closed", "cancelled"]
EventTypeName = Literal["sprint_planning", "daily_scrum", "sprint_review", "sprint_retrospective"]
ActionStatusName = Literal["pending", "in_progress", "done", "dropped"]


class ProjectHeader(CamelModel):
    project_id: UUID
    project_name: str
    project_key: str
    product_goal: str | None
    definition_of_done: list[str] = []
    can_edit: bool
    can_manage: bool  # Product Owner, Scrum Master o administrador


# ------------------------------------------------------------------ Product Backlog
class PbiOut(CamelModel):
    id: UUID
    code: str
    type: PbiTypeName
    title: str
    description: str | None
    story_as_a: str | None
    story_i_want: str | None
    story_so_that: str | None
    acceptance_criteria: str | None
    priority: PriorityName
    estimate: float | None
    status: PbiStatusName
    parent_id: UUID | None
    parent_code: str | None = None
    sprint_number: int | None = None  # último Sprint en que se seleccionó
    task_count: int = 0
    tasks_done: int = 0
    archived: bool = False


class BacklogOut(ProjectHeader):
    items: list[PbiOut]


class ProductGoalUpdate(CamelModel):
    product_goal: str | None = Field(default=None, max_length=1000)


class PbiCreate(CamelModel):
    type: PbiTypeName = "story"
    title: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    story_as_a: str | None = Field(default=None, max_length=200)
    story_i_want: str | None = Field(default=None, max_length=500)
    story_so_that: str | None = Field(default=None, max_length=500)
    acceptance_criteria: str | None = Field(default=None, max_length=5000)
    priority: PriorityName = "medium"
    estimate: float | None = Field(default=None, ge=0, le=999)
    parent_id: UUID | None = None


class PbiUpdate(CamelModel):
    type: PbiTypeName | None = None
    title: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    story_as_a: str | None = Field(default=None, max_length=200)
    story_i_want: str | None = Field(default=None, max_length=500)
    story_so_that: str | None = Field(default=None, max_length=500)
    acceptance_criteria: str | None = Field(default=None, max_length=5000)
    priority: PriorityName | None = None
    estimate: float | None = Field(default=None, ge=0, le=999)
    # "in_sprint" lo maneja el Sprint Planning; no se asigna a mano
    status: Literal["new", "refined", "ready", "done", "discarded"] | None = None


class PbiMove(CamelModel):
    index: int = Field(ge=0, description="Nueva posición en el backlog (0 = más prioritario)")


class PbiSplit(CamelModel):
    titles: list[str] = Field(min_length=2, max_length=10, description="Títulos de los nuevos PBIs")


# ------------------------------------------------------------------ Sprints
class SprintPbi(CamelModel):
    id: UUID
    code: str
    title: str
    estimate: float | None
    status: PbiStatusName
    task_count: int = 0
    tasks_done: int = 0


class SprintSummary(CamelModel):
    """Lo que queda guardado al cerrar el Sprint: resultados, pendientes, acuerdos y métricas."""

    goal_met: bool | None = None
    done: list[str] = []  # PBIs terminados ("SAL-3 · Título")
    returned: list[str] = []  # PBIs que vuelven al Product Backlog para una nueva decisión
    agreements: list[str] = []  # acuerdos de la Review y la Retrospective
    improvement_actions: list[str] = []
    points_committed: float = 0
    points_done: float = 0
    tasks_total: int = 0
    tasks_done: int = 0
    blocked_tasks: int = 0
    daily_count: int = 0


class SprintOut(CamelModel):
    id: UUID
    number: int
    goal: str
    start_date: date
    end_date: date
    status: SprintStatusName
    close_reason: str | None
    closed_at: datetime | None
    items: list[SprintPbi]
    points_total: float
    points_done: float
    task_count: int
    tasks_done: int
    has_review: bool = False  # ya hay acta de Sprint Review
    has_retro: bool = False  # ya hay acta de Sprint Retrospective
    summary: SprintSummary | None = None  # se guarda al cerrar


class SprintsOut(ProjectHeader):
    sprints: list[SprintOut]
    candidates: list[PbiOut]  # PBIs que se pueden seleccionar en una nueva Sprint Planning
    velocity: float | None  # promedio de puntos terminados en los últimos 3 Sprints cerrados
    members: list[BoardMember]
    default_weeks: int = 2  # duración sugerida, según la configuración del espacio


class SprintCreate(CamelModel):
    goal: str = Field(min_length=5, max_length=500)
    start_date: date
    end_date: date
    item_ids: list[UUID] = Field(min_length=1)
    start_now: bool = False
    create_tasks: bool = True  # crear en el tablero las tareas de cada PBI
    # Descomposición: títulos de las tareas de cada PBI. Un PBI sin tareas indicadas lleva una tarjeta con su título.
    tasks: dict[UUID, list[Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]]] = {}
    plan: str | None = Field(default=None, max_length=5000)
    attendee_ids: list[UUID] = []


class SprintUpdate(CamelModel):
    goal: str | None = Field(default=None, min_length=5, max_length=500)
    start_date: date | None = None  # solo mientras está planificado
    end_date: date | None = None
    # Ajuste del alcance del Sprint Backlog
    add_item_ids: list[UUID] = []
    remove_item_ids: list[UUID] = []
    tasks: dict[UUID, list[Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]]] = {}


class SprintClose(CamelModel):
    outcome: Literal["closed", "cancelled"]
    reason: str | None = Field(default=None, max_length=1000)
    goal_met: bool | None = None  # ¿se cumplió el Sprint Goal? (al cerrar)


# ------------------------------------------------------------------ eventos Scrum
class RetroActionIn(CamelModel):
    description: str = Field(min_length=2, max_length=500)
    owner_id: UUID | None = None
    due_date: date | None = None


class RetroActionOut(CamelModel):
    id: UUID
    description: str
    owner_id: UUID | None
    due_date: date | None
    status: ActionStatusName


class RetroActionUpdate(CamelModel):
    status: ActionStatusName


class EventOut(CamelModel):
    id: UUID
    sprint_id: UUID
    sprint_number: int
    type: EventTypeName
    held_at: datetime
    duration_minutes: int | None
    notes: str | None
    agreements: str | None
    data: dict[str, str]
    attendee_ids: list[UUID]
    actions: list[RetroActionOut]
    created_by_name: str | None


class EventSprint(CamelModel):
    id: UUID
    number: int
    goal: str
    status: SprintStatusName
    start_date: date
    end_date: date


class EventsOut(ProjectHeader):
    sprints: list[EventSprint]
    members: list[BoardMember]
    events: list[EventOut]


class EventCreate(CamelModel):
    sprint_id: UUID
    type: EventTypeName
    held_at: datetime
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    notes: str | None = Field(default=None, max_length=10000)
    agreements: str | None = Field(default=None, max_length=5000)
    data: dict[str, str] = {}
    attendee_ids: list[UUID] = []
    actions: list[RetroActionIn] = []


class EventUpdate(CamelModel):
    held_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    notes: str | None = Field(default=None, max_length=10000)
    agreements: str | None = Field(default=None, max_length=5000)
    data: dict[str, str] | None = None
    attendee_ids: list[UUID] | None = None
    new_actions: list[RetroActionIn] = []
