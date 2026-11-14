from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import CamelModel
from app.schemas.scrum import ProjectHeader, SprintStatusName

Audience = Literal["client", "team"]


class BurndownDay(CamelModel):
    day: date
    remaining: int | None  # None: días que aún no ocurren
    ideal: float


class ReportPbi(CamelModel):
    code: str
    title: str
    type: str
    estimate: float | None
    status: str
    finished: bool
    task_count: int
    tasks_done: int


class ReportTask(CamelModel):
    title: str
    pbi_code: str | None
    column: str
    assignees: list[str]
    completed_at: datetime | None
    is_blocked: bool
    blocked_reason: str | None
    due_date: date | None


class ReportAction(CamelModel):
    description: str
    owner: str | None
    due_date: date | None
    status: str
    sprint_number: int


class Contribution(CamelModel):
    name: str
    role: str
    tasks_done: int
    tasks_open: int


class SprintReport(CamelModel):
    id: UUID
    number: int
    goal: str
    start_date: date
    end_date: date
    status: SprintStatusName
    close_reason: str | None
    closed_at: datetime | None
    days_total: int
    days_elapsed: int
    pbis_total: int
    pbis_done: int
    points_total: float
    points_done: float
    task_count: int
    tasks_done: int
    tasks_blocked: int
    tasks_overdue: int
    completion: int  # % sobre puntos (o PBIs si no hay estimaciones)
    goal_status: Literal["achieved", "partial", "not_achieved", "cancelled", "in_progress", "planned"]
    events: dict[str, int]
    burndown: list[BurndownDay]
    pbis: list[ReportPbi]


class SprintReportDetail(SprintReport):
    """Lo que necesita el PDF: además del resumen, actas, tareas y acciones."""

    planning_plan: str | None = None
    review: dict[str, str] = Field(default_factory=dict)
    review_date: datetime | None = None
    retro: dict[str, str] = Field(default_factory=dict)
    blockers: list[str] = Field(default_factory=list)
    actions: list[ReportAction] = Field(default_factory=list)
    tasks: list[ReportTask] = Field(default_factory=list)
    contributions: list[Contribution] = Field(default_factory=list)
    next_items: list[ReportPbi] = Field(default_factory=list)
    next_sprint: str | None = None  # "Sprint 2 (en curso, 13 nov al 26 nov): objetivo"


class ProjectTotals(CamelModel):
    sprints_closed: int
    velocity: float | None
    pbis_total: int
    pbis_done: int
    points_remaining: float
    open_actions: int
    backlog_by_status: dict[str, int]


class ReportsOut(ProjectHeader):
    project_color: str
    totals: ProjectTotals
    sprints: list[SprintReport]


class ReportRequest(CamelModel):
    audience: Audience = "client"
    note: str | None = Field(None, max_length=2000)
    client_name: str | None = Field(None, max_length=120)
