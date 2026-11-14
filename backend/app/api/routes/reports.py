"""Informes: resumen por Sprint, PDF de Sprint y de proyecto (versión cliente o equipo) y exportaciones CSV.

Solo lectura: también los observadores (profesor) pueden descargarlos.
"""

import csv
import io
import re
import unicodedata
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select

from app.api.deps import CurrentUser, UserDB
from app.db.models import BacklogItem, Project, Sprint, Workspace
from app.schemas.report import ReportRequest, ReportsOut
from app.services.dashboard import PBI_STATUS_ES, SPRINT_STATUS_ES, TZ
from app.services.pdf import ACTION_ES, PBI_TYPE_ES, project_pdf, sprint_pdf
from app.services.permissions import project_access
from app.services.reports import (
    project_actions,
    project_sprints,
    project_team,
    project_totals,
    sprint_report,
    sprint_report_detail,
)
from app.services.scrum import header

router = APIRouter(tags=["informes"])

PRIORITY_ES = {"low": "Baja", "medium": "Media", "high": "Alta", "critical": "Crítica"}


def _slug(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-") or "proyecto"


def _pdf(content: bytes, filename: str) -> Response:
    return Response(content, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _csv(header_row: list[str], rows: list[list[object]], filename: str) -> Response:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(header_row)
    writer.writerows(rows)
    return Response(
        content="﻿" + buffer.getvalue(),  # BOM: Excel reconoce los acentos
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _sprint(db, sprint_id: UUID, user_id: UUID) -> tuple[Sprint, Project]:
    sprint = db.get(Sprint, sprint_id)
    if sprint is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sprint no encontrado")
    return sprint, project_access(db, sprint.project_id, user_id)


def _num(value: float | None) -> str:
    return "" if value is None else f"{value:g}".replace(".", ",")


@router.get("/projects/{project_id}/reports", response_model=ReportsOut)
def reports_overview(project_id: UUID, user: CurrentUser, db: UserDB) -> ReportsOut:
    project = project_access(db, project_id, user.id)
    reports = [sprint_report(db, s) for s in project_sprints(db, project_id)]
    return ReportsOut(**header(db, project, user.id), project_color=project.color,
                      totals=project_totals(db, project_id, reports), sprints=reports)


@router.post("/sprints/{sprint_id}/report.pdf")
def sprint_report_pdf(sprint_id: UUID, payload: ReportRequest, user: CurrentUser, db: UserDB) -> Response:
    sprint, project = _sprint(db, sprint_id, user.id)
    workspace = db.get(Workspace, project.workspace_id)
    content = sprint_pdf(project, workspace.name, sprint_report_detail(db, sprint), project_team(db, project),
                         audience=payload.audience, note=payload.note, client_name=payload.client_name)
    suffix = "-interno" if payload.audience == "team" else ""
    return _pdf(content, f"informe-sprint-{sprint.number}-{_slug(project.key)}{suffix}.pdf")


@router.post("/projects/{project_id}/report.pdf")
def project_report_pdf(project_id: UUID, payload: ReportRequest, user: CurrentUser, db: UserDB) -> Response:
    project = project_access(db, project_id, user.id)
    workspace = db.get(Workspace, project.workspace_id)
    reports = [sprint_report(db, s) for s in project_sprints(db, project_id)]
    content = project_pdf(project, workspace.name, reports, project_totals(db, project_id, reports),
                          project_actions(db, project_id), project_team(db, project),
                          audience=payload.audience, note=payload.note, client_name=payload.client_name)
    suffix = "-interno" if payload.audience == "team" else ""
    return _pdf(content, f"informe-proyecto-{_slug(project.key)}-{datetime.now(TZ):%Y%m%d}{suffix}.pdf")


@router.get("/sprints/{sprint_id}/tasks.csv")
def sprint_tasks_csv(sprint_id: UUID, user: CurrentUser, db: UserDB) -> Response:
    sprint, project = _sprint(db, sprint_id, user.id)
    detail = sprint_report_detail(db, sprint)
    rows = [
        [t.title, t.pbi_code or "", t.column, ", ".join(t.assignees),
         "Sí" if t.completed_at else "No", t.completed_at.astimezone(TZ).strftime("%d-%m-%Y %H:%M") if t.completed_at else "",
         t.due_date.strftime("%d-%m-%Y") if t.due_date else "", "Sí" if t.is_blocked else "No", t.blocked_reason or ""]
        for t in detail.tasks
    ]
    return _csv(["Tarea", "PBI", "Columna", "Responsables", "Terminada", "Fecha de término", "Vence", "Bloqueada",
                 "Motivo del bloqueo"], rows, f"tareas-sprint-{sprint.number}-{_slug(project.key)}.csv")


@router.get("/sprints/{sprint_id}/items.csv")
def sprint_items_csv(sprint_id: UUID, user: CurrentUser, db: UserDB) -> Response:
    sprint, project = _sprint(db, sprint_id, user.id)
    report = sprint_report(db, sprint)
    rows = [
        [p.code, p.title, PBI_TYPE_ES.get(p.type, p.type), _num(p.estimate), PBI_STATUS_ES.get(p.status, p.status),
         "Sí" if p.finished else "No", p.tasks_done, p.task_count]
        for p in report.pbis
    ]
    return _csv(["Código", "Elemento", "Tipo", "Puntos", "Estado", "Terminado", "Tareas terminadas", "Tareas"],
                rows, f"sprint-backlog-{sprint.number}-{_slug(project.key)}.csv")


@router.get("/projects/{project_id}/backlog.csv")
def backlog_csv(project_id: UUID, user: CurrentUser, db: UserDB) -> Response:
    project = project_access(db, project_id, user.id)
    items = db.scalars(select(BacklogItem).where(
        BacklogItem.project_id == project_id, BacklogItem.archived_at.is_(None)
    ).order_by(BacklogItem.rank))
    rows = [
        [i.code, i.title, PBI_TYPE_ES.get(i.type, i.type), PBI_STATUS_ES.get(i.status, i.status),
         PRIORITY_ES.get(i.priority, i.priority), _num(float(i.estimate) if i.estimate is not None else None),
         i.story_as_a or "", i.story_i_want or "", i.story_so_that or "", i.acceptance_criteria or "",
         i.created_at.astimezone(TZ).strftime("%d-%m-%Y")]
        for i in items
    ]
    return _csv(["Código", "Título", "Tipo", "Estado", "Prioridad", "Puntos", "Como", "Quiero", "Para",
                 "Criterios de aceptación", "Creado"], rows, f"product-backlog-{_slug(project.key)}.csv")


@router.get("/projects/{project_id}/sprints.csv")
def sprints_csv(project_id: UUID, user: CurrentUser, db: UserDB) -> Response:
    project = project_access(db, project_id, user.id)
    reports = [sprint_report(db, s) for s in project_sprints(db, project_id)]
    rows = [
        [r.number, r.goal, r.start_date.strftime("%d-%m-%Y"), r.end_date.strftime("%d-%m-%Y"), SPRINT_STATUS_ES[r.status],
         r.pbis_done, r.pbis_total, _num(r.points_done), _num(r.points_total), r.tasks_done, r.task_count,
         f"{r.completion}%", r.close_reason or ""]
        for r in reports
    ]
    return _csv(["Sprint", "Sprint Goal", "Inicio", "Término", "Estado", "PBIs terminados", "PBIs", "Puntos terminados",
                 "Puntos", "Tareas terminadas", "Tareas", "Avance", "Motivo de cierre"],
                rows, f"sprints-{_slug(project.key)}.csv")


@router.get("/projects/{project_id}/retro-actions.csv")
def retro_actions_csv(project_id: UUID, user: CurrentUser, db: UserDB) -> Response:
    project = project_access(db, project_id, user.id)
    rows = [
        [a.sprint_number, a.description, a.owner or "", a.due_date.strftime("%d-%m-%Y") if a.due_date else "",
         ACTION_ES.get(a.status, a.status)]
        for a in project_actions(db, project_id)
    ]
    return _csv(["Sprint", "Acción", "Responsable", "Fecha objetivo", "Estado"], rows,
                f"acciones-mejora-{_slug(project.key)}.csv")
