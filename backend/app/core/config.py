from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Arkio API"
    environment: Literal["development", "test", "production"] = "development"

    # Base de datos (Supabase → Project Settings → Database → Connection string).
    # Usa el "Session pooler" o la conexión directa (puerto 5432) para que LISTEN/NOTIFY funcione.
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:54322/postgres"

    # Supabase Auth: se validan los tokens que envía el frontend
    supabase_url: str = ""
    supabase_jwt_secret: str = ""  # solo si tu proyecto usa la "Legacy JWT secret" (HS256)
    supabase_jwt_audience: str = "authenticated"

    # CORS / enlaces
    cors_origins: list[str] = ["http://localhost:5173"]
    frontend_url: str = "http://localhost:5173"

    # Zona horaria para métricas por día (burndown, tendencias)
    app_timezone: str = "America/Santiago"

    # Tiempo real
    realtime_enabled: bool = True

    # Correo (invitaciones)
    # smtp   → servidor SMTP (local con Mailpit o un plan pagado de Render)
    # resend → API HTTPS de Resend (funciona en el plan gratis de Render)
    # log    → no envía, solo escribe el enlace en los logs
    email_provider: Literal["smtp", "resend", "log"] = "log"
    email_from: str = "Arkio <no-reply@arkio.app>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True
    resend_api_key: str = ""

    invitation_ttl_hours: int = 72

    @field_validator("database_url")
    @classmethod
    def _use_psycopg_driver(cls, value: str) -> str:
        """Permite pegar tal cual la cadena de Supabase (postgresql://...)."""
        value = value.strip()
        if not value:
            raise ValueError(
                "DATABASE_URL está vacío en backend/.env. Pega la cadena del 'Session pooler' de Supabase "
                "(botón Connect → Connection String) con tu contraseña en lugar de [YOUR-PASSWORD]."
            )
        for prefix in ("postgresql://", "postgres://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix):]
        return value

    @property
    def psycopg_dsn(self) -> str:
        """DSN sin el prefijo de SQLAlchemy, para conexiones psycopg directas (LISTEN)."""
        return self.database_url.replace("postgresql+psycopg://", "postgresql://", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
