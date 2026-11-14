"""Arma los datos del dashboard global (Inicio) a partir de la base de datos."""

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.schemas.dashboard import (
    ActivityItem,
    Burndown,
    BurndownPoint,
    CurrentSprint,
    DashboardOut,
    DashboardStats,
    MemberMini,
    ProjectSummary,
    Stat,
)
from app.services.permissions import accessible_project_ids

TZ = ZoneInfo(settings.app_timezone)
TREND_DAYS = 7

SPRINT_STATUS_ES = {"planned": "Planificado", "active": "En curso", "closed": "Cerrado", "cancelled": "Cancelado"}
EVENT_ES = {
    "sprint_planning": "la Sprint Planning",
    "daily_scrum": "la Daily Scrum",
    "sprint_review": "la Sprint Review",
    "sprint_retrospective": "la Retrospectiva",
}
PBI_STATUS_ES = {"new": "Nuevo", "refined": "Refinado", "ready": "Listo", "in_sprint": "En Sprint",
                 "done": "Terminado", "discarded": "Descartado", "pending": "Pendiente",
                 "in_progress": "En progreso", "dropped": "Descartada"}
RELEVANT_ENTITIES = (
    "tasks", "comments", "sprints", "task_labels", "task_assignees", "backlog_items",
    "projects", "project_members", "scrum_events", "retro_actions",
)


# ---------------------------------------------------------------- utilidades
def _local_date(value: datetime | date) -> date:
    return value.astimezone(TZ).date() if isinstance(value, datetime) else value


def _cumulative(dates: list[date], days: list[date]) -> list[int]:
    return [sum(1 for d in dates if d <= day) for day in days]


def working_days(start: date, end: date) -> list[date]:
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    weekdays = [d for d in days if d.weekday() < 5]
    return weekdays or days


def _percent(done: int, total: int) -> int:
    return round(done * 100 / total) if total else 0


def _rows(db: Session, sql: str, **params: Any) -> list[dict[str, Any]]:
    return [dict(r) for r in db.execute(text(sql), params).mappings()]


