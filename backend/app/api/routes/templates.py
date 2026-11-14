from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.schemas.workspace import TemplateColumnOut, TemplateOut, TemplateTaskOut
from app.services.templates import TEMPLATES

router = APIRouter(prefix="/templates", tags=["plantillas"])


@router.get("", response_model=list[TemplateOut])
def list_templates(_: CurrentUser) -> list[TemplateOut]:
    return [
        TemplateOut(
            id=t.id, name=t.name, description=t.description, category=t.category, icon=t.icon,
            columns=[TemplateColumnOut(name=c.name, wip_limit=c.wip_limit, is_done=c.is_done) for c in t.columns],
            tasks=[TemplateTaskOut(title=k.title, column=t.columns[k.column].name, priority=k.priority) for k in t.tasks],
        )
        for t in TEMPLATES
    ]
