"""Datos de los informes: resumen y detalle de cada Sprint y totales del proyecto.

La participación se muestra como trazabilidad de contribuciones (orden alfabético),
no como ranking de productividad (sección 7.9 de la especificación).
"""

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    BacklogItem,
    BoardColumn,
    Profile,
    Project,
    ProjectMember,
    RetroAction,
    ScrumEvent,
    Sprint,
    SprintItem,
    Task,
    TaskAssignee,
)
from app.schemas.report import (
    BurndownDay,
    Contribution,
    ProjectTotals,
    ReportAction,
    ReportPbi,
    ReportTask,
    SprintReport,
    SprintReportDetail,
)
from app.services.dashboard import ROLE_ES, SPRINT_STATUS_ES, TZ
from app.services.scrum import task_progress

OPEN_ACTION = ("pending", "in_progress")


def _local_day(moment: datetime | None) -> date | None:
    return moment.astimezone(TZ).date() if moment else None


def _today() -> date:
    return datetime.now(TZ).date()


def _sprint_tasks(db: Session, sprint_id: UUID) -> list[Task]:
    return list(db.scalars(
        select(Task).where(Task.sprint_id == sprint_id, Task.archived_at.is_(None)).order_by(Task.position)
    ))


def _burndown(sprint: Sprint, tasks: list[Task]) -> list[BurndownDay]:
    """Tareas pendientes al cierre de cada día; las agregadas a mitad de Sprint suben la curva."""
    days = (sprint.end_date - sprint.start_date).days + 1
    last = _local_day(sprint.closed_at) or _today()
    created = [max(_local_day(t.created_at), sprint.start_date) for t in tasks]
    done = [_local_day(t.completed_at) for t in tasks]
    total = len(tasks)
    series = []
    for i in range(days):
        day = sprint.start_date + timedelta(days=i)
        ideal = round(total * (1 - i / (days - 1)), 2) if days > 1 else 0.0
        if day > last or sprint.status == "planned":
            series.append(BurndownDay(day=day, remaining=None, ideal=ideal))
            continue
        remaining = sum(1 for c, d in zip(created, done) if c <= day and (d is None or d > day))
        series.append(BurndownDay(day=day, remaining=remaining, ideal=ideal))
    return series


def _goal_status(sprint: Sprint, pbis_total: int, pbis_done: int) -> str:
    if sprint.status == "cancelled":
        return "cancelled"
    if sprint.status == "planned":
        return "planned"
    if sprint.status == "active":
        return "in_progress"
    goal_met = (sprint.summary or {}).get("goal_met")  # lo decide el equipo al cerrar el Sprint
    if goal_met is not None:
        return "achieved" if goal_met else ("partial" if pbis_done else "not_achieved")
    if pbis_total and pbis_done == pbis_total:
        return "achieved"
    return "partial" if pbis_done else "not_achieved"


def sprint_report(db: Session, sprint: Sprint) -> SprintReport:
    items = list(db.scalars(
        select(BacklogItem).join(SprintItem, SprintItem.backlog_item_id == BacklogItem.id)
        .where(SprintItem.sprint_id == sprint.id).order_by(BacklogItem.rank)
    ))
    progress = task_progress(db, [i.id for i in items], sprint.id)
    tasks = _sprint_tasks(db, sprint.id)
    is_open = sprint.status in ("planned", "active")

    pbis = []
    for i in items:
        total, done = progress.get(i.id, (0, 0))
        # Cerrado: lo decidió el cierre. En curso: terminado si todas sus tareas del Sprint lo están.
        finished = i.status == "done" if not is_open else (total > 0 and done == total)
        pbis.append(ReportPbi(
            code=i.code, title=i.title, type=i.type, estimate=float(i.estimate) if i.estimate is not None else None,
            status=i.status, finished=finished, task_count=total, tasks_done=done,
        ))

    points_total = sum(p.estimate or 0 for p in pbis)
    points_done = sum(p.estimate or 0 for p in pbis if p.finished)
    pbis_done = sum(1 for p in pbis if p.finished)
    if points_total:
        completion = round(100 * points_done / points_total)
    else:
        completion = round(100 * pbis_done / len(pbis)) if pbis else 0

    today = _today()
    days_total = (sprint.end_date - sprint.start_date).days + 1
    last = min(_local_day(sprint.closed_at) or today, sprint.end_date)
    days_elapsed = 0 if sprint.status == "planned" else max(0, min(days_total, (last - sprint.start_date).days + 1))
    events = Counter(db.scalars(select(ScrumEvent.type).where(ScrumEvent.sprint_id == sprint.id)))

    return SprintReport(
        id=sprint.id, number=sprint.number, goal=sprint.goal, start_date=sprint.start_date, end_date=sprint.end_date,
        status=sprint.status, close_reason=sprint.close_reason, closed_at=sprint.closed_at,
        days_total=days_total, days_elapsed=days_elapsed, pbis_total=len(pbis), pbis_done=pbis_done,
        points_total=points_total, points_done=points_done,
        task_count=len(tasks), tasks_done=sum(1 for t in tasks if t.completed_at),
        tasks_blocked=sum(1 for t in tasks if t.is_blocked and not t.completed_at),
        tasks_overdue=sum(1 for t in tasks if not t.completed_at and t.due_date and t.due_date < today),
        completion=completion, goal_status=_goal_status(sprint, len(pbis), pbis_done),
        events=dict(events), burndown=_burndown(sprint, tasks), pbis=pbis,
    )


