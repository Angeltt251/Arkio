"""Product Goal y Product Backlog: PBIs, historias de usuario, criterios de aceptación y refinamiento.

Los PBIs no se borran: se archivan, para que la bitácora conserve la trazabilidad.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, UserDB
from app.db.models import BacklogItem
from app.schemas.scrum import BacklogOut, PbiCreate, PbiMove, PbiOut, PbiSplit, PbiUpdate, ProductGoalUpdate
from app.services.permissions import project_access, require_project_manager
from app.services.scrum import header, pbi_outs

router = APIRouter(tags=["product backlog"])

TEXT_FIELDS = ("description", "story_as_a", "story_i_want", "story_so_that", "acceptance_criteria")


def _clean(changes: dict) -> dict:
    """Recorta espacios y guarda los textos vacíos como NULL."""
    for field in TEXT_FIELDS:
        if field in changes and isinstance(changes[field], str):
            changes[field] = changes[field].strip() or None
    if changes.get("title"):
        changes["title"] = changes["title"].strip()
    return changes


def _ordered(db, project_id: UUID, *, include_archived: bool = False) -> list[BacklogItem]:
    query = select(BacklogItem).where(BacklogItem.project_id == project_id)
    if not include_archived:
        query = query.where(BacklogItem.archived_at.is_(None))
    return list(db.scalars(query.order_by(BacklogItem.archived_at.is_not(None), BacklogItem.rank, BacklogItem.seq)))


def _editable_pbi(db, pbi_id: UUID, user_id: UUID) -> BacklogItem:
    pbi = db.get(BacklogItem, pbi_id)
    if pbi is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Elemento del backlog no encontrado")
    project_access(db, pbi.project_id, user_id, write=True)
    return pbi


@router.get("/projects/{project_id}/backlog", response_model=BacklogOut)
def get_backlog(project_id: UUID, user: CurrentUser, db: UserDB, include_archived: bool = False) -> BacklogOut:
    project = project_access(db, project_id, user.id)
    return BacklogOut(**header(db, project, user.id),
                      items=pbi_outs(db, _ordered(db, project_id, include_archived=include_archived)))


@router.put("/projects/{project_id}/product-goal", response_model=BacklogOut)
def set_product_goal(project_id: UUID, payload: ProductGoalUpdate, user: CurrentUser, db: UserDB) -> BacklogOut:
    """El Product Goal lo define el Product Owner (o el Scrum Master / un administrador)."""
    project = require_project_manager(db, project_id, user.id)
    project.product_goal = (payload.product_goal or "").strip() or None
    db.commit()
    return get_backlog(project_id, user, db)


@router.post("/projects/{project_id}/backlog-items", response_model=PbiOut, status_code=status.HTTP_201_CREATED)
def create_pbi(project_id: UUID, payload: PbiCreate, user: CurrentUser, db: UserDB) -> PbiOut:
    project = project_access(db, project_id, user.id, write=True)
    if not project.product_goal:  # paso 4 antes del 5: el Product Goal orienta qué entra y en qué orden
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Define primero el Product Goal: orienta qué entra al Product Backlog y en qué orden")
    if payload.parent_id:
        parent = db.get(BacklogItem, payload.parent_id)
        if parent is None or parent.project_id != project_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "El PBI de origen no pertenece a este proyecto")
    pbi = BacklogItem(project_id=project_id, created_by=user.id, **_clean(payload.model_dump()))
    db.add(pbi)  # el trigger asigna el código (SAL-12) y lo deja al final del backlog
    db.commit()
    db.refresh(pbi)
    return pbi_outs(db, [pbi])[0]


@router.patch("/backlog-items/{pbi_id}", response_model=PbiOut)
def update_pbi(pbi_id: UUID, payload: PbiUpdate, user: CurrentUser, db: UserDB) -> PbiOut:
    pbi = _editable_pbi(db, pbi_id, user.id)
    changes = _clean(payload.model_dump(exclude_unset=True))
    if pbi.status == "in_sprint" and changes.get("status") not in (None, "in_sprint"):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Este PBI está en un Sprint en curso: su estado cambia al cerrar el Sprint"
        )
    for field, value in changes.items():
        setattr(pbi, field, value)
    db.commit()
    db.refresh(pbi)
    return pbi_outs(db, [pbi])[0]


@router.post("/backlog-items/{pbi_id}/move", response_model=list[PbiOut])
def move_pbi(pbi_id: UUID, payload: PbiMove, user: CurrentUser, db: UserDB) -> list[PbiOut]:
    """Reordena el backlog (lo más importante arriba)."""
    pbi = _editable_pbi(db, pbi_id, user.id)
    others = [i for i in _ordered(db, pbi.project_id) if i.id != pbi.id]
    index = min(payload.index, len(others))
    before = others[index - 1].rank if index > 0 else None
    after = others[index].rank if index < len(others) else None
    if before is None and after is None:
        pbi.rank = 1000
    elif before is None:
        pbi.rank = after - 1000
    elif after is None:
        pbi.rank = before + 1000
    else:
        pbi.rank = (before + after) / 2
    db.commit()
    return pbi_outs(db, _ordered(db, pbi.project_id))


@router.post("/backlog-items/{pbi_id}/split", response_model=list[PbiOut], status_code=status.HTTP_201_CREATED)
def split_pbi(pbi_id: UUID, payload: PbiSplit, user: CurrentUser, db: UserDB) -> list[PbiOut]:
    """Refinamiento: divide un PBI grande en varios más pequeños. El original queda descartado y enlazado."""
    pbi = _editable_pbi(db, pbi_id, user.id)
    if pbi.status in ("in_sprint", "done"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Solo se pueden dividir PBIs que aún no entran a un Sprint")
    titles = [t.strip() for t in payload.titles if t.strip()]
    if len(titles) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indica al menos dos partes")
    following = next((i.rank for i in _ordered(db, pbi.project_id) if i.rank > pbi.rank), pbi.rank + 1000)
    step = (following - pbi.rank) / (len(titles) + 1)
    children = []
    for n, title in enumerate(titles, start=1):
        child = BacklogItem(
            project_id=pbi.project_id, type=pbi.type, title=title[:200], priority=pbi.priority, parent_id=pbi.id,
            story_as_a=pbi.story_as_a, rank=pbi.rank + step * n, created_by=user.id,
        )
        db.add(child)
        children.append(child)
    pbi.status = "discarded"
    db.commit()
    for child in children:
        db.refresh(child)
    return pbi_outs(db, children)


@router.delete("/backlog-items/{pbi_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_pbi(pbi_id: UUID, user: CurrentUser, db: UserDB) -> None:
    pbi = _editable_pbi(db, pbi_id, user.id)
    if pbi.status == "in_sprint":
        raise HTTPException(status.HTTP_409_CONFLICT, "No se puede archivar un PBI que está en un Sprint en curso")
    pbi.archived_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/backlog-items/{pbi_id}/restore", response_model=PbiOut)
def restore_pbi(pbi_id: UUID, user: CurrentUser, db: UserDB) -> PbiOut:
    pbi = _editable_pbi(db, pbi_id, user.id)
    pbi.archived_at = None
    db.commit()
    db.refresh(pbi)
    return pbi_outs(db, [pbi])[0]
