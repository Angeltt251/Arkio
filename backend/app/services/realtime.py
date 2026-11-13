"""Tiempo real con WebSockets.

1. La migración SQL hace `pg_notify('arkio_activity', …)` cada vez que se escribe en la bitácora.
2. `listen_activity` mantiene un LISTEN en PostgreSQL y reenvía cada aviso.
3. `RealtimeHub` lo envía a los navegadores conectados que pertenecen a ese proyecto.

Así, cualquier cambio (desde la API o desde el panel de Supabase) llega en vivo al tablero
y al dashboard. Nota: el hub vive en memoria, pensado para una sola instancia en Render.
"""

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

import psycopg
from fastapi import WebSocket

logger = logging.getLogger("arkio.realtime")


class RealtimeHub:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def join(self, websocket: WebSocket, rooms: list[str]) -> None:
        async with self._lock:
            for room in rooms:
                self._rooms[room].add(websocket)

    async def leave(self, websocket: WebSocket) -> None:
        async with self._lock:
            for members in self._rooms.values():
                members.discard(websocket)

    async def broadcast(self, room: str, message: dict[str, Any]) -> None:
        async with self._lock:
            targets = list(self._rooms.get(room, ()))
        for websocket in targets:
            try:
                await websocket.send_json(message)
            except Exception:
                await self.leave(websocket)

    def connection_count(self) -> int:
        return len({ws for members in self._rooms.values() for ws in members})


hub = RealtimeHub()


def room_for_project(project_id: str) -> str:
    return f"project:{project_id}"


def room_for_workspace(workspace_id: str) -> str:
    return f"workspace:{workspace_id}"


async def listen_activity(dsn: str) -> None:
    """Escucha el canal `arkio_activity` y reconecta si la conexión se cae."""
    while True:
        try:
            async with await psycopg.AsyncConnection.connect(dsn, autocommit=True) as conn:
                await conn.execute("LISTEN arkio_activity")
                logger.info("Escuchando la bitácora en tiempo real (LISTEN arkio_activity)")
                async for notify in conn.notifies():
                    payload = json.loads(notify.payload)
                    message = {"type": "activity", "data": payload}
                    if payload.get("project_id"):
                        await hub.broadcast(room_for_project(payload["project_id"]), message)
                    elif payload.get("workspace_id"):
                        await hub.broadcast(room_for_workspace(payload["workspace_id"]), message)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Se perdió la conexión LISTEN; reintentando en 5 s")
            await asyncio.sleep(5)