def _names(db: Session, ids: set[UUID]) -> dict[UUID, str]:
    if not ids:
        return {}
    return {p.id: p.full_name or p.email for p in db.scalars(select(Profile).where(Profile.id.in_(ids)))}


def sprint_report_detail(db: Session, sprint: Sprint) -> SprintReportDetail:
    base = sprint_report(db, sprint)
    tasks = _sprint_tasks(db, sprint.id)
    task_ids = [t.id for t in tasks]

    assignees: dict[UUID, list[UUID]] = defaultdict(list)
    if task_ids:
        for row in db.execute(select(TaskAssignee.task_id, TaskAssignee.user_id).where(TaskAssignee.task_id.in_(task_ids))):
            assignees[row.task_id].append(row.user_id)
    columns = dict(db.execute(select(BoardColumn.id, BoardColumn.name).where(BoardColumn.project_id == sprint.project_id)).all())
    pbi_ids = {t.backlog_item_id for t in tasks if t.backlog_item_id}
    codes = dict(db.execute(select(BacklogItem.id, BacklogItem.code).where(BacklogItem.id.in_(pbi_ids))).all()) if pbi_ids else {}

    events = list(db.scalars(select(ScrumEvent).where(ScrumEvent.sprint_id == sprint.id).order_by(ScrumEvent.held_at)))
    latest = {e.type: e for e in events}  # el último de cada tipo
    review, retro, planning = latest.get("sprint_review"), latest.get("sprint_retrospective"), latest.get("sprint_planning")
    blockers = [
        f"{e.held_at.astimezone(TZ):%d-%m}: {e.data['blockers']}"
        for e in events if e.type == "daily_scrum" and (e.data or {}).get("blockers")
    ]

    # Acciones de mejora de las retrospectivas de este Sprint
    retro_ids = [e.id for e in events if e.type == "sprint_retrospective"]
    actions = list(db.scalars(select(RetroAction).where(RetroAction.event_id.in_(retro_ids)).order_by(RetroAction.created_at))) if retro_ids else []

    members = list(db.execute(
        select(ProjectMember.user_id, ProjectMember.role).where(ProjectMember.project_id == sprint.project_id)
    ))
    names = _names(db, {uid for ids in assignees.values() for uid in ids} | {m.user_id for m in members}
                   | {a.owner_id for a in actions if a.owner_id})

    done_by: Counter[UUID] = Counter()
    open_by: Counter[UUID] = Counter()
    for t in tasks:
        for uid in assignees[t.id]:
            (done_by if t.completed_at else open_by)[uid] += 1
    contributions = sorted(
        (Contribution(name=names.get(m.user_id, "—"), role=ROLE_ES.get(m.role, m.role),
                      tasks_done=done_by[m.user_id], tasks_open=open_by[m.user_id])
         for m in members if m.role != "observer"),
        key=lambda c: c.name.lower(),
    )

    next_items = list(db.scalars(
        select(BacklogItem).where(
            BacklogItem.project_id == sprint.project_id, BacklogItem.archived_at.is_(None),
            BacklogItem.status.in_(("new", "refined", "ready")),
        ).order_by(BacklogItem.rank).limit(8)
    ))
    following = db.scalar(select(Sprint).where(
        Sprint.project_id == sprint.project_id, Sprint.number > sprint.number
    ).order_by(Sprint.number).limit(1))

    return SprintReportDetail(
        **base.model_dump(),
        planning_plan=(planning.data or {}).get("plan") if planning else None,
        review={k: str(v) for k, v in (review.data or {}).items()} if review else {},
        review_date=review.held_at if review else None,
        retro={k: str(v) for k, v in (retro.data or {}).items()} if retro else {},
        blockers=blockers,
        actions=[
            ReportAction(description=a.description, owner=names.get(a.owner_id), due_date=a.due_date,
                         status=a.status, sprint_number=sprint.number)
            for a in actions
        ],
        tasks=[
            ReportTask(
                title=t.title, pbi_code=codes.get(t.backlog_item_id), column=columns.get(t.column_id, "—"),
                assignees=sorted(names.get(uid, "—") for uid in assignees[t.id]), completed_at=t.completed_at,
                is_blocked=t.is_blocked, blocked_reason=t.blocked_reason, due_date=t.due_date,
            )
            for t in tasks
        ],
        contributions=contributions,
        next_items=[
            ReportPbi(code=i.code, title=i.title, type=i.type, status=i.status, finished=False, task_count=0,
                      tasks_done=0, estimate=float(i.estimate) if i.estimate is not None else None)
            for i in next_items
        ],
        next_sprint=following and (
            f"Sprint {following.number} ({SPRINT_STATUS_ES[following.status].lower()}, "
            f"{following.start_date:%d-%m} al {following.end_date:%d-%m-%Y}): {following.goal}"
        ),
    )


