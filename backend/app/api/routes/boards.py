"""Tablero Kanban del proyecto: columnas, tareas y movimientos.

Las tareas no se borran: se archivan, para que la bitácora conserve la trazabilidad.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, UserDB
from app.db.models import BoardColumn, Profile, Project, ProjectMember, Task, TaskAssignee, WorkspaceMember
from app.schemas.board import BoardMember, BoardOut, ColumnOut, TaskCreate, TaskMove, TaskOut, TaskUpdate
from app.services.permissions import ADMIN_ROLES, project_access

router = APIRouter(tags=["tablero"])


def _can_edit(db: Session, project: Project, user_id: UUID) -> bool:
    ws_member = db.get(WorkspaceMember, (project.workspace_id, user_id))
    if ws_member and ws_member.status == "active" and ws_member.role in ADMIN_ROLES:
        return True
    member = db.get(ProjectMember, (project.id, user_id))
    return member is not None and member.role != "observer"


def _columns(db: Session, project_id: UUID) -> list[BoardColumn]:
    return list(db.scalars(
        select(BoardColumn).where(BoardColumn.project_id == project_id).order_by(BoardColumn.position)
    ))


def _assignees(db: Session, task_ids: list[UUID]) -> dict[UUID, list[UUID]]:
    result: dict[UUID, list[UUID]] = {tid: [] for tid in task_ids}
    if task_ids:
        for row in db.execute(select(TaskAssignee.task_id, TaskAssignee.user_id).where(TaskAssignee.task_id.in_(task_ids))):
            result[row.task_id].append(row.user_id)
    return result


def _task_out(task: Task, assignee_ids: list[UUID]) -> TaskOut:
    return TaskOut(
        id=task.id, column_id=task.column_id, title=task.title, description=task.description,
        priority=task.priority, position=task.position, due_date=task.due_date, is_blocked=task.is_blocked,
        blocked_reason=task.blocked_reason, assignee_ids=assignee_ids, completed=task.completed_at is not None,
    )


def _project_member_ids(db: Session, project_id: UUID) -> set[UUID]:
    return set(db.scalars(select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)))


def _set_assignees(db: Session, task: Task, user_ids: list[UUID]) -> None:
    allowed = _project_member_ids(db, task.project_id)
    wanted = set(user_ids)
    if not wanted <= allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo se pueden asignar miembros del proyecto")
    current = set(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)))
    for uid in current - wanted:
        db.delete(db.get(TaskAssignee, (task.id, uid)))
    for uid in wanted - current:
        db.add(TaskAssignee(task_id=task.id, user_id=uid))


def _editable_task(db: Session, task_id: UUID, user_id: UUID) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.archived_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tarea no encontrada")
    project_access(db, task.project_id, user_id, write=True)
    return task


def _check_wip(db: Session, column: BoardColumn, exclude_task: UUID | None = None) -> None:
    if column.wip_limit is None:
        return
    query = select(func.count()).select_from(Task).where(Task.column_id == column.id, Task.archived_at.is_(None))
    if exclude_task:
        query = query.where(Task.id != exclude_task)
    if db.scalar(query) >= column.wip_limit:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"La columna «{column.name}» alcanzó su límite WIP de {column.wip_limit} tareas"
        )


@router.get("/projects/{project_id}/board", response_model=BoardOut)
def get_board(project_id: UUID, user: CurrentUser, db: UserDB) -> BoardOut:
    project = project_access(db, project_id, user.id)
    columns = _columns(db, project_id)
    tasks = list(db.scalars(
        select(Task).where(Task.project_id == project_id, Task.archived_at.is_(None)).order_by(Task.position, Task.created_at)
    ))
    assignees = _assignees(db, [t.id for t in tasks])
    by_column: dict[UUID, list[TaskOut]] = {c.id: [] for c in columns}
    for task in tasks:
        by_column.setdefault(task.column_id, []).append(_task_out(task, assignees[task.id]))

    members = db.execute(
        select(Profile).join(ProjectMember, ProjectMember.user_id == Profile.id)
        .where(ProjectMember.project_id == project_id).order_by(Profile.full_name)
    ).scalars()
    return BoardOut(
        project_id=project.id, project_name=project.name, project_key=project.key, project_color=project.color,
        can_edit=_can_edit(db, project, user.id),
        columns=[
            ColumnOut(id=c.id, name=c.name, position=c.position, wip_limit=c.wip_limit, is_done=c.is_done,
                      tasks=by_column[c.id])
            for c in columns
        ],
        members=[BoardMember(id=m.id, name=m.full_name or m.email, avatar_url=m.avatar_url) for m in members],
    )


@router.post("/projects/{project_id}/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(project_id: UUID, payload: TaskCreate, user: CurrentUser, db: UserDB) -> TaskOut:
    project_access(db, project_id, user.id, write=True)
    columns = _columns(db, project_id)
    if not columns:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El proyecto no tiene tablero")
    column = next((c for c in columns if c.id == payload.column_id), None) if payload.column_id else columns[0]
    if column is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La columna no pertenece a este proyecto")
    _check_wip(db, column)

    last = db.scalar(select(func.max(Task.position)).where(Task.column_id == column.id, Task.archived_at.is_(None)))
    task = Task(
        project_id=project_id, column_id=column.id, title=payload.title.strip(), description=payload.description,
        priority=payload.priority, due_date=payload.due_date, position=(last or 0) + 1, created_by=user.id,
    )
    db.add(task)
    db.flush()
    _set_assignees(db, task, payload.assignee_ids)
    db.commit()
    db.refresh(task)
    return _task_out(task, payload.assignee_ids)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(task_id: UUID, payload: TaskUpdate, user: CurrentUser, db: UserDB) -> TaskOut:
    task = _editable_task(db, task_id, user.id)
    changes = payload.model_dump(exclude_unset=True, exclude={"assignee_ids"})
    if "title" in changes and changes["title"] is not None:
        changes["title"] = changes["title"].strip()
    if changes.get("is_blocked") is False:
        changes["blocked_reason"] = None
    for field, value in changes.items():
        setattr(task, field, value)
    if payload.assignee_ids is not None:
        _set_assignees(db, task, payload.assignee_ids)
    db.commit()
    db.refresh(task)
    return _task_out(task, _assignees(db, [task.id])[task.id])


@router.post("/tasks/{task_id}/move", response_model=TaskOut)
def move_task(task_id: UUID, payload: TaskMove, user: CurrentUser, db: UserDB) -> TaskOut:
    task = _editable_task(db, task_id, user.id)
    column = db.get(BoardColumn, payload.column_id)
    if column is None or column.project_id != task.project_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La columna no pertenece a este proyecto")
    if column.id != task.column_id:
        _check_wip(db, column, exclude_task=task.id)

    siblings = list(db.scalars(
        select(Task.position).where(Task.column_id == column.id, Task.archived_at.is_(None), Task.id != task.id)
        .order_by(Task.position)
    ))
    index = min(payload.index, len(siblings))
    before = siblings[index - 1] if index > 0 else None
    after = siblings[index] if index < len(siblings) else None
    if before is None and after is None:
        position = 1.0
    elif before is None:
        position = after - 1
    elif after is None:
        position = before + 1
    else:
        position = (before + after) / 2

    task.column_id = column.id  # el trigger ajusta completed_at según la columna "terminado"
    task.position = position
    db.commit()
    db.refresh(task)
    return _task_out(task, _assignees(db, [task.id])[task.id])


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_task(task_id: UUID, user: CurrentUser, db: UserDB) -> None:
    task = _editable_task(db, task_id, user.id)
    task.archived_at = datetime.now(timezone.utc)
    db.commit()
