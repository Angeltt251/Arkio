"""Pruebas mínimas. Ejecutar con: pytest (desde la carpeta backend)."""

import os

os.environ.setdefault("REALTIME_ENABLED", "false")

from datetime import date  # noqa: E402

from fastapi.testclient import TestClient

from app.main import app
from app.services.dashboard import working_days


def test_health():
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_endpoints_protegidos_sin_token():
    with TestClient(app) as client:
        assert client.get("/api/dashboard").status_code == 401
        assert client.get("/api/workspaces").status_code == 401


def test_dias_habiles_sprint_dos_semanas():
    # Sprint del lunes 9 al viernes 20 de noviembre de 2026 → 10 días hábiles
    assert len(working_days(date(2026, 11, 9), date(2026, 11, 20))) == 10
