"""Informes PDF (reportlab): informe de Sprint e informe del proyecto.

Dos versiones: "client" (para entregar al cliente: avance, entregables, Review y próximos pasos)
y "team" (agrega tareas, bloqueos, Retrospectiva, acciones de mejora y contribuciones).
"""

import io
import re
from datetime import date, datetime
from xml.sax.saxutils import escape

from reportlab.graphics.shapes import Drawing, Line, PolyLine, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.db.models import Project
from app.schemas.report import ProjectTotals, ReportAction, ReportPbi, SprintReport, SprintReportDetail
from app.services.dashboard import PBI_STATUS_ES, SPRINT_STATUS_ES, TZ

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
HEADER_H = 46 * mm

INK = colors.HexColor("#1F2937")
MUTED = colors.HexColor("#6B7280")
LINE = colors.HexColor("#E5E7EB")
SOFT = colors.HexColor("#F5F7FA")
GOAL_STATUS = {
    "achieved": ("Objetivo cumplido", "#15803D"),
    "partial": ("Objetivo parcialmente cumplido", "#B45309"),
    "not_achieved": ("Objetivo no cumplido", "#B91C1C"),
    "cancelled": ("Sprint cancelado", "#6B7280"),
    "in_progress": ("Sprint en curso", "#1D4ED8"),
    "planned": ("Sprint planificado", "#6B7280"),
}
PBI_TYPE_ES = {"story": "Historia", "bug": "Defecto", "task": "Tarea técnica", "spike": "Investigación",
               "improvement": "Mejora"}
ACTION_ES = {"pending": "Pendiente", "in_progress": "En progreso", "done": "Hecha", "dropped": "Descartada"}
MONTHS = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")
MONTHS_LONG = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
               "noviembre", "diciembre")


# ------------------------------------------------------------------ utilidades
def _brand(project: Project) -> colors.Color:
    return colors.HexColor(project.color if re.fullmatch(r"#[0-9a-fA-F]{6}", project.color or "") else "#447794")


def _clean(value: object) -> str:
    """Las fuentes estándar del PDF usan WinAnsi: lo que no cabe se reemplaza."""
    text = str(value or "").replace("→", "->").replace("✓", "OK")
    return text.encode("cp1252", "replace").decode("cp1252")


def _p(value: object) -> str:
    return escape(_clean(value)).replace("\n", "<br/>")


def _d(value: date | None) -> str:
    return f"{value.day} {MONTHS[value.month - 1]} {value.year}" if value else "—"


def _dt(value: datetime | None) -> str:
    if not value:
        return "—"
    local = value.astimezone(TZ)
    return f"{_d(local.date())}, {local:%H:%M}"


def _long_date(value: date) -> str:
    return f"{value.day} de {MONTHS_LONG[value.month - 1]} de {value.year}"


def _num(value: float) -> str:
    return f"{value:g}".replace(".", ",")


def _styles(brand: colors.Color) -> dict[str, ParagraphStyle]:
    base = ParagraphStyle("base", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK)
    return {
        "body": base,
        "muted": ParagraphStyle("muted", parent=base, textColor=MUTED, fontSize=8.5, leading=12),
        "small": ParagraphStyle("small", parent=base, fontSize=8.5, leading=11.5),
        "h2": ParagraphStyle("h2", parent=base, fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=brand,
                             spaceBefore=12, spaceAfter=6),
        "h3": ParagraphStyle("h3", parent=base, fontName="Helvetica-Bold", fontSize=10, leading=14, spaceBefore=6,
                             spaceAfter=2),
        "goal": ParagraphStyle("goal", parent=base, fontName="Helvetica-Bold", fontSize=12, leading=16),
        "kpi": ParagraphStyle("kpi", parent=base, fontName="Helvetica-Bold", fontSize=18, leading=22,
                              alignment=TA_CENTER, textColor=brand),
        "kpi_label": ParagraphStyle("kpi_label", parent=base, fontSize=8, leading=10, alignment=TA_CENTER,
                                    textColor=MUTED),
        "cell": ParagraphStyle("cell", parent=base, fontSize=8.5, leading=11),
        "cell_head": ParagraphStyle("cell_head", parent=base, fontName="Helvetica-Bold", fontSize=8, leading=10,
                                    textColor=MUTED),
    }


