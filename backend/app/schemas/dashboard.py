from datetime import date, datetime
from typing import Literal
from uuid import UUID

from app.schemas.common import CamelModel


class Stat(CamelModel):
    value: int
    delta: float
    delta_kind: Literal["absolute", "percent"] = "absolute"
    trend: list[int]


class DashboardStats(CamelModel):
    active_projects: Stat
    sprints_in_progress: Stat
    completed_tasks: Stat
    team_members: Stat


class MemberMini(CamelModel):
    id: UUID
    name: str
    avatar_url: str | None = None


class ProjectSummary(CamelModel):
    id: UUID
    name: str
    color: str
    status: Literal["planning", "active", "paused", "closed"]
    sprint_number: int | None
    sprint_days: int | None
    progress: int
    members: list[MemberMini]
    extra_members: int


class CurrentSprint(CamelModel):
    id: UUID
    project_id: UUID
    project_name: str
    number: int
    start_date: date
    end_date: date
    working_days: int
    goal: str
    progress: int
    status: Literal["planned", "active", "closed", "cancelled"]


class ActivityItem(CamelModel):
    id: int
    actor_name: str
    message: str
    highlight: str | None = None
    kind: Literal["move", "comment", "create", "label", "update", "other"]
    created_at: datetime


class BurndownPoint(CamelModel):
    label: str
    ideal: float
    real: int | None


class Burndown(CamelModel):
    sprint_id: UUID
    sprint_label: str
    points: list[BurndownPoint]


class DashboardOut(CamelModel):
    stats: DashboardStats
    projects: list[ProjectSummary]
    current_sprint: CurrentSprint | None
    activity: list[ActivityItem]
    burndown: Burndown | None
    unread_notifications: int