def project_sprints(db: Session, project_id: UUID) -> list[Sprint]:
    return list(db.scalars(select(Sprint).where(Sprint.project_id == project_id).order_by(Sprint.number.desc())))


def project_totals(db: Session, project_id: UUID, reports: list[SprintReport]) -> ProjectTotals:
    closed = [r for r in reports if r.status == "closed"]
    recent = closed[:3]  # la velocidad es una referencia del equipo: promedio de los últimos 3 Sprints cerrados
    by_status = dict(db.execute(
        select(BacklogItem.status, func.count()).where(
            BacklogItem.project_id == project_id, BacklogItem.archived_at.is_(None)
        ).group_by(BacklogItem.status)
    ).all())
    remaining = db.scalar(select(func.coalesce(func.sum(BacklogItem.estimate), 0)).where(
        BacklogItem.project_id == project_id, BacklogItem.archived_at.is_(None),
        BacklogItem.status.in_(("new", "refined", "ready", "in_sprint")),
    ))
    open_actions = db.scalar(select(func.count()).select_from(RetroAction).where(
        RetroAction.project_id == project_id, RetroAction.status.in_(OPEN_ACTION)
    ))
    return ProjectTotals(
        sprints_closed=len(closed),
        velocity=round(sum(r.points_done for r in recent) / len(recent), 1) if recent else None,
        pbis_total=sum(n for s, n in by_status.items() if s != "discarded"),
        pbis_done=by_status.get("done", 0), points_remaining=float(remaining or 0),
        open_actions=open_actions or 0, backlog_by_status=by_status,
    )


def project_actions(db: Session, project_id: UUID) -> list[ReportAction]:
    rows = db.execute(
        select(RetroAction, Sprint.number)
        .join(ScrumEvent, ScrumEvent.id == RetroAction.event_id)
        .join(Sprint, Sprint.id == ScrumEvent.sprint_id)
        .where(RetroAction.project_id == project_id)
        .order_by(Sprint.number.desc(), RetroAction.created_at)
    ).all()
    names = _names(db, {a.owner_id for a, _ in rows if a.owner_id})
    return [
        ReportAction(description=a.description, owner=names.get(a.owner_id), due_date=a.due_date, status=a.status,
                     sprint_number=number)
        for a, number in rows
    ]


def project_team(db: Session, project: Project) -> list[tuple[str, str]]:
    rows = db.execute(
        select(Profile, ProjectMember.role).join(ProjectMember, ProjectMember.user_id == Profile.id)
        .where(ProjectMember.project_id == project.id)
    )
    return sorted(((p.full_name or p.email, ROLE_ES.get(r, r)) for p, r in rows), key=lambda t: t[0].lower())