class _Doc:
    """Documento con banda de color en la primera página y pie con numeración."""

    def __init__(self, project: Project, workspace: str, kicker: str, title: str, subtitle: str,
                 client_name: str | None):
        self.project, self.workspace = project, workspace
        self.kicker, self.title, self.subtitle, self.client_name = kicker, title, subtitle, client_name
        self.brand = _brand(project)
        self.s = _styles(self.brand)
        self.story: list = []
        self.generated = datetime.now(TZ)

    # --- decoración de páginas
    def _first_page(self, canvas, doc) -> None:
        canvas.saveState()
        canvas.setFillColor(self.brand)
        canvas.rect(0, PAGE_H - HEADER_H, PAGE_W, HEADER_H, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 8.5)
        canvas.drawString(MARGIN, PAGE_H - 13 * mm, _clean(f"{self.kicker.upper()}  ·  {self.project.name.upper()}"))
        canvas.setFont("Helvetica-Bold", 21)
        canvas.drawString(MARGIN, PAGE_H - 24 * mm, _clean(self.title))
        canvas.setFont("Helvetica", 10)
        canvas.drawString(MARGIN, PAGE_H - 31 * mm, _clean(self.subtitle))
        meta = f"Emitido el {_long_date(self.generated.date())}"
        if self.client_name:
            meta = f"Preparado para {self.client_name}  ·  {meta}"
        canvas.setFont("Helvetica", 8.5)
        canvas.drawString(MARGIN, PAGE_H - 38.5 * mm, _clean(meta))
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 13 * mm, _clean(self.workspace))
        canvas.restoreState()
        self._footer(canvas, doc)

    def _later_pages(self, canvas, doc) -> None:
        canvas.saveState()
        canvas.setFillColor(self.brand)
        canvas.rect(0, PAGE_H - 4 * mm, PAGE_W, 4 * mm, stroke=0, fill=1)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(MARGIN, PAGE_H - 11 * mm, _clean(f"{self.project.name}  ·  {self.title}"))
        canvas.restoreState()
        self._footer(canvas, doc)

    def _footer(self, canvas, doc) -> None:
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.line(MARGIN, 14 * mm, PAGE_W - MARGIN, 14 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(MARGIN, 10 * mm, _clean(f"Generado con Arkio el {self.generated:%d-%m-%Y %H:%M}"))
        canvas.drawRightString(PAGE_W - MARGIN, 10 * mm, f"Página {doc.page}")
        canvas.restoreState()

    def build(self) -> bytes:
        buffer = io.BytesIO()
        doc = BaseDocTemplate(
            buffer, pagesize=A4, title=_clean(f"{self.title} - {self.project.name}"), author=_clean(self.workspace),
            creator="Arkio",
        )
        bottom = 20 * mm
        first_top = PAGE_H - HEADER_H - 8 * mm
        later_top = PAGE_H - 18 * mm
        doc.addPageTemplates([
            PageTemplate("first", [Frame(MARGIN, bottom, CONTENT_W, first_top - bottom, id="f1", leftPadding=0, rightPadding=0)],
                         onPage=self._first_page, autoNextPageTemplate="later"),
            PageTemplate("later", [Frame(MARGIN, bottom, CONTENT_W, later_top - bottom, id="f2", leftPadding=0, rightPadding=0)],
                         onPage=self._later_pages),
        ])
        doc.build(self.story)
        return buffer.getvalue()

    # --- bloques
    def h2(self, text: str) -> None:
        self.story.append(CondPageBreak(40 * mm))
        self.story.append(Paragraph(_p(text), self.s["h2"]))

    def h3(self, text: str) -> None:
        self.story.append(Paragraph(_p(text), self.s["h3"]))

    def para(self, text: str, style: str = "body") -> None:
        self.story.append(Paragraph(_p(text), self.s[style]))

    def gap(self, height: float = 4) -> None:
        self.story.append(Spacer(1, height * mm))

    def box(self, flowables: list, background=SOFT, border=None) -> None:
        table = Table([[flowables]], colWidths=[CONTENT_W])
        style = [
            ("BACKGROUND", (0, 0), (-1, -1), background),
            ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ]
        if border is not None:
            style.append(("LINEBEFORE", (0, 0), (0, -1), 3, border))
        table.setStyle(TableStyle(style))
        self.story.append(table)

    def kpis(self, items: list[tuple[str, str]]) -> None:
        cells = [[Paragraph(_p(value), self.s["kpi"]), Paragraph(_p(label), self.s["kpi_label"])] for value, label in items]
        width = CONTENT_W / len(items)
        table = Table([[c for c in cells]], colWidths=[width] * len(items))
        table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        self.story.append(table)

    def table(self, head: list[str], rows: list[list[object]], widths: list[float]) -> None:
        if not rows:
            return
        data = [[Paragraph(_p(h), self.s["cell_head"]) for h in head]]
        data += [[c if not isinstance(c, (str, int, float)) else Paragraph(_p(c), self.s["cell"]) for c in r] for r in rows]
        total = sum(widths)
        table = Table(data, colWidths=[CONTENT_W * w / total for w in widths], repeatRows=1)
        table.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK), ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            *[("BACKGROUND", (0, i), (-1, i), SOFT) for i in range(2, len(data), 2)],
        ]))
        self.story.append(table)

    def badge(self, text: str, color_hex: str) -> Paragraph:
        return Paragraph(f'<font color="{color_hex}"><b>{_p(text)}</b></font>', self.s["cell"])

    def fields(self, pairs: list[tuple[str, str | None]]) -> bool:
        """Pares título/texto de un acta; omite los vacíos. Devuelve si escribió algo."""
        wrote = False
        for label, value in pairs:
            if value and value.strip():
                self.story.append(KeepTogether([Paragraph(_p(label), self.s["h3"]), Paragraph(_p(value), self.s["body"])]))
                wrote = True
        return wrote


