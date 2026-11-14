"""Plantillas de proyecto: columnas del tablero y tareas iniciales para comenzar rápido.

Se definen en código (no en la BD) para que sean iguales en todos los espacios y versionadas
junto con la aplicación. El frontend las lee desde GET /api/templates.
"""

from dataclasses import dataclass, field

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db.models import BoardColumn, Project, Task


@dataclass(frozen=True)
class TemplateColumn:
    name: str
    wip_limit: int | None = None
    is_done: bool = False


@dataclass(frozen=True)
class TemplateTask:
    title: str
    column: int  # índice de la columna donde comienza
    description: str | None = None
    priority: str = "medium"


@dataclass(frozen=True)
class ProjectTemplate:
    id: str
    name: str
    description: str
    category: str
    icon: str
    columns: tuple[TemplateColumn, ...]
    tasks: tuple[TemplateTask, ...] = field(default=())


TEMPLATES: tuple[ProjectTemplate, ...] = (
    ProjectTemplate(
        id="scrum",
        name="Scrum estándar",
        description="El flujo recomendado para equipos Scrum: del trabajo pendiente a terminado, con revisión y testing.",
        category="Ágil",
        icon="zap",
        columns=(
            TemplateColumn("Por hacer"),
            TemplateColumn("En progreso", wip_limit=4),
            TemplateColumn("En revisión", wip_limit=3),
            TemplateColumn("Testing", wip_limit=3),
            TemplateColumn("Terminado", is_done=True),
        ),
        tasks=(
            TemplateTask("Definir el Product Goal", 0, "Objetivo a largo plazo del producto, en una o dos frases.", "high"),
            TemplateTask("Escribir las primeras historias de usuario", 0,
                         "Como [rol], quiero [capacidad], para [beneficio]. Incluir criterios de aceptación."),
            TemplateTask("Acordar la Definition of Done", 0, "Qué debe cumplir un incremento para considerarse terminado."),
            TemplateTask("Planificar el Sprint 1", 0, "Duración, Sprint Goal y elementos seleccionados.", "high"),
        ),
    ),
    ProjectTemplate(
        id="kanban",
        name="Kanban simple",
        description="Tres columnas y un límite de trabajo en curso. Ideal para empezar sin complicaciones.",
        category="Ágil",
        icon="boards",
        columns=(
            TemplateColumn("Por hacer"),
            TemplateColumn("Haciendo", wip_limit=3),
            TemplateColumn("Hecho", is_done=True),
        ),
        tasks=(
            TemplateTask("Anotar todo el trabajo pendiente", 0, "Una tarjeta por tarea; luego ordénalas por prioridad."),
            TemplateTask("Respetar el límite de 3 tareas en curso", 0,
                         "Termina antes de empezar algo nuevo: así el trabajo fluye más rápido.", "low"),
        ),
    ),
    ProjectTemplate(
        id="software",
        name="Desarrollo de software",
        description="Para equipos de desarrollo: revisión de código, QA y despliegue antes de dar algo por terminado.",
        category="Tecnología",
        icon="layers",
        columns=(
            TemplateColumn("Backlog"),
            TemplateColumn("Por hacer"),
            TemplateColumn("En desarrollo", wip_limit=3),
            TemplateColumn("Code review", wip_limit=2),
            TemplateColumn("QA", wip_limit=2),
            TemplateColumn("Desplegado", is_done=True),
        ),
        tasks=(
            TemplateTask("Crear el repositorio y la estructura del proyecto", 1, priority="high"),
            TemplateTask("Configurar integración continua (pruebas automáticas)", 1),
            TemplateTask("Preparar entornos de desarrollo, pruebas y producción", 0),
            TemplateTask("Definir convenciones de código y de commits", 0, priority="low"),
        ),
    ),
    ProjectTemplate(
        id="bugs",
        name="Gestión de bugs",
        description="Seguimiento de defectos: reporte, clasificación por severidad, corrección y verificación.",
        category="Tecnología",
        icon="target",
        columns=(
            TemplateColumn("Reportados"),
            TemplateColumn("Clasificados"),
            TemplateColumn("En corrección", wip_limit=3),
            TemplateColumn("Verificación", wip_limit=3),
            TemplateColumn("Cerrados", is_done=True),
        ),
        tasks=(
            TemplateTask("Ejemplo: el botón Guardar no responde en móvil", 0,
                         "Pasos para reproducir:\n1. …\nResultado esperado: …\nResultado obtenido: …", "high"),
        ),
    ),
    ProjectTemplate(
        id="academico",
        name="Proyecto académico",
        description="Para trabajos, informes o tesis: de la investigación a la entrega, con revisión del profesor.",
        category="Educación",
        icon="trophy",
        columns=(
            TemplateColumn("Ideas"),
            TemplateColumn("Investigación", wip_limit=3),
            TemplateColumn("Redacción", wip_limit=3),
            TemplateColumn("Revisión del profesor"),
            TemplateColumn("Entregado", is_done=True),
        ),
        tasks=(
            TemplateTask("Definir el tema y los objetivos", 0, priority="high"),
            TemplateTask("Revisar bibliografía y fuentes", 0),
            TemplateTask("Redactar el marco teórico", 0),
            TemplateTask("Preparar la primera entrega parcial", 0, priority="high"),
        ),
    ),
    ProjectTemplate(
        id="reservas",
        name="Reservas médicas (demo)",
        description="Proyecto de ejemplo con historias reales para validar el flujo Scrum de punta a punta.",
        category="Ejemplo",
        icon="history",
        columns=(
            TemplateColumn("Por hacer"),
            TemplateColumn("En progreso", wip_limit=3),
            TemplateColumn("En revisión", wip_limit=2),
            TemplateColumn("Terminado", is_done=True),
        ),
        tasks=(
            TemplateTask("Registro de pacientes", 0,
                         "Como paciente, quiero registrarme con mi RUT y correo, para reservar horas en línea.", "high"),
            TemplateTask("Agenda de cada médico", 0,
                         "Como administrativo, quiero cargar los horarios disponibles de cada médico, para ofrecerlos.",
                         "high"),
            TemplateTask("Reservar una hora", 0,
                         "Como paciente, quiero elegir especialidad, médico y horario, para asegurar mi atención.",
                         "critical"),
            TemplateTask("Cancelar o reagendar una reserva", 0,
                         "Como paciente, quiero cancelar o cambiar mi hora, para liberar el cupo si no puedo asistir."),
            TemplateTask("Recordatorio por correo", 0,
                         "Como paciente, quiero recibir un recordatorio el día anterior, para no olvidar mi cita.", "low"),
        ),
    ),
)

