import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, UserDB
from app.core.config import settings
from app.db.models import Invitation, Profile, Project, ProjectMember, Sprint, Workspace, WorkspaceMember
from app.schemas.workspace import (
    InvitationCreate,
    InvitationOut,
    MemberOut,
    MemberRoleUpdate,
    ProjectCreate,
    ProjectOut,
    WorkspaceCreate,
    WorkspaceOut,
    WorkspaceUpdate,
)
from app.services.email import invitation_email, send_email
from app.services.permissions import (
    ADMIN_ROLES,
    project_outs,
    require_workspace_admin,
    workspace_membership,
    workspace_settings,
)
from app.services.templates import TEMPLATES_BY_ID, apply_template

router = APIRouter(prefix="/workspaces", tags=["espacios de trabajo"])


def _workspace_out(db, workspace: Workspace, role: str) -> WorkspaceOut:
    owner = db.get(Profile, workspace.owner_id)
    members = db.scalar(select(func.count()).where(
        WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.status == "active"))
    return WorkspaceOut(id=workspace.id, name=workspace.name, description=workspace.description, role=role,
                        created_at=workspace.created_at, owner_id=workspace.owner_id,
                        owner_name=(owner.full_name or owner.email) if owner else None, member_count=members or 0,
                        settings=workspace_settings(workspace))


@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(user: CurrentUser, db: UserDB) -> list[WorkspaceOut]:
    rows = db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user.id, WorkspaceMember.status == "active")
        .order_by(Workspace.created_at)
    )
    return [_workspace_out(db, ws, role) for ws, role in rows]


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(payload: WorkspaceCreate, user: CurrentUser, db: UserDB) -> WorkspaceOut:
    """Paso 1 del ciclo: el equipo (nombre y descripción) con quien lo crea como propietario.
    Los demás miembros se invitan después con POST /{id}/invitations."""
    workspace = Workspace(name=payload.name.strip(), description=(payload.description or "").strip() or None,
                          owner_id=user.id)
    db.add(workspace)
    db.commit()  # el trigger `add_workspace_owner` deja al creador como propietario
    db.refresh(workspace)
    return _workspace_out(db, workspace, "owner")


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
def update_workspace(workspace_id: UUID, payload: WorkspaceUpdate, user: CurrentUser, db: UserDB) -> WorkspaceOut:
    """Renombra el espacio o cambia su configuración (solo propietario y administradores)."""
    member = require_workspace_admin(db, workspace_id, user.id)
    workspace = db.get(Workspace, workspace_id)
    if payload.name is not None:
        workspace.name = payload.name.strip()
    if "description" in payload.model_fields_set:
        workspace.description = (payload.description or "").strip() or None
    if payload.settings is not None:
        if payload.settings.default_template not in TEMPLATES_BY_ID:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esa plantilla de tablero no existe")
        workspace.settings = {**(workspace.settings or {}), **payload.settings.model_dump()}
    db.commit()
    return _workspace_out(db, workspace, member.role)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(
    workspace_id: UUID, user: CurrentUser, db: UserDB,
    confirm: str = Query(..., description="Nombre del espacio, para confirmar"),
) -> None:
    """Elimina el espacio y sus proyectos. Solo el propietario, y solo si ningún proyecto tiene Sprints
    (la historia de los Sprints no se borra: esos proyectos se archivan)."""
    member = workspace_membership(db, workspace_id, user.id)
    if member.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el propietario puede eliminar el espacio")
    workspace = db.get(Workspace, workspace_id)
    if confirm.strip() != workspace.name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribe el nombre exacto del espacio para confirmar")
    with_sprints = db.scalars(
        select(Project.name).where(Project.workspace_id == workspace_id, Project.id.in_(select(Sprint.project_id)))
    ).all()
    if with_sprints:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Estos proyectos tienen Sprints y su historia no se borra: {', '.join(with_sprints)}. Archívalos en su lugar.",
        )
    db.delete(workspace)
    db.commit()


