"""Ciclo de vida del proyecto (12 pasos)."""

from typing import Literal
from uuid import UUID

from app.schemas.common import CamelModel
from app.schemas.scrum import ProjectHeader, SprintStatusName

StepKey = Literal[
    "workspace", "project", "team", "product_goal", "backlog", "definition_of_done",
    "planning", "start", "tracking", "review", "retrospective", "close",
]


class LifecycleStep(CamelModel):
    key: StepKey
    phase: Literal["setup", "product", "sprint"]  # preparación (1-3), producto (4-6), Sprint (7-12, se repite)
    title: str
    done: bool
    detail: str
    hint: str
    blocked: str | None = None  # qué falta antes de poder hacer este paso


class LifecycleOut(ProjectHeader):
    workspace_name: str
    steps: list[LifecycleStep]
    current_step: StepKey | None
    sprint_id: UUID | None
    sprint_number: int | None
    sprint_status: SprintStatusName | None
    next_sprint: bool  # el último Sprint está cerrado: toca planificar el siguiente
