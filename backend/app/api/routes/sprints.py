"""Sprint Planning y Sprint Backlog: duración, selección de PBIs, Sprint Goal, inicio y cierre.

Los Sprints no se borran (lo impide un trigger): se cierran o cancelan con motivo.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, UserDB
from app.db.models import (
    BacklogItem,
    BoardColumn,
    EventAttendee,
    Project,
    ProjectMember,
    ScrumEvent,
    Sprint,
    SprintItem,
    Task,
)
from app.schemas.scrum import SprintClose, SprintCreate, SprintOut, SprintPbi, SprintsOut, SprintUpdate
from app.services.permissions import project_access, require_project_manager
from app.services.scrum import header, pbi_outs, project_members, task_progress

router = APIRouter(tags=["sprints"])

MAX_SPRINT_DAYS = 31  # Scrum: un mes o menos (igual que la restricción de la base de datos)
OPEN = ("planned", "active")


def _check_dates(start, end) -> None:
    if end < start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha de término debe ser posterior al inicio")
    if (end - start).days > MAX_SPRINT_DAYS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un Sprint dura un mes o menos")


def _active_sprint(db: Session, project_id: UUID) -> Sprint | None:
    return db.scalar(select(Sprint).where(Sprint.project_id == project_id, Sprint.status == "active"))


def _sprint_out(db: Session, sprint: Sprint) -> SprintOut:
    items = list(db.scalars(
        select(BacklogItem).join(SprintItem, SprintItem.backlog_item_id == BacklogItem.id)
        .where(SprintItem.sprint_id == sprint.id).order_by(BacklogItem.rank)
    ))
    progress = task_progress(db, [i.id for i in items], sprint.id)
    total, done = db.execute(
        select(func.count(), func.count(Task.completed_at))
        .where(Task.sprint_id == sprint.id, Task.archived_at.is_(None))
    ).one()
    return SprintOut(
        id=sprint.id, number=sprint.number, goal=sprint.goal, start_date=sprint.start_date,
        end_date=sprint.end_date, status=sprint.status, close_reason=sprint.close_reason, closed_at=sprint.closed_at,
        items=[
            SprintPbi(id=i.id, code=i.code, title=i.title, estimate=float(i.estimate) if i.estimate is not None else None,
                      status=i.status, task_count=progress.get(i.id, (0, 0))[0], tasks_done=progress.get(i.id, (0, 0))[1])
            for i in items
        ],
        points_total=sum(float(i.estimate or 0) for i in items),
        points_done=sum(float(i.estimate or 0) for i in items if i.status == "done"),
        task_count=total, tasks_done=done,
    )


def _velocity(sprints: list[SprintOut]) -> float | None:
    closed = [s for s in sprints if s.status == "closed"][:3]
    return round(sum(s.points_done for s in closed) / len(closed), 1) if closed else None


def _managed_sprint(db: Session, sprint_id: UUID, user_id: UUID) -> Sprint:
    sprint = db.get(Sprint, sprint_id)
    if sprint is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sprint no encontrado")
    require_project_manager(db, sprint.project_id, user_id)
    return sprint


@router.get("/projects/{project_id}/sprints", response_model=SprintsOut)
def list_sprints(project_id: UUID, user: CurrentUser, db: UserDB) -> SprintsOut:
    project = project_access(db, project_id, user.id)
    sprints = [_sprint_out(db, s) for s in db.scalars(
        select(Sprint).where(Sprint.project_id == project_id).order_by(Sprint.number.desc())
    )]
    candidates = list(db.scalars(
        select(BacklogItem).where(
            BacklogItem.project_id == project_id, BacklogItem.archived_at.is_(None),
            BacklogItem.status.in_(("new", "refined", "ready")),
        ).order_by(BacklogItem.rank)
    ))
    return SprintsOut(
        **header(db, project, user.id), sprints=sprints, candidates=pbi_outs(db, candidates),
        velocity=_velocity(sprints), members=project_members(db, project_id, include_observers=False),
    )


@router.post("/projects/{project_id}/sprints", response_model=SprintOut, status_code=status.HTTP_201_CREATED)
def plan_sprint(project_id: UUID, payload: SprintCreate, user: CurrentUser, db: UserDB) -> SprintOut:
    """Confirma la Sprint Planning: crea el Sprint numerado, su Sprint Backlog y el acta de la Planning."""
    project: Project = project_access(db, project_id, user.id, write=True)
    _check_dates(payload.start_date, payload.end_date)
    if payload.start_now and (active := _active_sprint(db, project_id)):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"El Sprint #{active.number} sigue en curso: ciérralo antes de iniciar otro")

    wanted = list(dict.fromkeys(payload.item_ids))
    items = list(db.scalars(select(BacklogItem).where(BacklogItem.id.in_(wanted)).order_by(BacklogItem.rank)))
    if len(items) != len(wanted) or any(i.project_id != project_id or i.archived_at for i in items):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Algún PBI no pertenece a este proyecto")
    if busy := [i.code for i in items if i.status not in ("new", "refined", "ready")]:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Estos PBIs no están disponibles para un Sprint: {', '.join(busy)}")

    members = set(db.scalars(select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)))
    if not set(payload.attendee_ids) <= members:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Los participantes deben ser miembros del proyecto")

    sprint = Sprint(
        project_id=project_id, goal=payload.goal.strip(), start_date=payload.start_date, end_date=payload.end_date,
        status="active" if payload.start_now else "planned", created_by=user.id,
    )
    db.add(sprint)
    try:
        db.flush()  # el trigger asigna el número correlativo
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya hay un Sprint en curso en este proyecto") from exc

    first_column = db.scalar(
        select(BoardColumn).where(BoardColumn.project_id == project_id, BoardColumn.is_done.is_(False))
        .order_by(BoardColumn.position).limit(1)
    )
    position = 0.0
    if first_column:
        position = db.scalar(select(func.max(Task.position)).where(Task.column_id == first_column.id)) or 0.0
    for item in items:
        db.add(SprintItem(sprint_id=sprint.id, backlog_item_id=item.id))
        item.status = "in_sprint"
        # Las tareas pendientes de un Sprint anterior pasan a este; si no tiene, se crea una tarjeta
        pending = list(db.scalars(select(Task).where(
            Task.backlog_item_id == item.id, Task.archived_at.is_(None), Task.completed_at.is_(None)
        )))
        for task in pending:
            task.sprint_id = sprint.id
        if not pending and payload.create_tasks and first_column:
            position += 1
            db.add(Task(
                project_id=project_id, column_id=first_column.id, sprint_id=sprint.id, backlog_item_id=item.id,
                title=item.title, priority=item.priority, position=position, created_by=user.id,
            ))

    codes = ", ".join(i.code for i in items)
    planning = ScrumEvent(
        project_id=project_id, sprint_id=sprint.id, type="sprint_planning", held_at=datetime.now(timezone.utc),
        data={"product_goal": project.product_goal or "", "sprint_goal": sprint.goal, "pbis": codes,
              "plan": (payload.plan or "").strip()},
        created_by=user.id,
    )
    db.add(planning)
    db.flush()
    for uid in dict.fromkeys(payload.attendee_ids):
        db.add(EventAttendee(event_id=planning.id, user_id=uid))
    if payload.start_now and project.status == "planning":
        project.status = "active"
    db.commit()
    db.refresh(sprint)
    return _sprint_out(db, sprint)


@router.patch("/sprints/{sprint_id}", response_model=SprintOut)
def update_sprint(sprint_id: UUID, payload: SprintUpdate, user: CurrentUser, db: UserDB) -> SprintOut:
    sprint = db.get(Sprint, sprint_id)
    if sprint is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sprint no encontrado")
    project_access(db, sprint.project_id, user.id, write=True)
    if sprint.status not in OPEN:
        raise HTTPException(status.HTTP_409_CONFLICT, "El Sprint ya terminó: su historia no se modifica")
    if payload.goal is not None:
        sprint.goal = payload.goal.strip()
    if payload.end_date is not None:
        _check_dates(sprint.start_date, payload.end_date)
        sprint.end_date = payload.end_date
    db.commit()
    db.refresh(sprint)
    return _sprint_out(db, sprint)


@router.post("/sprints/{sprint_id}/start", response_model=SprintOut)
def start_sprint(sprint_id: UUID, user: CurrentUser, db: UserDB) -> SprintOut:
    sprint = _managed_sprint(db, sprint_id, user.id)
    if sprint.status != "planned":
        raise HTTPException(status.HTTP_409_CONFLICT, "Solo se puede iniciar un Sprint planificado")
    if active := _active_sprint(db, sprint.project_id):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"El Sprint #{active.number} sigue en curso: ciérralo antes de iniciar otro")
    sprint.status = "active"
    project = db.get(Project, sprint.project_id)
    if project.status == "planning":
        project.status = "active"
    db.commit()
    db.refresh(sprint)
    return _sprint_out(db, sprint)


@router.post("/sprints/{sprint_id}/close", response_model=SprintOut)
def close_sprint(sprint_id: UUID, payload: SprintClose, user: CurrentUser, db: UserDB) -> SprintOut:
    """Cierra o cancela el Sprint. Los PBIs terminados quedan "Terminado"; el resto vuelve al Product Backlog."""
    sprint = _managed_sprint(db, sprint_id, user.id)
    if sprint.status not in OPEN:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este Sprint ya está cerrado")
    reason = (payload.reason or "").strip() or None
    if payload.outcome == "cancelled" and not reason:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indica el motivo de la cancelación")

    items = list(db.scalars(
        select(BacklogItem).join(SprintItem, SprintItem.backlog_item_id == BacklogItem.id)
        .where(SprintItem.sprint_id == sprint.id)
    ))
    progress = task_progress(db, [i.id for i in items], sprint.id)
    for item in items:
        if item.status != "in_sprint":
            continue
        total, done = progress.get(item.id, (0, 0))
        finished = payload.outcome == "closed" and total > 0 and done == total
        item.status = "done" if finished else "ready"

    sprint.status = payload.outcome
    sprint.close_reason = reason
    sprint.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(sprint)
    return _sprint_out(db, sprint)
