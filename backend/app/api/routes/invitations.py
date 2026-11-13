from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, UserDB
from app.api.routes.workspaces import hash_token
from app.db.models import Invitation, Profile, Project, ProjectMember, Workspace, WorkspaceMember
from app.db.session import SessionLocal
from app.schemas.workspace import InvitationPreview, ReceivedInvitation

router = APIRouter(prefix="/invitations", tags=["invitaciones"])


def _find(db: Session, token: str) -> Invitation:
    invitation = db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(token)))
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitación no encontrada")
    if invitation.status == "pending" and invitation.expires_at <= datetime.now(timezone.utc):
        invitation.status = "expired"
        db.commit()
    return invitation


def _accept(db: Session, inv: Invitation, user) -> None:
    if inv.status != "pending":
        raise HTTPException(status.HTTP_410_GONE, f"La invitación ya no está vigente ({inv.status})")
    if (user.email or "").lower() != inv.email:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esta invitación fue enviada a otro correo")

    member = db.get(WorkspaceMember, (inv.workspace_id, user.id))
    if member is None:
        db.add(WorkspaceMember(workspace_id=inv.workspace_id, user_id=user.id, role=inv.workspace_role, status="active"))
    else:
        member.status = "active"
        if member.role != "owner":
            member.role = inv.workspace_role
    if inv.project_id and db.get(ProjectMember, (inv.project_id, user.id)) is None:
        db.add(ProjectMember(project_id=inv.project_id, user_id=user.id, role=inv.project_role or "developer"))

    inv.status = "accepted"
    inv.responded_at = datetime.now(timezone.utc)
    db.commit()


def _decline(db: Session, inv: Invitation, user) -> None:
    if (user.email or "").lower() != inv.email:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esta invitación fue enviada a otro correo")
    if inv.status == "pending":
        inv.status = "declined"
        inv.responded_at = datetime.now(timezone.utc)
        db.commit()


# ---------------------------------------------------- invitaciones recibidas (sin depender del correo)
@router.get("/received", response_model=list[ReceivedInvitation])
def received_invitations(user: CurrentUser, db: UserDB) -> list[ReceivedInvitation]:
    """Invitaciones pendientes para el correo del usuario: se pueden aceptar desde la app."""
    rows = db.execute(
        select(Invitation, Workspace.name, Project.name, Profile.full_name, Profile.email)
        .join(Workspace, Workspace.id == Invitation.workspace_id)
        .outerjoin(Project, Project.id == Invitation.project_id)
        .join(Profile, Profile.id == Invitation.invited_by)
        .where(
            Invitation.email == (user.email or "").lower(), Invitation.status == "pending",
            Invitation.expires_at > datetime.now(timezone.utc),
        )
        .order_by(Invitation.created_at.desc())
    )
    return [
        ReceivedInvitation(
            id=inv.id, workspace_name=ws_name, project_name=project_name, invited_by=inviter_name or inviter_email,
            workspace_role=inv.workspace_role, project_role=inv.project_role, expires_at=inv.expires_at,
        )
        for inv, ws_name, project_name, inviter_name, inviter_email in rows
    ]


def _received(db: Session, invitation_id: UUID) -> Invitation:
    inv = db.get(Invitation, invitation_id)
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitación no encontrada")
    if inv.status == "pending" and inv.expires_at <= datetime.now(timezone.utc):
        inv.status = "expired"
        db.commit()
    return inv


@router.post("/received/{invitation_id}/accept", status_code=status.HTTP_204_NO_CONTENT)
def accept_received(invitation_id: UUID, user: CurrentUser, db: UserDB) -> None:
    _accept(db, _received(db, invitation_id), user)


@router.post("/received/{invitation_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline_received(invitation_id: UUID, user: CurrentUser, db: UserDB) -> None:
    _decline(db, _received(db, invitation_id), user)


# ---------------------------------------------------- por enlace (token del correo)
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
    _accept(db, _find(db, token), user)


@router.post("/{token}/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline_invitation(token: str, user: CurrentUser, db: UserDB) -> None:
    _decline(db, _find(db, token), user)
