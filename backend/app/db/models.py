"""Modelos ORM. El esquema real se crea con la migración SQL de `supabase/migrations`;
aquí solo se mapean las tablas que usa la API (no se ejecuta `create_all`)."""

from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Integer, Numeric, Text, text
from sqlalchemy.dialects.postgresql import ENUM, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def pg_enum(name: str, *values: str) -> ENUM:
    return ENUM(*values, name=name, create_type=False)


WorkspaceRole = pg_enum("workspace_role", "owner", "admin", "member")
ProjectRole = pg_enum("project_role", "product_owner", "scrum_master", "developer", "observer")
MemberStatus = pg_enum("member_status", "active", "invited", "revoked")
ProjectStatus = pg_enum("project_status", "planning", "active", "paused", "closed")
PbiType = pg_enum("pbi_type", "story", "bug", "task", "spike", "improvement")
PbiStatus = pg_enum("pbi_status", "new", "refined", "ready", "in_sprint", "done", "discarded")
Priority = pg_enum("priority_level", "low", "medium", "high", "critical")
SprintStatus = pg_enum("sprint_status", "planned", "active", "closed", "cancelled")
InvitationStatus = pg_enum("invitation_status", "pending", "accepted", "declined", "revoked", "expired")

class Base(DeclarativeBase):
    pass


class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    email: Mapped[str] = mapped_column(Text)
    full_name: Mapped[str] = mapped_column(Text, default="")
    avatar_url: Mapped[str | None] = mapped_column(Text)
    theme: Mapped[str] = mapped_column(Text, default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name: Mapped[str] = mapped_column(Text)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("profiles.id"))
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id"), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("profiles.id"), primary_key=True)
    role: Mapped[str] = mapped_column(WorkspaceRole, default="member")
    status: Mapped[str] = mapped_column(MemberStatus, default="active")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id"))
    key: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    product_goal: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(ProjectStatus, default="planning")
    color: Mapped[str] = mapped_column(Text, default="#447794")
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("profiles.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProjectMember(Base):
    __tablename__ = "project_members"
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("profiles.id"), primary_key=True)
    role: Mapped[str] = mapped_column(ProjectRole, default="developer")
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class Invitation(Base):
    __tablename__ = "invitations"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id"))
    project_id: Mapped[UUID | None] = mapped_column(ForeignKey("projects.id"))
    email: Mapped[str] = mapped_column(Text)
    workspace_role: Mapped[str] = mapped_column(WorkspaceRole, default="member")
    project_role: Mapped[str | None] = mapped_column(ProjectRole)
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    invited_by: Mapped[UUID] = mapped_column(ForeignKey("profiles.id"))
    status: Mapped[str] = mapped_column(InvitationStatus, default="pending")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BacklogItem(Base):
    __tablename__ = "backlog_items"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"))
    seq: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    code: Mapped[str] = mapped_column(Text, server_default=text("''"))
    type: Mapped[str] = mapped_column(PbiType, default="story")
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(Priority, default="medium")
    rank: Mapped[float] = mapped_column(Float, default=0)
    estimate: Mapped[float | None] = mapped_column(Numeric(6, 2))
    status: Mapped[str] = mapped_column(PbiStatus, default="new")


class Sprint(Base):
    __tablename__ = "sprints"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"))
    number: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    goal: Mapped[str] = mapped_column(Text)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(SprintStatus, default="planned")
    close_reason: Mapped[str | None] = mapped_column(Text)


class BoardColumn(Base):
    __tablename__ = "board_columns"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    board_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"))
    name: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer)
    wip_limit: Mapped[int | None] = mapped_column(Integer)
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"))
    column_id: Mapped[UUID] = mapped_column(ForeignKey("board_columns.id"))
    sprint_id: Mapped[UUID | None] = mapped_column(ForeignKey("sprints.id"))
    backlog_item_id: Mapped[UUID | None] = mapped_column(ForeignKey("backlog_items.id"))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(Priority, default="medium")
    position: Mapped[float] = mapped_column(Float, default=0)
    due_date: Mapped[date | None] = mapped_column(Date)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    blocked_reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("profiles.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskAssignee(Base):
    __tablename__ = "task_assignees"
    task_id: Mapped[UUID] = mapped_column(ForeignKey("tasks.id"), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("profiles.id"), primary_key=True)


class ActivityLog(Base):
    __tablename__ = "activity_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    workspace_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    project_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    actor_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    action: Mapped[str] = mapped_column(Text)
    entity_type: Mapped[str] = mapped_column(Text)
    entity_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    changes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    source: Mapped[str] = mapped_column(Text, default="app")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