# ---------------------------------------------------------------- principal
def build_dashboard(db: Session, user_id: UUID) -> DashboardOut:
    today = datetime.now(TZ).date()
    days = [today - timedelta(days=i) for i in range(TREND_DAYS - 1, -1, -1)]
    week_ago = today - timedelta(days=7)
    two_weeks_ago = today - timedelta(days=14)

    ids = accessible_project_ids(db, user_id)
    unread = db.execute(
        text("select count(*) from notifications where user_id = :uid and read_at is null"), {"uid": user_id}
    ).scalar_one()

    if not ids:
        zero = Stat(value=0, delta=0, trend=[0] * TREND_DAYS)
        return DashboardOut(
            stats=DashboardStats(active_projects=zero, sprints_in_progress=zero, completed_tasks=zero, team_members=zero),
            projects=[], current_sprint=None, activity=[], burndown=None, unread_notifications=unread,
        )

    projects = _rows(db, """
        select id, name, color, status, created_at, updated_at from projects
        where id = any(:ids) order by (status = 'active') desc, updated_at desc""", ids=ids)
    sprints = _rows(db, """
        select s.id, s.project_id, s.number, s.goal, s.start_date, s.end_date, s.status, p.name as project_name
        from sprints s join projects p on p.id = s.project_id
        where s.project_id = any(:ids) and s.status = 'active' order by s.start_date desc""", ids=ids)
    task_counts = _rows(db, """
        select project_id, sprint_id, count(*) as total, count(completed_at) as done from tasks
        where project_id = any(:ids) and archived_at is null group by project_id, sprint_id""", ids=ids)
    completed = _rows(db, """
        select completed_at from tasks
        where project_id = any(:ids) and completed_at is not null and archived_at is null""", ids=ids)
    members = _rows(db, """
        select pm.project_id, pm.added_at, pr.id, pr.full_name, pr.avatar_url
        from project_members pm join profiles pr on pr.id = pm.user_id
        where pm.project_id = any(:ids) order by pm.added_at""", ids=ids)
    my_projects = {
        r["project_id"] for r in _rows(db, "select project_id from project_members where user_id = :uid", uid=user_id)
    }

    # ---------- tarjetas de estadísticas
    active_projects = [p for p in projects if p["status"] == "active"]
    active_dates = [_local_date(p["created_at"]) for p in active_projects]
    sprint_dates = [s["start_date"] for s in sprints]
    done_dates = [_local_date(r["completed_at"]) for r in completed]
    first_join: dict[UUID, date] = {}
    for m in members:
        first_join.setdefault(m["id"], _local_date(m["added_at"]))

    this_week = sum(1 for d in done_dates if d > week_ago)
    prev_week = sum(1 for d in done_dates if two_weeks_ago < d <= week_ago)
    done_delta = round((this_week - prev_week) * 100 / prev_week) if prev_week else (100 if this_week else 0)

    stats = DashboardStats(
        active_projects=Stat(value=len(active_projects), delta=sum(d > week_ago for d in active_dates),
                             trend=_cumulative(active_dates, days)),
        sprints_in_progress=Stat(value=len(sprints), delta=sum(d > week_ago for d in sprint_dates),
                                 trend=_cumulative(sprint_dates, days)),
        completed_tasks=Stat(value=len(done_dates), delta=done_delta, delta_kind="percent",
                             trend=_cumulative(done_dates, days)),
        team_members=Stat(value=len(first_join), delta=sum(d > week_ago for d in first_join.values()),
                          trend=_cumulative(list(first_join.values()), days)),
    )

    # ---------- tarjetas de proyectos
    sprint_by_project = {s["project_id"]: s for s in sprints}
    counts: dict[tuple[UUID, UUID | None], tuple[int, int]] = {
        (r["project_id"], r["sprint_id"]): (r["total"], r["done"]) for r in task_counts
    }
    project_totals: dict[UUID, list[int]] = defaultdict(lambda: [0, 0])
    for (pid, _), (total, done) in counts.items():
        project_totals[pid][0] += total
        project_totals[pid][1] += done
    members_by_project: dict[UUID, list[dict[str, Any]]] = defaultdict(list)
    for m in members:
        members_by_project[m["project_id"]].append(m)

    summaries: list[ProjectSummary] = []
    for p in projects[:6]:
        sprint = sprint_by_project.get(p["id"])
        if sprint:
            total, done = counts.get((p["id"], sprint["id"]), (0, 0))
        else:
            total, done = project_totals[p["id"]]
        team = members_by_project[p["id"]]
        summaries.append(ProjectSummary(
            id=p["id"], name=p["name"], color=p["color"], status=p["status"],
            sprint_number=sprint["number"] if sprint else None,
            sprint_days=len(working_days(sprint["start_date"], sprint["end_date"])) if sprint else None,
            progress=_percent(done, total),
            members=[MemberMini(id=m["id"], name=m["full_name"], avatar_url=m["avatar_url"]) for m in team[:3]],
            extra_members=max(len(team) - 3, 0),
        ))

    # ---------- Sprint actual + burndown
    current = next((s for s in sprints if s["project_id"] in my_projects), sprints[0] if sprints else None)
    current_sprint = burndown = None
    if current:
        total, done = counts.get((current["project_id"], current["id"]), (0, 0))
        wd = working_days(current["start_date"], current["end_date"])
        current_sprint = CurrentSprint(
            id=current["id"], project_id=current["project_id"], project_name=current["project_name"],
            number=current["number"], start_date=current["start_date"], end_date=current["end_date"],
            working_days=len(wd), goal=current["goal"], progress=_percent(done, total), status=current["status"],
        )
        burndown = _burndown(db, current, wd, today)

    return DashboardOut(
        stats=stats,
        projects=summaries,
        current_sprint=current_sprint,
        activity=_recent_activity(db, ids),
        burndown=burndown,
        unread_notifications=unread,
    )


def _burndown(db: Session, sprint: dict[str, Any], wd: list[date], today: date) -> Burndown:
    rows = _rows(db, "select completed_at from tasks where sprint_id = :sid and archived_at is null", sid=sprint["id"])
    total = len(rows)
    done_dates = [_local_date(r["completed_at"]) for r in rows if r["completed_at"]]
    steps = max(len(wd) - 1, 1)
    points = [
        BurndownPoint(
            label=f"Día {i + 1}",
            ideal=round(total - total * i / steps, 2),
            real=(total - sum(1 for d in done_dates if d <= day)) if day <= today else None,
        )
        for i, day in enumerate(wd)
    ]
    return Burndown(sprint_id=sprint["id"], sprint_label=f"Sprint #{sprint['number']}", points=points)


