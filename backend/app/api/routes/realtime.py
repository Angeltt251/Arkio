from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.core.security import AuthError, decode_access_token
from app.db.models import WorkspaceMember
from app.db.session import SessionLocal
from app.services.permissions import accessible_project_ids
from app.services.realtime import hub, room_for_project, room_for_workspace

router = APIRouter(tags=["tiempo real"])


def _rooms_for(user_id) -> list[str]:
    with SessionLocal() as db:
        projects = accessible_project_ids(db, user_id)
        workspaces = db.scalars(
            select(WorkspaceMember.workspace_id).where(
                WorkspaceMember.user_id == user_id, WorkspaceMember.status == "active"
            )
        )
        return [room_for_project(str(p)) for p in projects] + [room_for_workspace(str(w)) for w in workspaces]


@router.websocket("/ws")
async def realtime_socket(websocket: WebSocket, token: str = Query(...)) -> None:
    """Conexión: ws(s)://<api>/ws?token=<access_token de Supabase>.
    El servidor envía {"type": "activity", "data": {...}} cada vez que cambia algo
    en los proyectos del usuario. El cliente puede enviar "ping" y recibe "pong"."""
    try:
        user = decode_access_token(token)
    except AuthError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    rooms = await run_in_threadpool(_rooms_for, user.id)
    await hub.join(websocket, rooms)
    await websocket.send_json({"type": "ready", "rooms": len(rooms)})
    try:
        while True:
            if await websocket.receive_text() == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        await hub.leave(websocket)