# ------------------------------------------------------------------ proyectos
@router.get("/{workspace_id}/projects", response_model=list[ProjectOut])
def list_projects(workspace_id: UUID, user: CurrentUser, db: UserDB) -> list[ProjectOut]:
    """Todos los proyectos visibles del espacio, también completados y archivados (el frontend los separa)."""
    member = workspace_membership(db, workspace_id, user.id)
    query = select(Project).where(Project.workspace_id == workspace_id)
    if member.role == "member":  # los miembros comunes solo ven proyectos donde participan
        query = query.join(ProjectMember, ProjectMember.project_id == Project.id).where(ProjectMember.user_id == user.id)
    return project_outs(db, list(db.scalars(query.order_by(Project.created_at))), user.id)


@router.post("/{workspace_id}/projects", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(workspace_id: UUID, payload: ProjectCreate, user: CurrentUser, db: UserDB) -> ProjectOut:
    member = workspace_membership(db, workspace_id, user.id)
    if member.role not in ADMIN_ROLES and not workspace_settings(db.get(Workspace, workspace_id)).members_can_create_projects:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "En este espacio solo el propietario y los administradores pueden crear proyectos")
    if payload.template not in TEMPLATES_BY_ID:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"La plantilla «{payload.template}» no existe")
    exists = db.scalar(select(Project.id).where(Project.workspace_id == workspace_id, Project.key == payload.key))
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Ya existe un proyecto con la clave {payload.key}")

    lead_id = payload.lead_id or user.id
    lead = db.get(WorkspaceMember, (workspace_id, lead_id))
    if lead is None or lead.status != "active":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El responsable debe ser miembro activo del espacio")

    # El Product Goal no se pide aquí: se define en el paso 4, antes de crear el Product Backlog
    project = Project(
        workspace_id=workspace_id, key=payload.key, name=payload.name.strip(),
        description=(payload.description or "").strip() or None, project_type=payload.project_type,
        lead_id=lead_id, color=payload.color, created_by=user.id,
    )
    db.add(project)
    db.flush()  # el trigger crea el tablero con columnas por defecto
    apply_template(db, project, payload.template, user.id)  # columnas y tareas iniciales
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role=payload.my_role))
    if lead_id != user.id:  # su rol Scrum se ajusta al configurar el equipo (paso 3)
        db.add(ProjectMember(project_id=project.id, user_id=lead_id, role="developer"))
    db.commit()
    db.refresh(project)
    return project_outs(db, [project], user.id)[0]


# ------------------------------------------------------------------ miembros
@router.get("/{workspace_id}/members", response_model=list[MemberOut])
def list_members(workspace_id: UUID, user: CurrentUser, db: UserDB) -> list[MemberOut]:
    workspace_membership(db, workspace_id, user.id)
    rows = db.execute(
        select(WorkspaceMember, Profile)
        .join(Profile, Profile.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.joined_at)
    )
    return [
        MemberOut(user_id=p.id, full_name=p.full_name, email=p.email, avatar_url=p.avatar_url, role=m.role, status=m.status)
        for m, p in rows
    ]


