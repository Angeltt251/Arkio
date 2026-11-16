"""Eventos Scrum: actas de Planning, Daily, Review y Retrospective, con asistentes y acciones de mejora.

Las actas no se eliminan: forman parte de la historia del Sprint.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, UserDB
from app.db.models import EventAttendee, Profile, ProjectMember, RetroAction, ScrumEvent, Sprint
from app.schemas.scrum import (
    EventCreate,
    EventOut,
    EventSprint,
    EventsOut,
    EventUpdate,
    RetroActionIn,
    RetroActionOut,
    RetroActionUpdate,
)
from app.services.notifications import actor_name, notify
from app.services.permissions import project_access
from app.services.scrum import header, project_members

router = APIRouter(tags=["eventos scrum"])

# Campos propios de cada evento (sección 7.6 de la especificación)
EVENT_FIELDS: dict[str, tuple[str, ...]] = {
    "sprint_planning": ("product_goal", "sprint_goal", "pbis", "plan"),
    "daily_scrum": ("progress", "next_plan", "blockers"),
    "sprint_review": ("increment", "feedback", "backlog_changes"),
    "sprint_retrospective": ("went_well", "difficulties", "causes"),
}
MAX_FIELD = 5000


def _clean_data(event_type: str, data: dict[str, str]) -> dict[str, str]:
    allowed = EVENT_FIELDS[event_type]
    return {k: v.strip()[:MAX_FIELD] for k, v in data.items() if k in allowed and isinstance(v, str) and v.strip()}


def _member_ids(db: Session, project_id: UUID) -> set[UUID]:
    return set(db.scalars(select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)))


def _set_attendees(db: Session, event: ScrumEvent, user_ids: list[UUID]) -> None:
    wanted = set(user_ids)
    if not wanted <= _member_ids(db, event.project_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Los asistentes deben ser miembros del proyecto")
    current = set(db.scalars(select(EventAttendee.user_id).where(EventAttendee.event_id == event.id)))
    for uid in current - wanted:
        db.delete(db.get(EventAttendee, (event.id, uid)))
    for uid in wanted - current:
        db.add(EventAttendee(event_id=event.id, user_id=uid))


def _add_actions(db: Session, event: ScrumEvent, actions: list[RetroActionIn], actor_id: UUID) -> None:
    if not actions:
        return
    if event.type != "sprint_retrospective":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Las acciones de mejora se registran en la Retrospectiva")
    members = _member_ids(db, event.project_id)
    for action in actions:
        if action.owner_id and action.owner_id not in members:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "El responsable debe ser miembro del proyecto")
        db.add(RetroAction(project_id=event.project_id, event_id=event.id, description=action.description.strip(),
                           owner_id=action.owner_id, due_date=action.due_date))
        if action.owner_id:
            notify(db, [action.owner_id], actor_id=actor_id, kind="retro_action", project_id=event.project_id,
                   link=f"/eventos?proyecto={event.project_id}",
                   title=f"{actor_name(db, actor_id)} te asignó una acción de mejora",
                   body=action.description.strip()
                   + (f" (para el {action.due_date:%d-%m-%Y})" if action.due_date else ""))


def _event_outs(db: Session, events: list[ScrumEvent]) -> list[EventOut]:
    ids = [e.id for e in events]
    attendees: dict[UUID, list[UUID]] = {i: [] for i in ids}
    actions: dict[UUID, list[RetroActionOut]] = {i: [] for i in ids}
    if ids:
        for row in db.execute(select(EventAttendee.event_id, EventAttendee.user_id).where(EventAttendee.event_id.in_(ids))):
            attendees[row.event_id].append(row.user_id)
        for a in db.scalars(select(RetroAction).where(RetroAction.event_id.in_(ids)).order_by(RetroAction.created_at)):
            actions[a.event_id].append(RetroActionOut.model_validate(a))
    sprint_ids = {e.sprint_id for e in events}
    numbers = dict(db.execute(select(Sprint.id, Sprint.number).where(Sprint.id.in_(sprint_ids))).all()) if sprint_ids else {}
    author_ids = {e.created_by for e in events if e.created_by}
    authors = dict(db.execute(
        select(Profile.id, Profile.full_name).where(Profile.id.in_(author_ids))
    ).all()) if author_ids else {}
    return [
        EventOut(
            id=e.id, sprint_id=e.sprint_id, sprint_number=numbers.get(e.sprint_id, 0), type=e.type, held_at=e.held_at,
            duration_minutes=e.duration_minutes, notes=e.notes, agreements=e.agreements,
            data={k: str(v) for k, v in (e.data or {}).items()}, attendee_ids=attendees[e.id], actions=actions[e.id],
            created_by_name=authors.get(e.created_by),
        )
        for e in events
    ]


def _editable_event(db: Session, event_id: UUID, user_id: UUID) -> ScrumEvent:
    event = db.get(ScrumEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evento no encontrado")
    project_access(db, event.project_id, user_id, write=True)
    return event


@router.get("/projects/{project_id}/events", response_model=EventsOut)
def list_events(project_id: UUID, user: CurrentUser, db: UserDB, sprint_id: UUID | None = None) -> EventsOut:
    project = project_access(db, project_id, user.id)
    sprints = list(db.scalars(select(Sprint).where(Sprint.project_id == project_id).order_by(Sprint.number.desc())))
    query = select(ScrumEvent).where(ScrumEvent.project_id == project_id)
    if sprint_id:
        query = query.where(ScrumEvent.sprint_id == sprint_id)
    events = list(db.scalars(query.order_by(ScrumEvent.held_at.desc())))
    return EventsOut(
        **header(db, project, user.id),
        sprints=[EventSprint.model_validate(s) for s in sprints],
        members=project_members(db, project_id),
        events=_event_outs(db, events),
    )


@router.post("/projects/{project_id}/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(project_id: UUID, payload: EventCreate, user: CurrentUser, db: UserDB) -> EventOut:
    project_access(db, project_id, user.id, write=True)
    sprint = db.get(Sprint, payload.sprint_id)
    if sprint is None or sprint.project_id != project_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El Sprint no pertenece a este proyecto")
    event = ScrumEvent(
        project_id=project_id, sprint_id=sprint.id, type=payload.type, held_at=payload.held_at,
        duration_minutes=payload.duration_minutes, notes=(payload.notes or "").strip() or None,
        agreements=(payload.agreements or "").strip() or None, data=_clean_data(payload.type, payload.data),
        created_by=user.id,
    )
    db.add(event)
    db.flush()
    _set_attendees(db, event, payload.attendee_ids)
    _add_actions(db, event, payload.actions, user.id)
    db.commit()
    db.refresh(event)
    return _event_outs(db, [event])[0]


@router.patch("/events/{event_id}", response_model=EventOut)
def update_event(event_id: UUID, payload: EventUpdate, user: CurrentUser, db: UserDB) -> EventOut:
    event = _editable_event(db, event_id, user.id)
    changes = payload.model_dump(exclude_unset=True, exclude={"attendee_ids", "new_actions", "data"})
    for field in ("notes", "agreements"):
        if field in changes:
            changes[field] = (changes[field] or "").strip() or None
    for field, value in changes.items():
        setattr(event, field, value)
    if payload.data is not None:
        event.data = _clean_data(event.type, payload.data)
    if payload.attendee_ids is not None:
        _set_attendees(db, event, payload.attendee_ids)
    _add_actions(db, event, payload.new_actions, user.id)
    db.commit()
    db.refresh(event)
    return _event_outs(db, [event])[0]


@router.patch("/retro-actions/{action_id}", response_model=RetroActionOut)
def update_retro_action(action_id: UUID, payload: RetroActionUpdate, user: CurrentUser, db: UserDB) -> RetroAction:
    action = db.get(RetroAction, action_id)
    if action is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Acción no encontrada")
    project_access(db, action.project_id, user.id, write=True)
    action.status = payload.status
    db.commit()
    db.refresh(action)
    return action