# ---------------------------------------------------------------- actividad
def _recent_activity(db: Session, ids: list[UUID], limit: int = 8) -> list[ActivityItem]:
    rows = _rows(db, """
        select a.id, a.action, a.entity_type, a.entity_id, a.changes, a.created_at,
               coalesce(nullif(pr.full_name, ''), 'Sistema') as actor_name
        from activity_log a left join profiles pr on pr.id = a.actor_id
        where a.project_id = any(:ids) and a.entity_type = any(:entities)
        order by a.id desc limit :limit""", ids=ids, entities=list(RELEVANT_ENTITIES), limit=limit)

    return describe_activity(db, rows)


def describe_activity(db: Session, rows: list[dict[str, Any]]) -> list[ActivityItem]:
    """Convierte filas de `activity_log` (con actor_name) en frases legibles."""
    refs = collect_refs(db, rows)
    return [_describe(r, refs) for r in rows]


def _uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value)) if value else None
    except ValueError:
        return None


def _new(ch: dict[str, Any], key: str) -> Any:
    """Valor nuevo de un campo: en una edición viene como {old, new}; al crear, directo."""
    value = ch.get(key)
    return value.get("new") if isinstance(value, dict) and "new" in value else value


def collect_refs(db: Session, rows: list[dict[str, Any]]) -> dict[str, dict[UUID, str]]:
    """Busca de una vez los nombres de tareas, columnas, etiquetas, personas y sprints mencionados."""
    ids: dict[str, set[UUID]] = defaultdict(set)
    for r in rows:
        ch = r["changes"] or {}
        if r["entity_type"] in ("tasks", "task_assignees", "task_labels", "checklist_items") and r["entity_id"]:
            ids["tasks"].add(r["entity_id"])
        if r["entity_type"] == "board_columns" and r["entity_id"]:
            ids["columns"].add(r["entity_id"])
        for key, bucket in (("column_id", "columns"), ("label_id", "labels"), ("user_id", "people"),
                            ("owner_id", "people"), ("sprint_id", "sprints"), ("task_id", "tasks")):
            raw = ch.get(key)
            for value in (raw.get("old"), raw.get("new")) if isinstance(raw, dict) else (raw,):
                if (uid := _uuid(value)) is not None:
                    ids[bucket].add(uid)
    return {
        "tasks": _lookup(db, "tasks", "title", ids["tasks"]),
        "columns": _lookup(db, "board_columns", "name", ids["columns"]),
        "labels": _lookup(db, "labels", "name", ids["labels"]),
        "people": _lookup(db, "profiles", "coalesce(nullif(full_name, ''), email)", ids["people"]),
        "sprints": _lookup(db, "sprints", "'Sprint #' || number", ids["sprints"]),
    }


def _lookup(db: Session, table: str, column: str, ids: set[UUID]) -> dict[UUID, str]:
    if not ids:
        return {}
    result = db.execute(text(f"select id, {column} as v from {table} where id = any(:ids)"), {"ids": list(ids)})
    return {row.id: row.v for row in result}


ROLE_ES = {"product_owner": "Product Owner", "scrum_master": "Scrum Master", "developer": "Developer",
           "observer": "Observador", "owner": "Propietario", "admin": "Administrador", "member": "Miembro"}
INVITATION_ES = {"pending": "pendiente", "accepted": "aceptada", "declined": "rechazada", "revoked": "revocada",
                 "expired": "vencida"}


