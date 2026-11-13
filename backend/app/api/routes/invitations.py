from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, UserDB
from app.api.routes.workspaces import hash_token
from app.db.models import Invitation, Profile, Project, ProjectMember, Workspace, WorkspaceMember
from app.db.session import SessionLocal
from app.schemas.workspace import InvitationPreview

router = APIRouter(prefix="/invitations", tags=["invitaciones"])


def _find(db: Session, token: str) -> Invitation:
    invitation = db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(token)))
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitación no encontrada")
    if invitation.status == "pending" and invitation.expires_at <= datetime.now(timezone.utc):
        invitation.status = "expired"
        db.commit()
    return invitation


@router.get("/{token}", response_model=InvitationPreview)
def preview_invitation(token: str) -> InvitationPreview:
    """Pública: permite mostrar la invitación antes de iniciar sesión."""
    with SessionLocal() as db:
        inv = _find(db, token)
        workspace = db.get(Workspace, inv.workspace_id)
        project = db.get(Project, inv.project_id) if inv.project_id else None
        inviter = db.get(Profile, inv.invited_by)
        return InvitationPreview(
            workspace_name=workspace.name, project_name=project.name if project else None,
            invited_by=inviter.full_name or inviter.email, email=inv.email, status=inv.status,
            expires_at=inv.expires_at,
        )


@router.post("/{token}/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_invitation(token: str, user: CurrentUser, db: UserDB) -> None:
    inv = _find(db, token)
    if inv.status != "pending":
        raise HTTPException(status.HTTP_410_GONE, f"La invitación ya no está vigente ({inv.status})")
    if (user.email or "").lower() != inv.email:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esta invitación fue enviada a otro correo")

    member = db.get(WorkspaceMember, (inv.workspace_id, user.id))
    if member is None:
        db.add(WorkspaceMember(workspace_id=inv.workspace_id, user_id=user.id, role=inv.workspace_role, status="active"))
    else:
        member.status = "active"
    if inv.project_id and db.get(ProjectMember, (inv.project_id, user.id)) is None:
        db.add(ProjectMember(project_id=inv.project_id, user_id=user.id, role=inv.project_role or "developer"))

    inv.status = "accepted"
    inv.responded_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/{token}/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline_invitation(token: str, user: CurrentUser, db: UserDB) -> None:
    inv = _find(db, token)
    if (user.email or "").lower() != inv.email:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esta invitación fue enviada a otro correo")
    if inv.status == "pending":
        inv.status = "declined"
        inv.responded_at = datetime.now(timezone.utc)
        db.commit()
