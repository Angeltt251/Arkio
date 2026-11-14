import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import boards, invitations, me, projects, realtime, templates, workspaces
from app.core.config import settings
from app.services.realtime import hub, listen_activity

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    listener = asyncio.create_task(listen_activity(settings.psycopg_dsn)) if settings.realtime_enabled else None
    yield
    if listener:
        listener.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await listener


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="API de Arkio: gestión Scrumban con bitácora histórica.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["sistema"])
def health() -> dict:
    return {"status": "ok", "app": settings.app_name, "realtime_connections": hub.connection_count()}


for module in (me, workspaces, projects, boards, templates, invitations):
    app.include_router(module.router, prefix="/api")
app.include_router(realtime.router)