TEMPLATES_BY_ID = {t.id: t for t in TEMPLATES}
DEFAULT_TEMPLATE = "scrum"


def apply_template(db: Session, project: Project, template_id: str, created_by) -> None:
    """Reemplaza las columnas por defecto del proyecto recién creado y agrega las tareas iniciales.
    Debe llamarse después de `flush()` (el trigger ya creó el tablero con sus columnas)."""
    template = TEMPLATES_BY_ID[template_id]
    defaults = list(db.query(BoardColumn).filter(BoardColumn.project_id == project.id))
    board_id = defaults[0].board_id
    db.execute(delete(BoardColumn).where(BoardColumn.project_id == project.id))
    db.flush()

    columns = []
    for position, col in enumerate(template.columns, start=1):
        column = BoardColumn(
            board_id=board_id, project_id=project.id, name=col.name, position=position,
            wip_limit=col.wip_limit, is_done=col.is_done,
        )
        db.add(column)
        columns.append(column)
    db.flush()

    per_column: dict[int, int] = {}
    for task in template.tasks:
        per_column[task.column] = per_column.get(task.column, 0) + 1
        db.add(Task(
            project_id=project.id, column_id=columns[task.column].id, title=task.title,
            description=task.description, priority=task.priority, position=per_column[task.column],
            created_by=created_by,
        ))