# ------------------------------------------------------------------ gráficos
def _progress_bar(pct: int, brand: colors.Color, width: float = CONTENT_W, height: float = 7) -> Drawing:
    drawing = Drawing(width, height + 2)
    drawing.add(Rect(0, 1, width, height, fillColor=LINE, strokeColor=None, rx=3.5, ry=3.5))
    if pct > 0:
        drawing.add(Rect(0, 1, width * min(pct, 100) / 100, height, fillColor=brand, strokeColor=None, rx=3.5, ry=3.5))
    return drawing


def _axis_frame(drawing: Drawing, x0: float, y0: float, w: float, h: float, top: float, steps: int = 4) -> None:
    for i in range(steps + 1):
        y = y0 + h * i / steps
        drawing.add(Line(x0, y, x0 + w, y, strokeColor=LINE, strokeWidth=0.5))
        drawing.add(String(x0 - 4, y - 3, _num(round(top * i / steps, 1)), fontName="Helvetica", fontSize=7,
                           fillColor=MUTED, textAnchor="end"))


def _burndown_chart(report: SprintReport, brand: colors.Color) -> Drawing | None:
    series = report.burndown
    if not series or report.task_count == 0:
        return None
    width, height = CONTENT_W, 62 * mm
    x0, y0, w, h = 26, 22, width - 34, height - 34
    actual = [d.remaining for d in series if d.remaining is not None]
    top = max([*(d.ideal for d in series), *actual, 1])
    drawing = Drawing(width, height)
    _axis_frame(drawing, x0, y0, w, h, top)
    n = len(series)
    x = (lambda i: x0 + (w * i / (n - 1) if n > 1 else w / 2))
    y = (lambda v: y0 + h * v / top)

    ideal = []
    for i, d in enumerate(series):
        ideal += [x(i), y(d.ideal)]
    drawing.add(PolyLine(ideal, strokeColor=MUTED, strokeWidth=1, strokeDashArray=[3, 3]))
    points = []
    for i, d in enumerate(series):
        if d.remaining is not None:
            points += [x(i), y(d.remaining)]
    if len(points) >= 4:
        drawing.add(PolyLine(points, strokeColor=brand, strokeWidth=2))
    for i in range(0, len(points), 2):
        drawing.add(Rect(points[i] - 1.8, points[i + 1] - 1.8, 3.6, 3.6, fillColor=brand, strokeColor=None))

    labels = sorted({0, n // 2, n - 1}) if n > 2 else range(n)
    for i in labels:
        drawing.add(String(x(i), y0 - 12, _d(series[i].day)[:-5], fontName="Helvetica", fontSize=7, fillColor=MUTED,
                           textAnchor="middle"))
    # leyenda
    lx = x0
    drawing.add(Line(lx, height - 5, lx + 14, height - 5, strokeColor=brand, strokeWidth=2))
    drawing.add(String(lx + 18, height - 8, "Tareas pendientes", fontName="Helvetica", fontSize=7.5, fillColor=INK))
    drawing.add(Line(lx + 100, height - 5, lx + 114, height - 5, strokeColor=MUTED, strokeWidth=1,
                     strokeDashArray=[3, 3]))
    drawing.add(String(lx + 118, height - 8, "Ritmo ideal", fontName="Helvetica", fontSize=7.5, fillColor=INK))
    return drawing


def _velocity_chart(reports: list[SprintReport], brand: colors.Color) -> Drawing | None:
    data = [r for r in reversed(reports) if r.status in ("closed", "active")][-10:]
    if not data or not any(r.points_total for r in data):
        return None
    width, height = CONTENT_W, 60 * mm
    x0, y0, w, h = 26, 20, width - 34, height - 34
    top = max(max(r.points_total for r in data), 1)
    drawing = Drawing(width, height)
    _axis_frame(drawing, x0, y0, w, h, top)
    slot = w / len(data)
    bar = min(18, slot * 0.32)
    light = colors.Color(brand.red, brand.green, brand.blue, alpha=0.28)
    for i, r in enumerate(data):
        cx = x0 + slot * (i + 0.5)
        drawing.add(Rect(cx - bar - 1, y0, bar, h * r.points_total / top, fillColor=light, strokeColor=None))
        drawing.add(Rect(cx + 1, y0, bar, h * r.points_done / top, fillColor=brand, strokeColor=None))
        drawing.add(String(cx, y0 - 11, f"Sprint {r.number}", fontName="Helvetica", fontSize=7, fillColor=MUTED,
                           textAnchor="middle"))
    drawing.add(Rect(x0, height - 8, 9, 6, fillColor=light, strokeColor=None))
    drawing.add(String(x0 + 13, height - 8, "Comprometido", fontName="Helvetica", fontSize=7.5, fillColor=INK))
    drawing.add(Rect(x0 + 80, height - 8, 9, 6, fillColor=brand, strokeColor=None))
    drawing.add(String(x0 + 93, height - 8, "Terminado", fontName="Helvetica", fontSize=7.5, fillColor=INK))
    return drawing


# ------------------------------------------------------------------ secciones compartidas
def _goal_explanation(r: SprintReport) -> str:
    if r.status == "cancelled":
        return f"El Sprint se canceló. Motivo: {r.close_reason or 'no indicado'}."
    if r.status == "planned":
        return f"El Sprint comenzará el {_d(r.start_date)}."
    done = f"{r.pbis_done} de {r.pbis_total} elementos del Sprint Backlog terminados"
    if r.status == "active":
        return f"Día {r.days_elapsed} de {r.days_total}: {done} y {r.tasks_done} de {r.task_count} tareas completadas."
    text = f"Al cierre: {done} ({r.completion}% del trabajo comprometido)."
    if r.close_reason:
        text += f" Comentario de cierre: {r.close_reason}"
    return text


def _pbi_rows(doc: _Doc, pbis: list[ReportPbi], *, progress: bool) -> list[list[object]]:
    rows = []
    for p in pbis:
        row: list[object] = [p.code, p.title, PBI_TYPE_ES.get(p.type, p.type), _num(p.estimate) if p.estimate is not None else "—"]
        if progress:
            row.append(f"{p.tasks_done}/{p.task_count}" if p.task_count else "—")
        rows.append(row)
    return rows


def _note(doc: _Doc, note: str | None, title: str) -> None:
    if note and note.strip():
        doc.box([Paragraph(f"<b>{_p(title)}</b>", doc.s["body"]), Spacer(1, 3),
                 Paragraph(_p(note.strip()), doc.s["body"])], border=doc.brand)
        doc.gap(2)


def _team(doc: _Doc, team: list[tuple[str, str]]) -> None:
    if not team:
        return
    doc.h2("Equipo")
    doc.table(["Integrante", "Rol en el proyecto"], [[n, r] for n, r in team], [3, 2])


# ------------------------------------------------------------------ informe de Sprint
def sprint_pdf(project: Project, workspace: str, r: SprintReportDetail, team: list[tuple[str, str]], *,
               audience: str, note: str | None, client_name: str | None) -> bytes:
    team_view = audience == "team"
    doc = _Doc(
        project, workspace, "Informe de Sprint" + (" · uso interno" if team_view else ""), f"Sprint {r.number}",
        f"{_d(r.start_date)} al {_d(r.end_date)}  ·  {SPRINT_STATUS_ES.get(r.status, r.status)}", client_name,
    )
    s = doc.s
    _note(doc, note, "Mensaje del equipo")

    # Objetivo y estado
    label, color_hex = GOAL_STATUS[r.goal_status]
    doc.box([
        Paragraph("SPRINT GOAL", s["muted"]), Spacer(1, 2), Paragraph(_p(r.goal), s["goal"]), Spacer(1, 5),
        Paragraph(f'<font color="{color_hex}"><b>{_p(label)}</b></font>  <font color="#6B7280">·</font>  '
                  f'{_p(_goal_explanation(r))}', s["small"]),
    ])
    if project.product_goal:
        doc.gap(2)
        doc.para(f"Product Goal: {project.product_goal}", "muted")
    doc.gap(4)

    points = f"{_num(r.points_done)}/{_num(r.points_total)}" if r.points_total else "—"
    doc.kpis([
        (f"{r.completion}%", "Avance del Sprint"),
        (f"{r.pbis_done}/{r.pbis_total}", "Elementos terminados"),
        (points, "Puntos terminados"),
        (f"{r.tasks_done}/{r.task_count}", "Tareas completadas"),
    ])
    doc.gap(2)
    doc.story.append(_progress_bar(r.completion, doc.brand))
    if team_view:
        doc.gap(2)
        extra = [f"Duración: {r.days_total} días ({r.days_elapsed} transcurridos)",
                 f"Tareas bloqueadas: {r.tasks_blocked}", f"Tareas vencidas: {r.tasks_overdue}"]
        events = [f"{n} {name}" for key, name in (("sprint_planning", "Planning"), ("daily_scrum", "Daily"),
                  ("sprint_review", "Review"), ("sprint_retrospective", "Retrospectiva")) if (n := r.events.get(key))]
        if events:
            extra.append("Eventos registrados: " + ", ".join(events))
        doc.para("  ·  ".join(extra), "muted")

    chart = _burndown_chart(r, doc.brand)
    if chart:
        doc.h2("Burndown del Sprint")
        doc.para("Tareas pendientes al cierre de cada día comparadas con un ritmo constante hasta el final del Sprint.",
                 "muted")
        doc.gap(2)
        doc.story.append(chart)

    finished = [p for p in r.pbis if p.finished]
    pending = [p for p in r.pbis if not p.finished]
    doc.h2("Entregado en este Sprint" if r.status == "closed" else "Terminado hasta ahora")
    if finished:
        doc.table(["Código", "Elemento", "Tipo", "Puntos"], _pbi_rows(doc, finished, progress=False), [1.1, 5, 1.5, 0.9])
    else:
        doc.para("Todavía no hay elementos terminados.", "muted")

    if pending:
        closed = r.status in ("closed", "cancelled")
        doc.h2("No terminado: vuelve al Product Backlog" if closed else "En desarrollo")
        doc.table(["Código", "Elemento", "Tipo", "Puntos", "Tareas"], _pbi_rows(doc, pending, progress=True),
                  [1.1, 4.4, 1.5, 0.9, 0.9])

    if r.review:
        doc.h2("Sprint Review")
        if r.review_date:
            doc.para(f"Realizada el {_dt(r.review_date)}", "muted")
        doc.fields([("Incremento presentado", r.review.get("increment")),
                    ("Comentarios de los interesados", r.review.get("feedback")),
                    ("Cambios acordados al Product Backlog", r.review.get("backlog_changes"))])

    if team_view:
        _sprint_team_sections(doc, r)

    if (r.next_items or r.next_sprint) and r.status != "planned":
        doc.h2("Próximos pasos")
        if r.next_sprint:
            doc.para(f"Siguiente Sprint: {r.next_sprint}")
            doc.gap(2)
        if r.next_items:
            doc.para("Elementos con mayor prioridad en el Product Backlog, candidatos para los próximos Sprints.", "muted")
            doc.gap(1)
            doc.table(["Código", "Elemento", "Tipo", "Puntos"], _pbi_rows(doc, r.next_items, progress=False),
                      [1.1, 5, 1.5, 0.9])

    _team(doc, team)
    return doc.build()


def _sprint_team_sections(doc: _Doc, r: SprintReportDetail) -> None:
    if r.planning_plan:
        doc.h2("Plan de la Sprint Planning")
        doc.para(r.planning_plan)

    if r.tasks:
        doc.h2("Tareas del Sprint")
        rows = []
        for t in r.tasks:
            state = f"Terminada {_d(t.completed_at.astimezone(TZ).date())}" if t.completed_at else t.column
            if t.is_blocked and not t.completed_at:
                state += " · BLOQUEADA" + (f": {t.blocked_reason}" if t.blocked_reason else "")
            rows.append([t.title, t.pbi_code or "—", ", ".join(t.assignees) or "Sin asignar", state])
        doc.table(["Tarea", "PBI", "Responsables", "Estado"], rows, [4, 1, 2.4, 2.4])

    if r.blockers:
        doc.h2("Impedimentos reportados en las Daily")
        doc.table(["Fecha y descripción"], [[b] for b in r.blockers], [1])

    if r.retro or r.actions:
        doc.h2("Sprint Retrospective")
        doc.fields([("Qué salió bien", r.retro.get("went_well")), ("Qué dificultades tuvimos", r.retro.get("difficulties")),
                    ("Causas", r.retro.get("causes"))])
        if r.actions:
            doc.h3("Acciones de mejora")
            doc.table(["Acción", "Responsable", "Fecha objetivo", "Estado"],
                      [[a.description, a.owner or "—", _d(a.due_date), ACTION_ES.get(a.status, a.status)] for a in r.actions],
                      [4.4, 2, 1.5, 1.3])

    if r.contributions:
        doc.h2("Contribuciones")
        doc.para("Trazabilidad de tareas por integrante (orden alfabético). No es un ranking de productividad: "
                 "el resultado del Sprint es del equipo.", "muted")
        doc.gap(1)
        doc.table(["Integrante", "Rol", "Tareas terminadas", "Tareas abiertas"],
                  [[c.name, c.role, str(c.tasks_done), str(c.tasks_open)] for c in r.contributions], [3, 2, 1.5, 1.5])


# ------------------------------------------------------------------ informe del proyecto
def project_pdf(project: Project, workspace: str, reports: list[SprintReport], totals: ProjectTotals,
                actions: list[ReportAction], team: list[tuple[str, str]], *, audience: str, note: str | None,
                client_name: str | None) -> bytes:
    team_view = audience == "team"
    doc = _Doc(project, workspace, "Informe del proyecto" + (" · uso interno" if team_view else ""), project.name,
               f"Código {project.key}  ·  {len(reports)} Sprint{'s' if len(reports) != 1 else ''}", client_name)
    s = doc.s
    _note(doc, note, "Mensaje del equipo")

    intro = [Paragraph("PRODUCT GOAL", s["muted"]), Spacer(1, 2),
             Paragraph(_p(project.product_goal or "Sin Product Goal definido."), s["goal"])]
    if project.description:
        intro += [Spacer(1, 5), Paragraph(_p(project.description), s["small"])]
    doc.box(intro)
    doc.gap(4)

    pct = round(100 * totals.pbis_done / totals.pbis_total) if totals.pbis_total else 0
    doc.kpis([
        (str(totals.sprints_closed), "Sprints cerrados"),
        (_num(totals.velocity) if totals.velocity is not None else "—", "Velocidad (pts/Sprint)"),
        (f"{totals.pbis_done}/{totals.pbis_total}", "Elementos terminados"),
        (_num(totals.points_remaining), "Puntos por hacer"),
    ])
    doc.gap(2)
    doc.story.append(_progress_bar(pct, doc.brand))
    doc.gap(1)
    doc.para(f"{pct}% del Product Backlog terminado. La velocidad es el promedio de puntos terminados en los últimos "
             "3 Sprints cerrados: una referencia para planificar, no una meta.", "muted")

    chart = _velocity_chart(reports, doc.brand)
    if chart:
        doc.h2("Comprometido y terminado por Sprint")
        doc.story.append(chart)

    if reports:
        doc.h2("Historial de Sprints")
        rows = []
        for r in reports:
            label, color_hex = GOAL_STATUS[r.goal_status]
            rows.append([f"#{r.number}", f"{_d(r.start_date)}\nal {_d(r.end_date)}", r.goal,
                         doc.badge(label, color_hex), f"{r.completion}%"])
        doc.table(["Sprint", "Fechas", "Sprint Goal", "Resultado", "Avance"], rows, [0.8, 1.8, 4, 2, 0.9])

    if totals.backlog_by_status:
        doc.h2("Estado del Product Backlog")
        order = ("new", "refined", "ready", "in_sprint", "done", "discarded")
        doc.table(["Estado", "Elementos"],
                  [[PBI_STATUS_ES.get(k, k), str(totals.backlog_by_status[k])] for k in order if k in totals.backlog_by_status],
                  [3, 1])

    if team_view and actions:
        doc.h2("Acciones de mejora (Retrospectivas)")
        doc.para(f"{totals.open_actions} acciones abiertas.", "muted")
        doc.gap(1)
        doc.table(["Sprint", "Acción", "Responsable", "Fecha objetivo", "Estado"],
                  [[f"#{a.sprint_number}", a.description, a.owner or "—", _d(a.due_date), ACTION_ES.get(a.status, a.status)]
                   for a in actions], [0.8, 4, 1.8, 1.4, 1.2])

    _team(doc, team)
    return doc.build()