def _describe(r: dict[str, Any], refs: dict[str, dict[UUID, str]]) -> ActivityItem:
    ch: dict[str, Any] = r["changes"] or {}
    entity, action = r["entity_type"], r["action"]
    entity_id = r["entity_id"]
    title = refs["tasks"].get(entity_id) or _new(ch, "title") or "una tarjeta"
    person = refs["people"].get(_uuid(_new(ch, "user_id"))) or "un integrante"
    highlight, kind = None, "other"

    if entity == "tasks" and action == "moved":
        message, kind = f"movió la tarjeta “{title}” a", "move"
        highlight = refs["columns"].get(_uuid(_new(ch, "column_id")))
    elif entity == "tasks" and action == "created":
        message, kind = f"creó la tarjeta “{title}”", "create"
    elif entity == "tasks" and action in ("archived", "restored"):
        verb = "archivó" if action == "archived" else "restauró"
        message, kind = f"{verb} la tarjeta “{title}”", "update"
    elif entity == "tasks" and action == "deleted":
        message, kind = f"eliminó la tarjeta “{title}”", "update"
    elif entity == "tasks":
        message, kind = f"actualizó la tarjeta “{title}”", "update"
    elif entity == "board_columns":
        name = _new(ch, "name") or refs["columns"].get(entity_id) or "una columna"
        verb = {"created": "creó", "deleted": "eliminó"}.get(action, "modificó")
        message, kind = f"{verb} la columna “{name}”", "create" if action == "created" else "update"
    elif entity == "comments":
        body = (_new(ch, "body") or "")[:60]
        message, kind = f"comentó: “{body}”", "comment"
    elif entity == "sprints" and action == "created":
        message, kind = f"creó el Sprint #{ch.get('number', '')}", "create"
    elif entity == "sprints" and action == "status_changed":
        message, kind = "cambió el estado del Sprint a", "update"
        highlight = SPRINT_STATUS_ES.get(_new(ch, "status"), _new(ch, "status"))
    elif entity == "sprints":
        message, kind = "actualizó el Sprint", "update"
    elif entity == "task_labels" and action == "deleted":
        message, kind = "quitó la etiqueta", "label"
        highlight = refs["labels"].get(_uuid(ch.get("label_id")))
    elif entity == "task_labels":
        message, kind = "añadió la etiqueta", "label"
        highlight = refs["labels"].get(_uuid(ch.get("label_id")))
    elif entity == "task_assignees" and action == "deleted":
        message, kind = f"quitó a {person} de “{title}”", "update"
    elif entity == "task_assignees":
        message, kind = f"asignó a {person} en “{title}”", "update"
    elif entity == "checklist_items":
        message, kind = f"actualizó el checklist de “{title}”", "update"
    elif entity == "backlog_items" and action == "created":
        message, kind = f"creó el PBI {ch.get('code', '')} “{ch.get('title', '')}”", "create"
    elif entity == "backlog_items" and action in ("archived", "restored"):
        verb = "archivó" if action == "archived" else "restauró"
        message, kind = f"{verb} un elemento del Product Backlog", "update"
    elif entity == "backlog_items" and action == "status_changed":
        message, kind = "cambió el estado de un PBI a", "update"
        highlight = PBI_STATUS_ES.get(_new(ch, "status"), _new(ch, "status"))
    elif entity == "backlog_items":
        message, kind = "actualizó un elemento del Product Backlog", "update"
    elif entity == "sprint_items":
        message, kind = "seleccionó un PBI para el", "create"
        highlight = refs["sprints"].get(_uuid(ch.get("sprint_id")))
    elif entity == "projects" and action == "created":
        message, kind = f"creó el proyecto “{ch.get('name', '')}”", "create"
    elif entity == "projects":
        message, kind = "actualizó los datos del proyecto", "update"
    elif entity == "project_members" and action == "created":
        message, kind = f"agregó a {person} al proyecto como", "create"
        highlight = ROLE_ES.get(ch.get("role"), ch.get("role"))
    elif entity == "project_members" and action == "deleted":
        message, kind = f"quitó a {person} del proyecto", "update"
    elif entity == "project_members":
        message, kind = "cambió el rol de un integrante a", "update"
        highlight = ROLE_ES.get(_new(ch, "role"), _new(ch, "role"))
    elif entity == "invitations" and action == "created":
        message, kind = f"invitó a {ch.get('email', 'una persona')}", "create"
    elif entity == "invitations":
        message, kind = "actualizó una invitación:", "update"
        highlight = INVITATION_ES.get(_new(ch, "status"), _new(ch, "status"))
    elif entity == "scrum_events" and action != "created":
        message, kind = "actualizó el acta de un evento Scrum", "update"
    elif entity == "retro_actions" and action == "status_changed":
        message, kind = "cambió el estado de una acción de mejora a", "update"
        highlight = PBI_STATUS_ES.get(_new(ch, "status"), _new(ch, "status"))
    elif entity == "scrum_events":
        message, kind = f"registró {EVENT_ES.get(_new(ch, 'type') or '', 'un evento Scrum')}", "create"
    elif entity == "retro_actions":
        message, kind = "registró una acción de mejora", "create"
    else:
        verb = {"created": "creó", "deleted": "eliminó"}.get(action, "modificó")
        message = f"{verb} un registro ({entity})"

    return ActivityItem(id=r["id"], actor_name=r["actor_name"], message=message, highlight=highlight,
                        kind=kind, created_at=r["created_at"])
