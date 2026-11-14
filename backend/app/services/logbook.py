"""Bitácora del proyecto: consulta con filtros y detalle legible de cada cambio (antes → después).

La tabla `activity_log` la escribe un trigger y es inmutable; aquí solo se lee.
"""

from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.logbook import LogChange, LogEntry
from app.services.dashboard import TZ, _uuid, collect_refs, describe_activity

# Categorías del filtro → tablas que agrupan
CATEGORIES: dict[str, tuple[str, ...]] = {
    "tareas": ("tasks", "task_assignees", "task_labels", "checklist_items"),
    "comentarios": ("comments",),
    "columnas": ("board_columns", "boards"),
    "equipo": ("project_members", "invitations"),
    "proyecto": ("projects",),
    "sprints": ("sprints", "sprint_items", "scrum_events", "retro_actions"),
    "backlog": ("backlog_items",),
}

ACTION_ES = {
    "created": "Creación", "updated": "Edición", "moved": "Movimiento", "status_changed": "Cambio de estado",
    "archived": "Archivado", "restored": "Restauración", "deleted": "Eliminación",
}
SOURCE_ES = {"app": "Aplicación", "api": "Aplicación", "sistema": "Sistema", "supabase_dashboard": "Panel de Supabase"}
ENTITY_ES = {
    "tasks": "Tarea", "task_assignees": "Responsable", "task_labels": "Etiqueta", "checklist_items": "Checklist",
    "comments": "Comentario", "board_columns": "Columna", "boards": "Tablero", "project_members": "Equipo",
    "invitations": "Invitación", "projects": "Proyecto", "sprints": "Sprint", "sprint_items": "Sprint",
    "scrum_events": "Evento Scrum", "retro_actions": "Acción de mejora", "backlog_items": "Product Backlog",
}

FIELD_ES = {
    "title": "Título", "description": "Descripción", "priority": "Prioridad", "severity": "Severidad",
    "column_id": "Columna", "due_date": "Fecha límite", "start_date": "Inicio", "end_date": "Término",
    "is_blocked": "Bloqueada", "blocked_reason": "Motivo del bloqueo", "archived_at": "Archivada",
    "completed_at": "Completada", "estimate": "Estimación", "name": "Nombre", "wip_limit": "Límite WIP",
    "is_done": "Columna de terminado", "role": "Rol", "status": "Estado", "user_id": "Persona", "email": "Correo",
    "sprint_id": "Sprint", "goal": "Sprint Goal", "product_goal": "Product Goal", "color": "Color", "key": "Clave",
    "body": "Comentario", "content": "Elemento", "close_reason": "Motivo de cierre",
    "workspace_role": "Rol en el espacio", "project_role": "Rol en el proyecto", "expires_at": "Vence",
    "owner_id": "Responsable", "number": "Número", "type": "Tipo", "notes": "Notas", "agreements": "Acuerdos",
    "code": "Código", "acceptance_criteria": "Criterios de aceptación", "label_id": "Etiqueta",
    "story_as_a": "Como", "story_i_want": "Quiero", "story_so_that": "Para", "held_at": "Fecha del evento",
    "duration_minutes": "Duración (min)",
}
# Campos técnicos que no aportan al lector de la bitácora
HIDDEN = {
    "id", "project_id", "workspace_id", "board_id", "task_id", "created_at", "created_by", "updated_at", "position",
    "rank", "seq", "token_hash", "invited_by", "responded_at", "backlog_item_id", "event_id", "author_id",
    "edited_at", "settings", "parent_id", "closed_at",
}
VALUE_ES = {
    "low": "Baja", "medium": "Media", "high": "Alta", "critical": "Crítica",
    "product_owner": "Product Owner", "scrum_master": "Scrum Master", "developer": "Developer",
    "observer": "Observador", "owner": "Propietario", "admin": "Administrador", "member": "Miembro",
    "planning": "Planificación", "active": "Activo", "paused": "En pausa", "closed": "Cerrado",
    "planned": "Planificado", "cancelled": "Cancelado", "pending": "Pendiente", "accepted": "Aceptada",
    "declined": "Rechazada", "revoked": "Revocado", "expired": "Vencida",
    "new": "Nuevo", "refined": "Refinado", "ready": "Listo", "in_sprint": "En Sprint", "done": "Terminado",
    "discarded": "Descartado", "in_progress": "En progreso", "dropped": "Descartada",
    "story": "Historia de usuario", "bug": "Defecto", "task": "Tarea técnica", "spike": "Investigación",
    "improvement": "Mejora", "sprint_planning": "Sprint Planning", "daily_scrum": "Daily Scrum",
    "sprint_review": "Sprint Review", "sprint_retrospective": "Retrospectiva",
}


