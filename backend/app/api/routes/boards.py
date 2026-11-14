"""Tablero Kanban del proyecto: columnas, tareas y movimientos.

Las tareas no se borran: se archivan, para que la bitácora conserve la trazabilidad.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, UserDB
from app.db.models import (
    BacklogItem,
    BoardColumn,
    ChecklistItem,
    Label,
    Profile,
    ProjectMember,
    Sprint,
    SprintItem,
    Task,
    TaskAssignee,
    TaskLabel,
)
from app.schemas.board import (
    BoardMember,
    BoardOut,
    ChecklistItemCreate,
    ChecklistItemOut,
    ChecklistItemUpdate,
    ColumnCreate,
    ColumnMove,
    ColumnOut,
    ColumnUpdate,
    LabelCreate,
    LabelOut,
    TaskCreate,
    TaskMove,
    TaskOut,
    TaskUpdate,
)
from app.services.permissions import can_edit, can_manage, project_access, require_project_manager

router = APIRouter(tags=["tablero"])


def _labels(db: Session, project_id: UUID) -> list[Label]:
    return list(db.scalars(select(Label).where(Label.project_id == project_id).order_by(Label.name)))


def _columns(db: Session, project_id: UUID) -> list[BoardColumn]:
    return list(db.scalars(
        select(BoardColumn).where(BoardColumn.project_id == project_id).order_by(BoardColumn.position)
    ))


def _task_outs(db: Session, tasks: list[Task]) -> list[TaskOut]:
    """Arma las tarjetas con responsables, etiquetas, progreso del checklist, PBI y Sprint (en pocas consultas)."""
    ids = [t.id for t in tasks]
    assignees: dict[UUID, list[UUID]] = {tid: [] for tid in ids}
    labels: dict[UUID, list[UUID]] = {tid: [] for tid in ids}
    checklist: dict[UUID, tuple[int, int]] = {}
    if ids:
        for row in db.execute(select(TaskAssignee.task_id, TaskAssignee.user_id).where(TaskAssignee.task_id.in_(ids))):
            assignees[row.task_id].append(row.user_id)
        for row in db.execute(select(TaskLabel.task_id, TaskLabel.label_id).where(TaskLabel.task_id.in_(ids))):
            labels[row.task_id].append(row.label_id)
        for row in db.execute(
            select(ChecklistItem.task_id, func.count(), func.count().filter(ChecklistItem.is_done))
            .where(ChecklistItem.task_id.in_(ids)).group_by(ChecklistItem.task_id)
        ):
            checklist[row[0]] = (row[1], row[2])
    pbi_ids = {t.backlog_item_id for t in tasks if t.backlog_item_id}
    codes = dict(db.execute(select(BacklogItem.id, BacklogItem.code).where(BacklogItem.id.in_(pbi_ids))).all()) if pbi_ids else {}
    sprint_ids = {t.sprint_id for t in tasks if t.sprint_id}
    numbers = dict(db.execute(select(Sprint.id, Sprint.number).where(Sprint.id.in_(sprint_ids))).all()) if sprint_ids else {}
    return [
        TaskOut(
            id=t.id, column_id=t.column_id, title=t.title, description=t.description,
            priority=t.priority, position=t.position, due_date=t.due_date, is_blocked=t.is_blocked,
            blocked_reason=t.blocked_reason, assignee_ids=assignees[t.id], completed=t.completed_at is not None,
            label_ids=labels[t.id], checklist_total=checklist.get(t.id, (0, 0))[0],
            checklist_done=checklist.get(t.id, (0, 0))[1], backlog_item_id=t.backlog_item_id,
            backlog_item_code=codes.get(t.backlog_item_id), sprint_number=numbers.get(t.sprint_id),
        )
        for t in tasks
    ]


def _task_out(db: Session, task: Task) -> TaskOut:
    return _task_outs(db, [task])[0]


def _set_labels(db: Session, task: Task, label_ids: list[UUID]) -> None:
    wanted = set(label_ids)
    allowed = set(db.scalars(select(Label.id).where(Label.project_id == task.project_id)))
    if not wanted <= allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La etiqueta no pertenece a este proyecto")
    current = set(db.scalars(select(TaskLabel.label_id).where(TaskLabel.task_id == task.id)))
    for lid in current - wanted:
        db.delete(db.get(TaskLabel, (task.id, lid)))
    for lid in wanted - current:
        db.add(TaskLabel(task_id=task.id, label_id=lid))


def _check_pbi(db: Session, project_id: UUID, backlog_item_id: UUID | None) -> None:
    if backlog_item_id is None:
        return
    pbi = db.get(BacklogItem, backlog_item_id)
    if pbi is None or pbi.project_id != project_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El PBI no pertenece a este proyecto")


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
    by_column: dict[UUID, list[TaskOut]] = {c.id: [] for c in columns}
    for out in _task_outs(db, tasks):
        by_column.setdefault(out.column_id, []).append(out)

    members = db.execute(
        select(Profile).join(ProjectMember, ProjectMember.user_id == Profile.id)
        .where(ProjectMember.project_id == project_id).order_by(Profile.full_name)
    ).scalars()
    return BoardOut(
        project_id=project.id, project_name=project.name, project_key=project.key, project_color=project.color,
        can_edit=can_edit(db, project, user.id),
        can_manage_columns=can_manage(db, project, user.id),
        columns=[
            ColumnOut(id=c.id, name=c.name, position=c.position, wip_limit=c.wip_limit, is_done=c.is_done,
                      tasks=by_column[c.id])
            for c in columns
        ],
        members=[BoardMember(id=m.id, name=m.full_name or m.email, avatar_url=m.avatar_url) for m in members],
        labels=[LabelOut(id=lb.id, name=lb.name, color=lb.color) for lb in _labels(db, project_id)],
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
    _check_pbi(db, project_id, payload.backlog_item_id)

    last = db.scalar(select(func.max(Task.position)).where(Task.column_id == column.id, Task.archived_at.is_(None)))
    task = Task(
        project_id=project_id, column_id=column.id, title=payload.title.strip(), description=payload.description,
        priority=payload.priority, due_date=payload.due_date, position=(last or 0) + 1, created_by=user.id,
        backlog_item_id=payload.backlog_item_id,
    )
    if payload.backlog_item_id:
        # La tarea nace dentro del Sprint donde está su PBI (si hay uno abierto)
        task.sprint_id = db.scalar(
            select(Sprint.id).join(SprintItem, SprintItem.sprint_id == Sprint.id)
            .where(SprintItem.backlog_item_id == payload.backlog_item_id, Sprint.status.in_(("planned", "active")))
        )
    db.add(task)
    db.flush()
    _set_assignees(db, task, payload.assignee_ids)
    _set_labels(db, task, payload.label_ids)
    db.commit()
    db.refresh(task)
    return _task_out(db, task)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(task_id: UUID, payload: TaskUpdate, user: CurrentUser, db: UserDB) -> TaskOut:
    task = _editable_task(db, task_id, user.id)
    changes = payload.model_dump(exclude_unset=True, exclude={"assignee_ids", "label_ids"})
    if "backlog_item_id" in changes:
        _check_pbi(db, task.project_id, changes["backlog_item_id"])
    if "title" in changes and changes["title"] is not None:
        changes["title"] = changes["title"].strip()
    if changes.get("is_blocked") is False:
        changes["blocked_reason"] = None
    for field, value in changes.items():
        setattr(task, field, value)
    if payload.assignee_ids is not None:
        _set_assignees(db, task, payload.assignee_ids)
    if payload.label_ids is not None:
        _set_labels(db, task, payload.label_ids)
    db.commit()
    db.refresh(task)
    return _task_out(db, task)


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
    return _task_out(db, task)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_task(task_id: UUID, user: CurrentUser, db: UserDB) -> None:
    task = _editable_task(db, task_id, user.id)
    task.archived_at = datetime.now(timezone.utc)
    db.commit()


# ------------------------------------------------------------------ columnas
def _renumber(db: Session, columns: list[BoardColumn]) -> None:
    """Deja las posiciones 1..n en el orden recibido (la restricción única es diferida)."""
    for i, column in enumerate(columns, start=1):
        column.position = i


def _column_out(db: Session, column: BoardColumn) -> ColumnOut:
    tasks = list(db.scalars(
        select(Task).where(Task.column_id == column.id, Task.archived_at.is_(None)).order_by(Task.position)
    ))
    return ColumnOut(
        id=column.id, name=column.name, position=column.position, wip_limit=column.wip_limit,
        is_done=column.is_done, tasks=_task_outs(db, tasks),
    )


def _managed_column(db: Session, column_id: UUID, user_id: UUID) -> BoardColumn:
    column = db.get(BoardColumn, column_id)
    if column is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Columna no encontrada")
    require_project_manager(db, column.project_id, user_id)
    return column


@router.post("/projects/{project_id}/columns", response_model=ColumnOut, status_code=status.HTTP_201_CREATED)
def create_column(project_id: UUID, payload: ColumnCreate, user: CurrentUser, db: UserDB) -> ColumnOut:
    """Agrega una columna al final del tablero (Product Owner, Scrum Master o administrador)."""
    require_project_manager(db, project_id, user.id)
    columns = _columns(db, project_id)
    if any(c.name.lower() == payload.name.strip().lower() for c in columns):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Ya existe una columna llamada «{payload.name.strip()}»")
    board_id = columns[0].board_id if columns else db.scalar(
        select(BoardColumn.board_id).where(BoardColumn.project_id == project_id).limit(1)
    )
    if board_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El proyecto no tiene tablero")
    column = BoardColumn(
        board_id=board_id, project_id=project_id, name=payload.name.strip(), position=len(columns) + 1,
        wip_limit=payload.wip_limit, is_done=payload.is_done,
    )
    db.add(column)
    db.commit()
    db.refresh(column)
    return _column_out(db, column)


@router.patch("/columns/{column_id}", response_model=ColumnOut)
def update_column(column_id: UUID, payload: ColumnUpdate, user: CurrentUser, db: UserDB) -> ColumnOut:
    column = _managed_column(db, column_id, user.id)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("name"):
        name = changes["name"].strip()
        clash = db.scalar(select(BoardColumn.id).where(
            BoardColumn.project_id == column.project_id, func.lower(BoardColumn.name) == name.lower(),
            BoardColumn.id != column.id,
        ))
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Ya existe una columna llamada «{name}»")
        column.name = name
    if "wip_limit" in changes:
        column.wip_limit = changes["wip_limit"]
    if changes.get("is_done") is not None and changes["is_done"] != column.is_done:
        column.is_done = changes["is_done"]
        # El trigger solo actúa al cambiar de columna: actualizar las tareas que ya están aquí
        db.execute(
            update(Task).where(Task.column_id == column.id)
            .values(completed_at=func.coalesce(Task.completed_at, func.now()) if column.is_done else None)
        )
    db.commit()
    db.refresh(column)
    return _column_out(db, column)


@router.post("/columns/{column_id}/move", response_model=list[ColumnOut])
def move_column(column_id: UUID, payload: ColumnMove, user: CurrentUser, db: UserDB) -> list[ColumnOut]:
    column = _managed_column(db, column_id, user.id)
    columns = [c for c in _columns(db, column.project_id) if c.id != column.id]
    columns.insert(min(payload.index, len(columns)), column)
    _renumber(db, columns)
    db.commit()
    return [_column_out(db, c) for c in columns]


@router.delete("/columns/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_column(
    column_id: UUID, user: CurrentUser, db: UserDB, move_to: UUID | None = None,
) -> None:
    """Elimina la columna. Si tiene tareas, se mueven a `move_to` (no se pierde ninguna)."""
    column = _managed_column(db, column_id, user.id)
    columns = _columns(db, column.project_id)
    if len(columns) == 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El tablero debe tener al menos una columna")

    active = db.scalar(select(func.count()).select_from(Task).where(
        Task.column_id == column.id, Task.archived_at.is_(None)
    ))
    target = db.get(BoardColumn, move_to) if move_to else None
    if move_to and (target is None or target.project_id != column.project_id or target.id == column.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La columna de destino no es válida")
    if active and target is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"La columna tiene {active} tareas: elige a qué columna moverlas"
        )
    if target and target.wip_limit is not None:
        current = db.scalar(select(func.count()).select_from(Task).where(
            Task.column_id == target.id, Task.archived_at.is_(None)
        ))
        if current + active > target.wip_limit:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"«{target.name}» superaría su límite WIP de {target.wip_limit} tareas",
            )

    # Las tareas archivadas también apuntan a la columna: se mueven para conservar la trazabilidad
    destination = target or next(c for c in columns if c.id != column.id)
    last = db.scalar(select(func.max(Task.position)).where(Task.column_id == destination.id)) or 0
    for i, task in enumerate(db.scalars(select(Task).where(Task.column_id == column.id).order_by(Task.position)), 1):
        task.column_id = destination.id  # el trigger ajusta completed_at según la columna destino
        task.position = last + i
    db.flush()
    db.delete(column)
    db.flush()
    _renumber(db, [c for c in columns if c.id != column.id])
    db.commit()


# ------------------------------------------------------------------ etiquetas
@router.post("/projects/{project_id}/labels", response_model=LabelOut, status_code=status.HTTP_201_CREATED)
def create_label(project_id: UUID, payload: LabelCreate, user: CurrentUser, db: UserDB) -> Label:
    project_access(db, project_id, user.id, write=True)
    name = payload.name.strip()
    if any(lb.name.lower() == name.lower() for lb in _labels(db, project_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Ya existe la etiqueta «{name}»")
    label = Label(project_id=project_id, name=name, color=payload.color)
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


@router.delete("/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_label(label_id: UUID, user: CurrentUser, db: UserDB) -> None:
    """Elimina la etiqueta de todas las tarjetas (Product Owner, Scrum Master o administrador)."""
    label = db.get(Label, label_id)
    if label is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Etiqueta no encontrada")
    require_project_manager(db, label.project_id, user.id)
    db.delete(label)
    db.commit()


# ------------------------------------------------------------------ checklist
def _checklist(db: Session, task_id: UUID) -> list[ChecklistItem]:
    return list(db.scalars(
        select(ChecklistItem).where(ChecklistItem.task_id == task_id)
        .order_by(ChecklistItem.position, ChecklistItem.created_at)
    ))


def _editable_item(db: Session, item_id: UUID, user_id: UUID) -> ChecklistItem:
    item = db.get(ChecklistItem, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Elemento no encontrado")
    _editable_task(db, item.task_id, user_id)
    return item


@router.get("/tasks/{task_id}/checklist", response_model=list[ChecklistItemOut])
def get_checklist(task_id: UUID, user: CurrentUser, db: UserDB) -> list[ChecklistItem]:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tarea no encontrada")
    project_access(db, task.project_id, user.id)
    return _checklist(db, task_id)


@router.post("/tasks/{task_id}/checklist", response_model=ChecklistItemOut, status_code=status.HTTP_201_CREATED)
def add_checklist_item(task_id: UUID, payload: ChecklistItemCreate, user: CurrentUser, db: UserDB) -> ChecklistItem:
    _editable_task(db, task_id, user.id)
    last = db.scalar(select(func.max(ChecklistItem.position)).where(ChecklistItem.task_id == task_id))
    item = ChecklistItem(task_id=task_id, content=payload.content.strip(), position=(last or 0) + 1)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/checklist/{item_id}", response_model=ChecklistItemOut)
def update_checklist_item(item_id: UUID, payload: ChecklistItemUpdate, user: CurrentUser, db: UserDB) -> ChecklistItem:
    item = _editable_item(db, item_id, user.id)
    if payload.content is not None:
        item.content = payload.content.strip()
    if payload.is_done is not None:
        item.is_done = payload.is_done
    db.commit()
    db.refresh(item)
    return item


@router.delete("/checklist/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_checklist_item(item_id: UUID, user: CurrentUser, db: UserDB) -> None:
    db.delete(_editable_item(db, item_id, user.id))
    db.commit()
