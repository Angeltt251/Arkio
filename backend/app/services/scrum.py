"""Piezas compartidas por el Product Backlog, el Sprint Planning y los eventos Scrum."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import BacklogItem, Profile, Project, ProjectMember, Sprint, SprintItem, Task
from app.schemas.board import BoardMember
from app.schemas.scrum import PbiOut
from app.services.permissions import can_edit, can_manage


def header(db: Session, project: Project, user_id: UUID) -> dict:
    return {
        "project_id": project.id, "project_name": project.name, "project_key": project.key,
        "product_goal": project.product_goal, "can_edit": can_edit(db, project, user_id),
        "can_manage": can_manage(db, project, user_id),
    }


def project_members(db: Session, project_id: UUID, *, include_observers: bool = True) -> list[BoardMember]:
    query = (
        select(Profile).join(ProjectMember, ProjectMember.user_id == Profile.id)
        .where(ProjectMember.project_id == project_id).order_by(Profile.full_name)
    )
    if not include_observers:
        query = query.where(ProjectMember.role != "observer")
    return [BoardMember(id=p.id, name=p.full_name or p.email, avatar_url=p.avatar_url) for p in db.scalars(query)]


def task_progress(db: Session, pbi_ids: list[UUID], sprint_id: UUID | None = None) -> dict[UUID, tuple[int, int]]:
    """Tareas (total, terminadas) de cada PBI, opcionalmente solo las de un Sprint."""
    if not pbi_ids:
        return {}
    query = (
        select(Task.backlog_item_id, func.count(), func.count(Task.completed_at))
        .where(Task.backlog_item_id.in_(pbi_ids), Task.archived_at.is_(None))
        .group_by(Task.backlog_item_id)
    )
    if sprint_id:
        query = query.where(Task.sprint_id == sprint_id)
    return {row[0]: (row[1], row[2]) for row in db.execute(query)}


def pbi_outs(db: Session, items: list[BacklogItem]) -> list[PbiOut]:
    ids = [i.id for i in items]
    parent_ids = {i.parent_id for i in items if i.parent_id}
    parents = dict(db.execute(select(BacklogItem.id, BacklogItem.code).where(BacklogItem.id.in_(parent_ids))).all()) if parent_ids else {}
    sprints = dict(db.execute(
        select(SprintItem.backlog_item_id, func.max(Sprint.number))
        .join(Sprint, Sprint.id == SprintItem.sprint_id)
        .where(SprintItem.backlog_item_id.in_(ids)).group_by(SprintItem.backlog_item_id)
    ).all()) if ids else {}
    progress = task_progress(db, ids)
    return [
        PbiOut(
            id=i.id, code=i.code, type=i.type, title=i.title, description=i.description, story_as_a=i.story_as_a,
            story_i_want=i.story_i_want, story_so_that=i.story_so_that, acceptance_criteria=i.acceptance_criteria,
            priority=i.priority, estimate=float(i.estimate) if i.estimate is not None else None, status=i.status,
            parent_id=i.parent_id, parent_code=parents.get(i.parent_id), sprint_number=sprints.get(i.id),
            task_count=progress.get(i.id, (0, 0))[0], tasks_done=progress.get(i.id, (0, 0))[1],
            archived=i.archived_at is not None,
        )
        for i in items
    ]
