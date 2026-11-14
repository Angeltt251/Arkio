from datetime import datetime
from uuid import UUID

from app.schemas.common import CamelModel


class LogChange(CamelModel):
    field: str
    old: str | None
    new: str | None


class LogEntry(CamelModel):
    id: int
    actor_id: UUID | None
    actor_name: str
    message: str
    highlight: str | None
    kind: str
    entity_type: str
    entity_label: str
    action: str
    action_label: str
    source: str
    created_at: datetime
    changes: list[LogChange]


class LogActor(CamelModel):
    id: UUID
    name: str


class LogbookPage(CamelModel):
    items: list[LogEntry]
    next_before_id: int | None
    actors: list[LogActor]
