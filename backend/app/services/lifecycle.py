"""Ciclo de vida del proyecto: los 12 pasos, desde el espacio de trabajo hasta el cierre del Sprint.

Los pasos 1 a 6 se completan una vez (preparación y producto). Los pasos 7 a 12 se repiten en cada
Sprint: se evalúan sobre el Sprint actual (en curso o planificado; si no hay, el último cerrado).
"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    BacklogItem,
    Invitation,
    Project,
    ProjectMember,
    ScrumEvent,
    Sprint,
    SprintItem,
    Task,
    Workspace,
    WorkspaceMember,
)
from app.schemas.lifecycle import LifecycleOut, LifecycleStep
from app.services.scrum import header

PROJECT_TYPE_ES = {
    "software": "Software", "web": "Aplicación web", "mobile": "App móvil", "data": "Datos / BI",
    "research": "Investigación", "academic": "Proyecto académico", "other": "Otro",
}


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def project_lifecycle(db: Session, project: Project, user_id: UUID) -> LifecycleOut:
    workspace = db.get(Workspace, project.workspace_id)
    ws_members = db.scalar(select(func.count()).where(
        WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.status == "active")) or 0
    roles = list(db.scalars(select(ProjectMember.role).where(ProjectMember.project_id == project.id)))
    pending_invites = db.scalar(select(func.count()).where(
        Invitation.project_id == project.id, Invitation.status == "pending")) or 0

    pbis = list(db.scalars(select(BacklogItem).where(
        BacklogItem.project_id == project.id, BacklogItem.archived_at.is_(None),
        BacklogItem.status != "discarded")))
    open_pbis = [i for i in pbis if i.status in ("new", "refined", "ready")]
    estimated = sum(1 for i in open_pbis if i.estimate is not None)
    with_criteria = sum(1 for i in open_pbis if i.acceptance_criteria)
    dod = project.definition_of_done or []

    sprints = list(db.scalars(select(Sprint).where(Sprint.project_id == project.id).order_by(Sprint.number.desc())))
    current = next((s for s in sprints if s.status in ("active", "planned")), None) \
        or next((s for s in sprints if s.status == "closed"), None)

    events: dict[str, int] = {}
    blocked = tasks_total = tasks_done = sprint_pbis = 0
    if current:
        events = dict(db.execute(
            select(ScrumEvent.type, func.count()).where(ScrumEvent.sprint_id == current.id).group_by(ScrumEvent.type)
        ).all())
        tasks_total, tasks_done, blocked = db.execute(
            select(func.count(), func.count(Task.completed_at),
                   func.count().filter(Task.is_blocked.is_(True), Task.completed_at.is_(None)))
            .where(Task.sprint_id == current.id, Task.archived_at.is_(None))
        ).one()
        sprint_pbis = db.scalar(select(func.count()).where(SprintItem.sprint_id == current.id)) or 0

    started = bool(current and current.status in ("active", "closed"))
    closed = bool(current and current.status == "closed")
    dailies = events.get("daily_scrum", 0)
    sprint_label = f"Sprint #{current.number}" if current else "Sprint"

    team_done = "product_owner" in roles and "scrum_master" in roles and "developer" in roles
    missing_roles = [label for role, label in (("product_owner", "Product Owner"), ("scrum_master", "Scrum Master"),
                                               ("developer", "Developers")) if role not in roles]

    steps = [
        LifecycleStep(
            key="workspace", phase="setup", title="Crear espacio de trabajo", done=True,
            detail=f"{workspace.name} · {_plural(ws_members, 'miembro', 'miembros')}",
            hint="Nombre del equipo, descripción, propietario y miembros."),
        LifecycleStep(
            key="project", phase="setup", title="Crear proyecto", done=True,
            detail=f"{PROJECT_TYPE_ES.get(project.project_type, 'Otro')}"
                   + (" · con responsable" if project.lead_id else " · sin responsable"),
            hint="Nombre, descripción, tipo de proyecto y responsable."),
        LifecycleStep(
            key="team", phase="setup", title="Configurar el equipo", done=team_done,
            detail=(f"{_plural(len(roles), 'integrante', 'integrantes')}"
                    + (f" · falta: {', '.join(missing_roles)}" if missing_roles else "")
                    + (f" · {_plural(pending_invites, 'invitación pendiente', 'invitaciones pendientes')}"
                       if pending_invites else "")),
            hint="Invitaciones y roles: Product Owner, Scrum Master, Developers y observadores."),
        LifecycleStep(
            key="product_goal", phase="product", title="Definir el Product Goal", done=bool(project.product_goal),
            detail=project.product_goal or "Aún no está definido",
            hint="El objetivo a largo plazo del producto. Se define antes de crear y ordenar el Product Backlog."),
        LifecycleStep(
            key="backlog", phase="product", title="Crear el Product Backlog", done=bool(pbis),
            detail=(f"{_plural(len(open_pbis), 'PBI pendiente', 'PBIs pendientes')} · {estimated} estimados · "
                    f"{with_criteria} con criterios de aceptación") if pbis else "Aún no hay PBIs",
            hint="PBIs, historias de usuario, criterios de aceptación, prioridades y estimaciones.",
            blocked=None if project.product_goal else "Primero define el Product Goal"),
        LifecycleStep(
            key="definition_of_done", phase="product", title="Definir la Definition of Done", done=bool(dod),
            detail=_plural(len(dod), "criterio", "criterios") if dod else "Aún no está definida",
            hint="Cuándo un trabajo se considera terminado y cumple los estándares de calidad."),
        LifecycleStep(
            key="planning", phase="sprint", title="Sprint Planning", done=current is not None,
            detail=(f"{sprint_label}: {current.goal} · {_plural(sprint_pbis, 'PBI', 'PBIs')} · "
                    f"{_plural(tasks_total, 'tarea', 'tareas')}") if current else "Aún no hay Sprints",
            hint="Duración, Sprint Goal (el resultado de este Sprint, distinto del Product Goal), "
                 "PBIs seleccionados y su descomposición en tareas.",
            blocked=("Primero define el Product Goal" if not project.product_goal
                     else "Primero define la Definition of Done" if not dod
                     else "Primero agrega PBIs al Product Backlog" if not open_pbis and current is None else None)),
        LifecycleStep(
            key="start", phase="sprint", title="Iniciar el Sprint", done=started,
            detail=("En curso: el tablero Kanban está activo" if current and current.status == "active"
                    else "Planificado, sin iniciar" if current and current.status == "planned"
                    else "Terminado" if closed else "—"),
            hint="Activa el tablero Kanban y comienza el desarrollo."),
        LifecycleStep(
            key="tracking", phase="sprint", title="Seguimiento del Sprint", done=closed or (started and dailies > 0),
            detail=(f"{_plural(dailies, 'Daily Scrum', 'Daily Scrums')} · {tasks_done}/{tasks_total} tareas"
                    + (f" · {_plural(blocked, 'impedimento', 'impedimentos')}" if blocked else ""))
                   if started else "—",
            hint="Daily Scrum, impedimentos, actualización de tareas y bitácora."),
        LifecycleStep(
            key="review", phase="sprint", title="Sprint Review", done=events.get("sprint_review", 0) > 0,
            detail="Acta registrada" if events.get("sprint_review") else "—",
            hint="Mostrar el Incremento, recibir comentarios y revisar el Product Backlog."),
        LifecycleStep(
            key="retrospective", phase="sprint", title="Sprint Retrospective",
            done=events.get("sprint_retrospective", 0) > 0,
            detail="Acta registrada" if events.get("sprint_retrospective") else "—",
            hint="Qué funcionó, qué falló y qué se puede mejorar."),
        LifecycleStep(
            key="close", phase="sprint", title="Cerrar el Sprint y generar el informe", done=closed,
            detail=(f"{sprint_label} cerrado · informe disponible" if closed else "—"),
            hint="Guarda resultados, pendientes, acuerdos y métricas. Lo incompleto vuelve al Product Backlog "
                 "para una nueva decisión."),
    ]
    current_step = next((s.key for s in steps if not s.done), None)
    return LifecycleOut(
        **header(db, project, user_id), workspace_name=workspace.name, steps=steps, current_step=current_step,
        sprint_id=current.id if current else None, sprint_number=current.number if current else None,
        sprint_status=current.status if current else None,
        # Con el último Sprint cerrado, el ciclo vuelve al paso 7 con un nuevo Sprint
        next_sprint=closed,
    )