@router.patch("/{workspace_id}/members/{member_id}", response_model=MemberOut)
def change_member_role(
    workspace_id: UUID, member_id: UUID, payload: MemberRoleUpdate, user: CurrentUser, db: UserDB
) -> MemberOut:
    require_workspace_admin(db, workspace_id, user.id)
    member = db.get(WorkspaceMember, (workspace_id, member_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Miembro no encontrado")
    if member.role == "owner":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No se puede cambiar el rol del propietario")
    member.role = payload.role
    db.commit()
    profile = db.get(Profile, member_id)
    return MemberOut(
        user_id=profile.id, full_name=profile.full_name, email=profile.email, avatar_url=profile.avatar_url,
        role=member.role, status=member.status,
    )


@router.post("/{workspace_id}/members/{member_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
def revoke_member(workspace_id: UUID, member_id: UUID, user: CurrentUser, db: UserDB) -> None:
    require_workspace_admin(db, workspace_id, user.id)
    member = db.get(WorkspaceMember, (workspace_id, member_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Miembro no encontrado")
    if member.role == "owner":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No se puede revocar al propietario")
    member.status = "revoked"  # no se borra: queda la trazabilidad
    db.commit()


# ------------------------------------------------------------------ invitaciones
def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.get("/{workspace_id}/invitations", response_model=list[InvitationOut])
def list_invitations(workspace_id: UUID, user: CurrentUser, db: UserDB) -> list[Invitation]:
    require_workspace_admin(db, workspace_id, user.id)
    return list(db.scalars(
        select(Invitation).where(Invitation.workspace_id == workspace_id).order_by(Invitation.created_at.desc())
    ))


@router.post("/{workspace_id}/invitations", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
def create_invitation(
    workspace_id: UUID, payload: InvitationCreate, user: CurrentUser, db: UserDB
) -> InvitationOut:
    require_workspace_admin(db, workspace_id, user.id)
    if payload.project_id:
        project = db.get(Project, payload.project_id)
        if project is None or project.workspace_id != workspace_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "El proyecto no pertenece a este espacio")

    email = payload.email.lower()
    already = db.scalar(
        select(Invitation.id).where(
            Invitation.workspace_id == workspace_id, Invitation.email == email, Invitation.status == "pending",
            Invitation.expires_at > datetime.now(timezone.utc),
        )
    )
    if already:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya hay una invitación pendiente para ese correo")

    existing = db.scalar(
        select(WorkspaceMember.status).join(Profile, Profile.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id, Profile.email == email)
    )
    if existing == "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "Esa persona ya es miembro activo del espacio")

    invitation = Invitation(
        workspace_id=workspace_id, project_id=payload.project_id, email=email,
        workspace_role=payload.workspace_role,
        project_role=payload.project_role or ("developer" if payload.project_id else None),
        token_hash="", invited_by=user.id,
    )
    db.add(invitation)
    return _issue_invitation(db, invitation, user.id)


def _issue_invitation(db, invitation: Invitation, inviter_id: UUID) -> InvitationOut:
    """Genera un token nuevo (en la BD solo queda su hash), renueva el vencimiento y envía el correo.
    El enlace se devuelve una sola vez para poder copiarlo si el correo no llega."""
    token = secrets.token_urlsafe(32)
    invitation.token_hash = hash_token(token)
    invitation.expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.invitation_ttl_hours)
    db.commit()
    db.refresh(invitation)

    workspace = db.get(Workspace, invitation.workspace_id)
    project = db.get(Project, invitation.project_id) if invitation.project_id else None
    inviter = db.get(Profile, inviter_id)
    link = f"{settings.frontend_url.rstrip('/')}/invitacion/{token}"
    subject, html, text_body = invitation_email(
        inviter=inviter.full_name or inviter.email, workspace=workspace.name,
        project=project.name if project else None, link=link, hours=settings.invitation_ttl_hours,
    )
    out = InvitationOut.model_validate(invitation)
    out.link = link
    out.email_error = send_email(invitation.email, subject, html, text_body)
    out.email_sent = out.email_error is None
    return out


@router.post("/{workspace_id}/invitations/{invitation_id}/resend", response_model=InvitationOut)
def resend_invitation(workspace_id: UUID, invitation_id: UUID, user: CurrentUser, db: UserDB) -> InvitationOut:
    """Reenvía el correo con un enlace nuevo (el anterior deja de funcionar) y extiende el vencimiento."""
    require_workspace_admin(db, workspace_id, user.id)
    invitation = db.get(Invitation, invitation_id)
    if invitation is None or invitation.workspace_id != workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitación no encontrada")
    if invitation.status not in ("pending", "expired"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo se pueden reenviar invitaciones pendientes o vencidas")
    invitation.status = "pending"
    return _issue_invitation(db, invitation, user.id)


@router.post("/{workspace_id}/invitations/{invitation_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(workspace_id: UUID, invitation_id: UUID, user: CurrentUser, db: UserDB) -> None:
    require_workspace_admin(db, workspace_id, user.id)
    invitation = db.get(Invitation, invitation_id)
    if invitation is None or invitation.workspace_id != workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitación no encontrada")
    if invitation.status == "pending":
        invitation.status = "revoked"
        invitation.responded_at = datetime.now(timezone.utc)
        db.commit()