def _format(field: str, value: Any, refs: dict[str, dict[UUID, str]]) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return "Sí" if value else "No"
    ref_bucket = {"column_id": "columns", "user_id": "people", "owner_id": "people", "sprint_id": "sprints",
                  "label_id": "labels"}.get(field)
    if ref_bucket:
        uid = _uuid(value)
        return refs[ref_bucket].get(uid, "(eliminado)") if uid else str(value)
    if field.endswith("_at") and isinstance(value, str):
        try:
            return datetime.fromisoformat(value).astimezone(TZ).strftime("%d-%m-%Y %H:%M")
        except ValueError:
            return value
    if field.endswith("_date") and isinstance(value, str):
        try:
            return date.fromisoformat(value).strftime("%d-%m-%Y")
        except ValueError:
            return value
    if isinstance(value, str):
        return VALUE_ES.get(value, value)
    if isinstance(value, (dict, list)):
        return None
    return str(value)


def changes_detail(row: dict[str, Any], refs: dict[str, dict[UUID, str]]) -> list[LogChange]:
    """Lista de campos con su valor anterior y nuevo, en lenguaje del usuario."""
    ch: dict[str, Any] = row["changes"] or {}
    action = row["action"]
    result: list[LogChange] = []
    for field, raw in ch.items():
        if field in HIDDEN or field not in FIELD_ES:
            continue
        if action in ("created", "deleted"):
            value = _format(field, raw, refs)
            if value is None or raw is False:  # al crear, "No" en un interruptor no aporta
                continue
            old, new = (value, None) if action == "deleted" else (None, value)
        elif isinstance(raw, dict) and ("old" in raw or "new" in raw):
            old, new = _format(field, raw.get("old"), refs), _format(field, raw.get("new"), refs)
            if old == new:
                continue
        else:
            continue
        result.append(LogChange(field=FIELD_ES[field], old=old, new=new))
    return result


def _local_start(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=TZ)


def query_logbook(
    db: Session,
    project_id: UUID,
    *,
    limit: int,
    before_id: int | None = None,
    actor_id: UUID | None = None,
    category: str | None = None,
    since: date | None = None,
    until: date | None = None,
    q: str | None = None,
) -> list[LogEntry]:
    where = ["a.project_id = :pid"]
    params: dict[str, Any] = {"pid": project_id, "limit": limit}
    if before_id:
        where.append("a.id < :before_id")
        params["before_id"] = before_id
    if actor_id:
        where.append("a.actor_id = :actor_id")
        params["actor_id"] = actor_id
    if category in CATEGORIES:
        where.append("a.entity_type = any(:entities)")
        params["entities"] = list(CATEGORIES[category])
    if since:
        where.append("a.created_at >= :since")
        params["since"] = _local_start(since)
    if until:
        where.append("a.created_at < :until")
        params["until"] = _local_start(until + timedelta(days=1))
    if q and q.strip():
        # También encuentra los movimientos/ediciones de una tarea o columna buscando por su nombre actual
        where.append("""(a.changes::text ilike :q or pr.full_name ilike :q
            or a.entity_id in (select id from tasks where project_id = :pid and title ilike :q)
            or a.entity_id in (select id from board_columns where project_id = :pid and name ilike :q))""")
        params["q"] = f"%{q.strip()}%"

    rows = [dict(r) for r in db.execute(text(f"""
        select a.id, a.actor_id, a.action, a.entity_type, a.entity_id, a.changes, a.source, a.created_at,
               coalesce(nullif(pr.full_name, ''), pr.email, 'Sistema') as actor_name
        from activity_log a left join profiles pr on pr.id = a.actor_id
        where {' and '.join(where)}
        order by a.id desc limit :limit"""), params).mappings()]

    refs = collect_refs(db, rows)
    described = describe_activity(db, rows)
    return [
        LogEntry(
            id=r["id"], actor_id=r["actor_id"], actor_name=item.actor_name, message=item.message,
            highlight=item.highlight, kind=item.kind, entity_type=r["entity_type"],
            entity_label=ENTITY_ES.get(r["entity_type"], r["entity_type"]), action=r["action"],
            action_label=ACTION_ES.get(r["action"], r["action"]), source=SOURCE_ES.get(r["source"], r["source"]),
            created_at=r["created_at"], changes=changes_detail(r, refs),
        )
        for r, item in zip(rows, described)
    ]


def logbook_actors(db: Session, project_id: UUID) -> list[dict[str, Any]]:
    """Personas que aparecen en la bitácora o integran el proyecto (para el filtro)."""
    return [dict(r) for r in db.execute(text("""
        select pr.id, coalesce(nullif(pr.full_name, ''), pr.email) as name
        from profiles pr
        where pr.id in (select actor_id from activity_log where project_id = :pid and actor_id is not null)
           or pr.id in (select user_id from project_members where project_id = :pid)
        order by 2"""), {"pid": project_id}).mappings()]
